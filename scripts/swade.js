import {t as sbsI18n} from "./i18n.mjs";
import { withToolsChatCard } from "./tools-chat.js";
import { withToolsForecast } from "./tools-forecast.js";
import { bennyPool } from "./bennies.js";
import { powerUsesNoPP } from "./powers.js";
import { withPowerCastCard, withToolsPowerCast } from "./power-chat.js";
import { actionKind, actionTarget, basicActionEdges, hustleProvider, resolveBasicAction, runChaseAction, withActionEdges } from "./basic-actions.js";
import { mountedSkill, rollMountedAttack, weaponModifiers, weaponOptionsForRoll, weaponRollKind, withWeaponRoll } from "./attack-options.js";
import { rollSupport } from "./support.js";
import { isGrapple } from "./grapple-chat.js";
import { applyRunningPenalty } from "./running.js";
export const MODULE_ID = "swade-hud";
export const SWADE_TOOLS_SETTING = "disableSwadeToolsDialogs";
export const SWADE_TOOLS_GLOBAL_SETTING = "disableSwadeToolsDialogsGlobally";
export const ATTRIBUTES = [
  ["agility", "SWADE.AttrAgi", "fa-person-running"],
  ["smarts", "SWADE.AttrSma", "fa-brain"],
  ["spirit", "SWADE.AttrSpr", "fa-ghost"],
  ["strength", "SWADE.AttrStr", "fa-hand-fist"],
  ["vigor", "SWADE.AttrVig", "fa-heart-pulse"],
];
export const SIDEBARS = [
  ["actions", sbsI18n("swade-hud.UI.WeaponsActions_21aec0a2fd"), "fa-sword"],
  ["items", sbsI18n("swade-hud.UI.Inventory_758f487fe8"), "fa-backpack"],
  ["spells", sbsI18n("swade-hud.UI.Powers_3286cc91e5"), "fa-wand-magic-sparkles"],
  ["skills", sbsI18n("swade-hud.UI.Skills_66d0f523a3"), "fa-hand"],
  ["feats", sbsI18n("swade-hud.UI.EdgesHindrances_53cce7aec8"), "fa-medal"],
  ["extras", sbsI18n("swade-hud.UI.Effects_358511c8c0"), "fa-sparkle"],
  ["utilities", sbsI18n("swade-hud.UI.Extras_3038523738"), "fa-cubes"],
];
export const PHYSICAL = ["weapon", "armor", "shield", "gear", "consumable"];
export const localize = (key, fallback = key) => {
  const result = game.i18n.localize(key);
  return result === key ? fallback : result;
};
export const itemsOf = (actor, ...types) => actor.items.filter((item) => types.includes(item.type));
export const sorted = (items) => [...items].sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
export const canRollSkills = (actor) => ["character", "npc"].includes(actor.type);
export const dieLabel = (die, modifier = die?.modifier) => {
  if (!die) return "—";
  const mod = Number(modifier || 0);
  return "d" + die.sides + (mod ? (mod > 0 ? "+" : "") + mod : "");
};
export const powerPools = (actor) => Object.entries(actor.system.powerPoints ?? {})
  .filter(([, pool]) => Number.isFinite(pool?.value));
export const statusDefinitions = () => Array.isArray(CONFIG.statusEffects)
  ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects ?? {});
export const statusDefinition = (id) => statusDefinitions().find((status) => status.id === id);
export const hasStatus = (actor, id) => actor.statuses?.has(id)
  || actor.effects.some((effect) => effect.active && effect.statuses?.has(id));

export function swadeToolsDialogsDisabled() {
  return game.modules?.get("swade-tools")?.active
    && game.settings?.get?.(MODULE_ID, SWADE_TOOLS_GLOBAL_SETTING) === true;
}
function swadeToolsEnabled() {
  return game.modules?.get("swade-tools")?.active
    && !swadeToolsDialogsDisabled()
    && game.settings?.get?.(MODULE_ID, SWADE_TOOLS_SETTING) === false;
}
function swadeTools() {
  return game.modules?.get("swade-tools")?.active ? game.swadetools : undefined;
}
export function hasSwadeToolsItemDialog(item) {
  if (!swadeToolsEnabled() || !item || isGrapple(item)) return false;
  return (["weapon", "power"].includes(item.type) && typeof game.swadetools?.item === "function")
    || Boolean(item.system?.actions && typeof game.swade?.swadetoolsAttack === "function");
}
export function openSwadeToolsItemDialog(actor, item, { castCard = false } = {}) {
  if (!actor?.isOwner || !hasSwadeToolsItemDialog(item)) return;
  // Tools exposes this entry point for its native item dialog, including gear
  // and configured abilities, beyond its weapon/power-only public item helper.
  const open = ["weapon", "power"].includes(item.type) && typeof game.swadetools?.item === "function"
    ? () => game.swadetools.item(actor, item.id)
    : () => game.swade.swadetoolsAttack(actor, item, true);
  const execute = () => withToolsForecast({ actor, item }, () => castCard ? withToolsPowerCast(item, open) : open());
  const targeting = game.modules.get("swade-better-setting")?.api?.withAdvancedTargeting;
  return targeting ? targeting({actor, item}, execute) : execute();
}

