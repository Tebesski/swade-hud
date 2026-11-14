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

export async function withToolsChatCard(context, execute) {
  const tools = game.modules?.get("swade-tools")?.active;
  const grab = isGrapple(context.item) && context.action === "formula";
  if ((!tools && !grab) || !globalThis.Hooks?.on) return execute();
  const handlers = [];
  const listen = (name, callback) => handlers.push([name, Hooks.on(name, callback)]);
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
    roll.terms[0].options[MARKER] = {flags, grab};
  };
  listen("swadePreRollAttribute", (...args) => mark("attribute", ...args));
  listen("swadePreRollSkill", (...args) => mark("skill", ...args));
  listen("swadeRollDamage", (...args) => mark("damage", ...args));
  try { return await execute(); }
  finally { for (const [name, id] of handlers) Hooks.off(name, id); }
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
  message.updateSource({ "flags.swade-tools": {
    ...(marker.flags ?? marker),
    usetarget: targets.map((token) => token.id).join(","),
    ...message.flags?.["swade-tools"],
  } });
}
