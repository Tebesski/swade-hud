import { withToolsChatCard } from "./tools-chat.js";
import { withToolsForecast } from "./tools-forecast.js";
import { bennyPool } from "./bennies.js";
import { powerUsesNoPP } from "./powers.js";
import { withPowerCastCard, withToolsPowerCast } from "./power-chat.js";
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
  ["actions", "Weapons & Actions", "fa-sword"],
  ["items", "Inventory", "fa-backpack"],
  ["spells", "Powers", "fa-wand-magic-sparkles"],
  ["skills", "Skills", "fa-hand"],
  ["feats", "Edges & Hindrances", "fa-medal"],
  ["extras", "Effects", "fa-cubes"],
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
  if (!swadeToolsEnabled() || !item) return false;
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
  return withToolsForecast({ actor, item }, () => castCard ? withToolsPowerCast(item, open) : open());
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
  return actor.rollRunningDie?.();
}

const shakenRecoveries = new WeakMap();
export function recoverShaken(actor) {
  if (!actor?.isOwner || !canRollSkills(actor) || !hasStatus(actor, "shaken")) return;
  if (shakenRecoveries.has(actor)) return shakenRecoveries.get(actor);
  const recovery = (async () => {
    const flavor = localize("SWADE.EffectCallbacks.Shaken.Flavor", "Recover from Shaken");
    // Tools' public attribute helper returns no roll and accepts no Unshake
    // bonus. Use the system's recovery options and TraitRoll success result.
    const roll = await rollAttribute(actor, "spirit", {
      title: flavor, flavour: flavor,
      additionalMods: [{ label: localize("SWADE.EffectCallbacks.Shaken.UnshakeModifier", "Unshake bonus"),
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

export async function useItem(actor, item, action = "formula", event, { castCard = false, nativeOnly = false, additionalMods = [] } = {}) {
  if (!actor?.isOwner || !item) return;
  const additionalAction = item.system.actions?.additional?.[action];
  const isRoll = action === "formula" || action === "damage" || ["trait", "damage"].includes(additionalAction?.type);
  const powerCast = castCard && item.type === "power" && action === "formula";
  if (!nativeOnly && hasSwadeToolsItemDialog(item) && isRoll) {
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
  if (item.type === "power" && powerUsesNoPP(item, actor) && !game.modules?.get?.("swade-better-powers")?.active && !game.modules?.get?.("swade-better-setting")?.api?.openPowers && action === "formula") {
    const cost = item.system.ppModifiers?.cost ?? item.system.pp ?? 0;
    additionalMods.push({ label: localize("TYPES.Item.power", "Power"), value: -Math.ceil(cost / 2) });
  }
  const execute = () => game.swade.itemChatCardHelper.handleAction(item, roller, action, { additionalMods, event });
  const roll = () => isRoll
    ? withToolsChatCard({ actor: roller, owner: actor, item, action, mods: additionalMods }, execute) : execute();
  return powerCast ? withPowerCastCard(item, additionalMods, roll) : roll();
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