export async function rollAttribute(actor, attribute, options) {
  if (!actor?.isOwner) return;
  const tools = swadeTools();
  // Tools' public trait helpers do not accept SWADE roll options.
  if (typeof tools?.attribute === "function" && !Object.keys(options ?? {}).length) {
    if (swadeToolsEnabled()) return withToolsForecast({ actor, attribute }, () => tools.attribute(actor, attribute));
  }
  const nativeOptions = options ?? {};
  nativeOptions.additionalMods ??= [];
  return withToolsChatCard({ actor, mods: nativeOptions.additionalMods }, () => actor.rollAttribute(attribute, nativeOptions));
}
export async function rollSkill(actor, itemId, options) {
  if (!actor?.isOwner) return;
  const tools = swadeTools();
  const toolsSkill = itemId ?? actor.items.find((item) => item.type === "skill" && item.system.swid === "unskilled-attempt")?.id;
  if (typeof tools?.skill === "function" && toolsSkill && !Object.keys(options ?? {}).length) {
    if (swadeToolsEnabled()) return withToolsForecast({ actor, skill: actor.items.get(toolsSkill) }, () => tools.skill(actor, toolsSkill));
  }
  const nativeOptions = options ?? {};
  nativeOptions.additionalMods ??= [];
  return withToolsChatCard({ actor, mods: nativeOptions.additionalMods }, () => actor.rollSkill(itemId, nativeOptions));
}
export async function rollRunning(actor) {
  if (!actor?.isOwner) return;
  const tools = swadeTools();
  if (typeof tools?.run === "function" && swadeToolsEnabled()) return tools.run(actor);
  const roll = await actor.rollRunningDie?.();
  if (Number.isFinite(roll?.total)) await applyRunningPenalty(actor);
  return roll;
}

const shakenRecoveries = new WeakMap();
export function recoverShaken(actor) {
  if (!actor?.isOwner || !canRollSkills(actor) || !hasStatus(actor, "shaken")) return;
  if (shakenRecoveries.has(actor)) return shakenRecoveries.get(actor);
  const recovery = (async () => {
    const flavor = localize("SWADE.EffectCallbacks.Shaken.Flavor", sbsI18n("swade-hud.UI.RecoverfromShaken_f40f449453"));
    // Tools' public attribute helper returns no roll and accepts no Unshake
    // bonus. Use the system's recovery options and TraitRoll success result.
    const roll = await rollAttribute(actor, "spirit", {
      title: flavor, flavour: flavor,
      additionalMods: [{ label: localize("SWADE.EffectCallbacks.Shaken.UnshakeModifier", sbsI18n("swade-hud.UI.Unshakebonus_12adc7c951")),
        value: actor.system.attributes.spirit.unShakeBonus ?? 0 }],
    });
    if ((roll?.successes ?? 0) >= 1 && actor.isOwner) {
      await actor.toggleActiveEffect("shaken", { active: false });
    }
    return roll;
  })();
  shakenRecoveries.set(actor, recovery);
  recovery.finally(() => shakenRecoveries.delete(actor)).catch(() => {});
  return recovery;
}

