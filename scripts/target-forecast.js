import { toolsTargetDefense } from "./tools-forecast.js";

const SBE = "swade-better-effects";
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const label = (value) => game.i18n.localize(value ?? "");
const sameMod = (a, b) => label(a.label).trim().toLocaleLowerCase() === label(b.label).trim().toLocaleLowerCase()
  && (Number.isFinite(Number(a.value)) && Number.isFinite(Number(b.value)) ? Number(a.value) === Number(b.value) : String(a.value) === String(b.value));
export function attackKind(item, skill) {
  if (item?.type === "power") return item.system.damage && !Object.values(item.system.templates ?? {}).some(Boolean) ? "ranged" : null;
  if (item?.type !== "weapon") return null;
  const name = skill?.name ?? item.system.actions?.trait ?? "";
  const fighting = skill?.system?.swid === "fighting" || name === game.i18n.localize("SWADE.Skills.Fighting") || /^fighting$/i.test(name)
    || game.modules.get("swade-tools")?.active && name === game.settings.get("swade-tools", "fightingSkill");
  if (item.system.isRanged && (!item.system.isMelee || !fighting)) return "ranged";
  if (item.system.isMelee || fighting) return "melee";
  return /\d/.test(item.system.range ?? "") ? "ranged" : "melee";
}
export function incomingModifiers(actor, kind, token) {
  const mods = actor?.system.stats?.globalMods;
  const result = ["targetAttack", kind === "ranged" ? "targetAttackRanged" : "targetAttackMelee"]
    .flatMap((key) => mods?.[key] ?? []).map((mod) => ({ label: mod.label, value: finite(mod.value) }));
  if (token?.document?.hasStatusEffect?.("vulnerable") || actor?.statuses?.has("vulnerable") || actor?.system.status?.isVulnerable)
    result.push({ label: "SWADE.TargetVulnerable", value: 2 });
  return result;
}
function savedContext(roll) {
  if (roll?.options?.[SBE]) return roll.options[SBE];
  const scan = (terms) => {
    for (const term of terms ?? []) {
      if (term.options?.[SBE]) return term.options[SBE];
      const found = scan(term.roll?.terms) ?? (term.rolls ?? []).map((roll) => scan(roll.terms)).find(Boolean);
      if (found) return found;
    }
  };
  return scan(roll?.terms);
}
function effectContext(api, forecast, saved) {
  const { actor, item, skill } = forecast;
  const tokens = actor?.getActiveTokens?.(false, true) ?? [];
  const source = actor?.token ?? tokens.find((token) => token.object?.controlled) ?? tokens[0];
  const attacker = api.normalizeFlags([...api.getFlags(actor), ...api.getFlags(source)]);
  const itemFlags = api.getFlags(item);
  const attribute = forecast.attribute ?? skill?.system.attribute;
  return { ...saved, version: 1, hasRoll: true, rollType: "trait", attribute,
    actorUuid: actor?.uuid, tokenUuid: source?.uuid, itemUuid: item?.uuid,
    attacker, item: itemFlags, roll: api.normalizeFlags([...(saved?.roll ?? []), ...attacker, ...itemFlags,
      "trait", skill ? "skill" : "attribute", skill?.name, attribute, "attack", item?.type, attackKind(item, skill)]),
    attackerRules: api.collectRules(actor, item).map((rule) => ({ ...rule, ownerFlags: attacker })) };
}
function matchingMods(mods, candidates) {
  const available = [...(mods ?? [])];
  return candidates.map((candidate) => {
    const index = available.findIndex((mod) => sameMod(mod, candidate));
    return index < 0 ? null : available.splice(index, 1)[0];
  }).filter(Boolean);
}
// Record the actual modifier objects so a checkbox disabled in the native dialog
// remains disabled in its preview. Only the preview formula is adjusted.
export function nativeAttackSnapshot(app, context = {}) {
  const actor = app.ctx.actor, item = app.ctx.item;
  const skill = context.skill ?? actor?.items?.find((entry) => entry.type === "skill" && entry.name === item?.system.actions?.trait);
  const kind = attackKind(item, skill);
  const target = context.target ?? [...(game.user.targets ?? [])][0];
  const mods = app.ctx.mods ?? [];
  const native = matchingMods(mods, context.incoming ?? incomingModifiers(target?.actor, kind, target));
  const saved = savedContext(app.ctx.roll);
  const api = game.modules.get(SBE)?.active && game.modules.get(SBE)?.api;
  const applied = api?.traitAdjustment && saved ? api.traitAdjustment(saved, target).applied : [];
  return { skill, attribute: context.attribute, native, saved, effects: matchingMods(mods.filter((mod) => !native.includes(mod)), applied) };
}
export async function targetedForecasts(forecast, snapshot, targets = [...(game.user.targets ?? [])], defense = toolsTargetDefense) {
  const kind = attackKind(forecast.item, forecast.skill);
  const visible = targets.filter((target) => target.actor && target.visible !== false && target.isVisible !== false
    && (!target.document?.hidden || game.user.isGM));
  if (!kind || !visible.length) return [forecast];
  const api = game.modules.get(SBE)?.active && game.modules.get(SBE)?.api;
  const context = api?.traitAdjustment ? effectContext(api, forecast, snapshot?.saved) : null;
  // The native formula already contains these modifiers, including Better
  // Effects' pre-roll additions. Remove their enabled contributions once before
  // evaluating the current defender; never change the actual Roll or dialog.
  const included = [...(snapshot?.native ?? []), ...(snapshot?.effects ?? [])].filter((mod) => !mod.ignore);
  const removed = included.reduce((sum, mod) => sum + finite(mod.value), 0);
  return Promise.all(visible.map(async (target) => {
    let own = [], effects = [];
    if (context) {
      const ignored = snapshot?.effects?.filter((mod) => mod.ignore) ?? [];
      const attacker = api.traitAdjustment(context, target, { includeDefender: false }).applied;
      own = attacker.filter((mod) => !ignored.some((entry) => sameMod(entry, mod)));
      const all = api.traitAdjustment(context, target).applied;
      effects = all.slice(attacker.length).filter((mod) => !ignored.some((entry) => sameMod(entry, mod)));
    }
    const native = incomingModifiers(target.actor, kind, target).filter((mod) => !(snapshot?.native ?? []).some((entry) => entry.ignore && sameMod(entry, mod)));
    const tools = game.modules.get("swade-tools")?.active ? await defense(target.actor, kind) : [];
    const modifiers = [...native, ...effects];
    // Tools recognizes named edges independently of SWADE Active Effects.
    // An edge represented by an equivalent prepared effect counts once.
    for (const mod of tools) if (!modifiers.some((entry) => sameMod(entry, mod))) modifiers.push(mod);
    const base = kind === "melee" ? Number(target.actor.system.stats?.parry?.value) : 4;
    if (!Number.isFinite(base)) return { unavailable: true, targetName: target.name };
    const adjustment = modifiers.reduce((sum, mod) => sum + finite(mod.value), 0);
    const ownValue = own.reduce((sum, mod) => sum + finite(mod.value), 0);
    const revealDefense = game.user.isGM || target.actor.isOwner === true;
    return { ...forecast, formula: forecast.formula + (ownValue - removed ? "+(" + (ownValue - removed) + ")" : ""),
      target: base - adjustment, targetKey: target.document?.uuid ?? target.id ?? target.name,
      targetName: target.name ?? target.actor.name, revealDefense,
      defense: revealDefense ? kind === "melee" ? "Parry" : "Ranged" : undefined,
      defenseDetails: revealDefense ? modifiers.map((mod) => label(mod.label) + " " + (mod.value > 0 ? "+" : "") + mod.value).join(" · ") : undefined };
  }));
}
