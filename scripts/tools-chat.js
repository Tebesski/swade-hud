import { isGrapple } from "./grapple-chat.js";

export function hasToolsDamageFormula(item, action) {
  const variant = item?.system?.actions?.additional?.[action];
  if (action && action !== "damage" && variant?.type !== "damage") return false;
  const formula = (variant?.type === "damage" && variant.override) || item?.system?.damage;
  return typeof formula === "string" && Boolean(formula.trim());
}

const guarded = new WeakSet();
export function guardToolsAttackTargets(RollControl) {
  const prototype = RollControl.prototype;
  if (guarded.has(prototype) || typeof prototype.attackTarget !== "function") return;
  guarded.add(prototype);
  const attackTarget = prototype.attackTarget;
  prototype.attackTarget = function (...args) {
    const flags = this.chat.flags["swade-tools"];
    const item = this.getItemOwner()?.items.get(flags.itemroll);
    if (isGrapple(item) && flags.useaction === "formula") return;
    if (hasToolsDamageFormula(item, flags.damageaction)) return attackTarget.apply(this, args);
  };
}

// SWADE's native dialog retains the original roll terms when it builds the
// confirmed roll. Mark those terms, then attach Tools' chat metadata before the
// message is created. This preserves the native dialog and rolls/resources once.
const MARKER = "swadeHudToolsCard";
const attackContexts = new Map();

const tokenId = token => token?.id ?? token?._id;
const translated = label => game.i18n.localize(label ?? "");
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const sameModifier = (a, b) => translated(a.label) === translated(b.label) && numeric(a.value) === numeric(b.value);

// The native formula includes its first defender's situational modifiers. For
// another defender, change only the difference; never charge those modifiers
// a second time. Freeze the result with the message so moving tokens later does
// not change a completed attack. User-disabled modifiers stay disabled.
function nativeAttackTargets(context, targets) {
  const calculate = game.swade?.util?.getDefaultAttackModifiers;
  if (!calculate) return null;
  const available = [...context.modifiers];
  const applied = context.defaults.map(candidate => {
    const index = available.findIndex(mod => sameModifier(mod, candidate));
    return index < 0 ? null : available.splice(index, 1)[0];
  }).filter(Boolean);
  const ignored = applied.filter(mod => mod.ignore).map(mod => translated(mod.label));
  const included = applied.filter(mod => !mod.ignore).reduce((sum, mod) => sum + numeric(mod.value), 0);
  const result = {};
  for (const target of targets) {
    const document = target.document ?? target;
    let adjustment = included;
    if (tokenId(document) !== tokenId(context.target)) {
      const {additionalMods = [], bestNonStackingMods = {}} = calculate(context.source, document,
        context.item, context.ranged, context.melee);
      adjustment = [...additionalMods, ...Object.values(bestNonStackingMods).filter(Boolean)]
        .filter(mod => !mod.ignore && !ignored.includes(translated(mod.label)))
        .reduce((sum, mod) => sum + numeric(mod.value), 0);
    }
    const base = context.melee ? Number(target.actor?.system.stats?.parry?.value) : 4;
    if (Number.isFinite(base)) result[tokenId(document)] = {targetNumber: base + included - adjustment};
  }
  return {version: 1, targets: result};
}

export async function withToolsChatCard(context, execute) {
  const tools = game.modules?.get("swade-tools")?.active;
  const grab = isGrapple(context.item) && context.action === "formula";
  if ((!tools && !grab) || !globalThis.Hooks?.on) return execute();
  const handlers = [];
  const ids = [];
  let attack;
  let marked = false;
  const listen = (name, callback) => handlers.push([name, Hooks.on(name, callback)]);
  listen("swadeCalculateDefaultAttackMods", (source, target, skill, item, ranged, melee, additionalMods, best) => {
    if (marked || item !== context.item) return;
    attack = {source, target, skill, item, ranged, melee, additionalMods, best};
  });
  const mark = (kind, actor, trait, roll, _modifiers, options) => {
    // This exact array belongs to this HUD operation. Concurrent dialogs and
    // unrelated rolls from the same actor cannot acquire each other's metadata.
    if (options?.additionalMods !== context.mods || !roll?.terms?.[0]) return;
    const item = context.item;
    const linkedItem = grab ? null : item;
    const flags = {
      useactor: context.actor.id,
      rolltype: kind === "damage" ? "damage" : linkedItem ? "skill" : kind,
      userof: options.rof ?? 1,
    };
    const hud = game.modules?.get("swade-hud")?.api;
    const token = context.actor.token ?? (hud?.actor?.uuid === context.actor.uuid ? hud.token?.document : null);
    if (token) flags.usetoken = token.id;
    if (kind === "attribute") flags.attribute = trait;
    if (kind === "skill") flags.skill = trait?.name;
    if (linkedItem) { flags.itemroll = linkedItem.id; flags.useaction = context.action; }
    if (context.owner?.type === "vehicle") {
      flags.usevehicle = context.owner.id;
      const vehicleToken = context.owner.token ?? (hud?.actor?.uuid === context.owner.uuid ? hud.token?.document : null);
      if (vehicleToken) flags.usevehicletoken = vehicleToken.id;
    }
    roll.terms[0].options ??= {};
    const marker = {flags, grab};
    if (kind === "skill" && attack) {
      const id = crypto.randomUUID();
      ids.push(id);
      attackContexts.set(id, {...attack, modifiers: _modifiers,
        defaults: [...attack.additionalMods, ...Object.values(attack.best ?? {}).filter(Boolean)]});
      marker.nativeAttackContext = id;
    }
    marked = true;
    roll.terms[0].options[MARKER] = marker;
  };
  listen("swadePreRollAttribute", (...args) => mark("attribute", ...args));
  listen("swadePreRollSkill", (...args) => mark("skill", ...args));
  listen("swadeRollDamage", (...args) => mark("damage", ...args));
  try { return await execute(); }
  finally {
    for (const [name, id] of handlers) Hooks.off(name, id);
    for (const id of ids) attackContexts.delete(id);
  }
}

export function decorateToolsChatMessage(message, _data, _options, userId) {
  if (userId !== game.user.id) return;
  const marker = message.rolls?.[0]?.terms?.[0]?.options?.[MARKER];
  if (!marker) return;
  const targets = [...(game.user.targets ?? [])];
  if (marker.grab) message.updateSource({ "flags.swade-hud.grapple": {
    targetUuid: targets.length === 1 ? targets[0].document?.uuid ?? null : null,
  } });
  if (!game.modules?.get("swade-tools")?.active) return;
  const attack = attackContexts.get(marker.nativeAttackContext);
  const nativeAttack = attack && nativeAttackTargets(attack, targets);
  if (nativeAttack) message.updateSource({"flags.swade-hud.nativeAttack": nativeAttack});
  message.updateSource({ "flags.swade-tools": {
    ...(marker.flags ?? marker),
    usetarget: targets.map((token) => token.id).join(","),
    ...message.flags?.["swade-tools"],
  } });
}