export async function useItem(actor, item, action = "formula", event, {
  castCard = false, nativeOnly = false, additionalMods = [], inheritedWeaponOptions, targetingResolved = false,
} = {}) {
  if (!actor?.isOwner || !item) return;
  const mounts = game.modules.get("swade-better-mounts-and-vehicles")?.api;
  if (action === "formula" && mounts?.handlesAction?.(item)) return mounts.useAction(actor, item);
  const additionalAction = item.system.actions?.additional?.[action];
  const targeting = game.modules.get("swade-better-setting")?.api?.withAdvancedTargeting;
  if (!targetingResolved && targeting) {
    const basic = actionKind(item);
    return targeting({actor, item, action, traitAction: action === "formula" && ["support", "test"].includes(basic),
      skip: !["formula", "damage", "consume"].includes(action) && !additionalAction},
    () => useItem(actor, item, action, event, {castCard, nativeOnly, additionalMods, inheritedWeaponOptions, targetingResolved: true}));
  }
  const isRoll = action === "formula" || action === "damage" || ["trait", "damage"].includes(additionalAction?.type);
  const powerCast = castCard && item.type === "power" && action === "formula";
  const basicAction = actionKind(item);
  const hustles = basicAction === "earn" && action === "formula" && hustleProvider();
  if (hustles) {
    const trait = item.system.actions?.trait?.toLowerCase();
    const skill = actor.items.find(entry => entry.type === "skill" &&
      [entry.id, entry.name, entry.system.swid].some(value => value?.toLowerCase() === trait));
    return hustles.hustle(actor, skill);
  }
  if (action === "formula" && ["chase-evade", "chase-steady"].includes(basicAction)) return runChaseAction(actor, item);
  const weaponKind = weaponRollKind(item, action);
  const modes = weaponKind && (event || inheritedWeaponOptions)
    ? weaponOptionsForRoll(actor, item, action, inheritedWeaponOptions) : {};
  const hasOptions = Object.entries(modes).some(([key, value]) => value && ![sbsI18n("swade-hud.UI.twoHanded_da0c1cf68c"), sbsI18n("swade-hud.UI.flatBlade_a443d4da06")].includes(key));
  if (!nativeOnly && !basicAction && !hasOptions && hasSwadeToolsItemDialog(item) && isRoll) {
    // This opens Tools' complete item dialog; it owns the eventual roll and
    // resource expenditure. An undefined result is not a request to roll again.
    // Keep the original vehicle actor: Tools resolves its driver internally.
    return openSwadeToolsItemDialog(actor, item, { castCard: powerCast });
  }
  let roller = actor;
  if (actor.type === "vehicle") {
    roller = (item.type === "weapon" ? actor.system.getCrewMemberForWeapon?.(item) : null)
      ?? actor.system.operator ?? actor;
  }
  if (weaponKind) additionalMods.push(...weaponModifiers(roller, modes, weaponKind));
  if (item.type === "power" && powerUsesNoPP(item, actor) && !game.modules?.get?.("swade-better-powers")?.active && !game.modules?.get?.("swade-better-setting")?.api?.openPowers && action === "formula") {
    const cost = item.system.ppModifiers?.cost ?? item.system.pp ?? 0;
    additionalMods.push({ label: localize("TYPES.Item.power", sbsI18n("swade-hud.UI.Power_848e96567d")), value: -Math.ceil(cost / 2) });
  }
  const mounted = weaponKind === "attack" && modes.mounted ? mountedSkill(roller, item, action) : undefined;
  const execute = () => mounted ? rollMountedAttack(roller, item, action, mounted.skill, additionalMods)
    : game.swade.itemChatCardHelper.handleAction(item, roller, action, { additionalMods, event });
  const roll = () => isRoll
    ? withToolsChatCard({ actor: roller, owner: actor, item, action, mods: additionalMods }, execute) : execute();
  if (powerCast) return withPowerCastCard(item, additionalMods, roll);
  if (weaponKind && hasOptions) return withWeaponRoll(roller, item, weaponKind, modes, additionalMods, roll);
  if (!basicAction) return roll();
  const target = actionTarget();
  if (basicAction === "support" && action === "formula") return rollSupport(roller, target, roll);
  const result = await withActionEdges(roller, additionalMods, basicActionEdges(roller, item), roll);
  await resolveBasicAction(actor, item, result, target);
  return result;
}
export async function adjustResource(actor, key, delta) {
  if (!actor.isOwner) return;
  if (key === "bennies") {
    const pool = bennyPool(actor);
    if (!pool.editable) return;
    return delta > 0 ? pool.owner.getBenny() : pool.owner.spendBenny();
  }
  const current = actor.system[key];
  if (current && Number.isFinite(current.value)) {
    return actor.update({ ["system." + key + ".value"]: Math.max(0, current.value + delta) });
  }
}
export async function updatePool(actor, key, value) {
  if (!actor.isOwner || !Number.isFinite(value) || !actor.system.powerPoints?.[key]) return;
  const current = actor.system.powerPoints[key].value;
  const source = actor._source?.system?.powerPoints?.[key]?.value ?? current;
  return actor.update({ system: { powerPoints: { [key]: { value: Math.max(0, source + value - current) } } } });
}
