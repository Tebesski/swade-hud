import {t as sbsI18n} from "./i18n.mjs";
import { findEdge } from "./basic-actions.js";
import { applyTimedStatus } from "./effects.js";
import { hasStatus } from "./swade.js";

const MODULE_ID = "swade-hud";
const MARKER = "swadeHudWeaponOptions";
const choicesByActor = new WeakMap();
const options = [
  {id: "wild", get label() { return sbsI18n("swade-hud.UI.WildAttack_90fb7b1f5f"); }, get help() { return sbsI18n("swade-hud.UI.2toFightinganddamageBecome_7e2c918643"); }},
  {id: "nonlethal", get label() { return sbsI18n("swade-hud.UI.NonlethalAttack_b3b6dfe6ce"); }, get help() { return sbsI18n("swade-hud.UI.Usefistsorabluntweapon_30cf509b1b"); }},
  {id: "mounted", get label() { return sbsI18n("swade-hud.UI.Horsebackattack_a748343307"); }, get help() { return sbsI18n("swade-hud.UI.UsethelowerofFightingand_2ca2fa79fb"); }, mounted: true},
  {id: "charge", get label() { return sbsI18n("swade-hud.UI.MountedCharge_8efe85224f"); }, get help() { return sbsI18n("swade-hud.UI.4damagewhenthechargequalifies_f024878715"); }, mounted: true},
  {id: "sweep", get label() { return sbsI18n("swade-hud.UI.Sweep_310b02ef1b"); }, get help() { return sbsI18n("swade-hud.UI.SelectthetargetsinReachApply_b0c4c9ec93"); }, edges: ["sweep", "improved-sweep"]},
  {id: "close", get label() { return sbsI18n("swade-hud.UI.CloseFighting_6433fdc1f4"); }, get help() { return sbsI18n("swade-hud.UI.Usetheedgeandanysituational_870593026e"); }, edges: ["close-fighting", "improved-close-fighting"]},
  {id: "desperate2", get label() { return sbsI18n("swade-hud.UI.DesperateAttack2_dfe0f8a59a"); }, get help() { return sbsI18n("swade-hud.UI.2toFightingand2damage_ba9c04a270"); }},
  {id: "desperate4", get label() { return sbsI18n("swade-hud.UI.DesperateAttack4_812e96eeb0"); }, get help() { return sbsI18n("swade-hud.UI.4toFightingand4damage_61fdd94842"); }},
];
const styles = ["wild", "desperate2", "desperate4"];

export function attackOptions(actor) {
  const available = options.filter(option => (!option.mounted || hasStatus(actor, "mounted")
    || game.modules.get("swade-better-mounts-and-vehicles")?.api?.rideOf?.(game.modules.get("swade-better-mounts-and-vehicles").api.sourceToken(actor))?.mode === "ride")
    && (!option.edges || findEdge(actor, ...option.edges)));
  if (attackOptionState(actor, "nonlethal")) {
    available.push({id: "flatBlade", label: sbsI18n("swade-hud.UI.Flatofblade_301dfec79f"), help: sbsI18n("swade-hud.UI.Apply1toFightingwhenusing_08f3b56213")});
  }
  if (available.some(option => option.id === "sweep") && attackOptionState(actor, "sweep")) {
    available.push({id: "twoHanded", label: sbsI18n("swade-hud.UI.TwohandedgripSweep_a35c8c294d"), help: sbsI18n("swade-hud.UI.Useatwohandedweaponto_292b04029e")});
  }
  return available;
}
export function attackOptionState(actor, id) {
  return choicesByActor.get(actor)?.has(id) ?? false;
}
export function setAttackOption(actor, id, active) {
  const choices = choicesByActor.get(actor) ?? new Set();
  if (active && styles.includes(id)) for (const other of styles) choices.delete(other);
  if (active) choices.add(id);
  else choices.delete(id);
  if (!active && id === "nonlethal") choices.delete("flatBlade");
  if (!active && id === "sweep") choices.delete("twoHanded");
  choicesByActor.set(actor, choices);
}

export function weaponRollKind(item, action) {
  if (item?.type !== "weapon") return;
  const variant = item.system.actions?.additional?.[action];
  if (action === "damage" || variant?.type === "damage") return "damage";
  if (action === "formula" || variant?.type === "trait") return "attack";
}

function meleeWeapon(item, action) {
  const variant = item.system.actions?.additional?.[action];
  if (/throw/i.test(variant?.name ?? "") || /shooting|athletics/i.test(variant?.override ?? "")) return false;
  return item.isMeleeWeapon ?? (!item.system.range || /^melee$/i.test(item.system.range));
}

export function weaponOptionsForRoll(actor, item, action, inherited) {
  if (!meleeWeapon(item, action)) return {};
  if (inherited) return { ...inherited };
  const modes = Object.fromEntries(attackOptions(actor).map(({id}) => [id, attackOptionState(actor, id)]));
  if (modes.sweep && /two.?hand|\b2\s*hands?\b/i.test(item.system.notes ?? "")) modes.twoHanded = true;
  return modes;
}

export function weaponModifiers(actor, modes, kind) {
  const modifiers = [];
  const damage = kind === "damage";
  if (modes.wild && !actor.statuses?.has("wild-attack")) {
    const override = damage ? actor.getFlag?.("swade", "wildAttackDamage") : undefined;
    modifiers.push({label: sbsI18n("swade-hud.UI.WildAttack_90fb7b1f5f"), value: Number(override ?? 2)});
  }
  const desperate = modes.desperate4 ? 4 : modes.desperate2 ? 2 : 0;
  if (desperate && !modes.wild) modifiers.push({label: sbsI18n("swade-hud.UI.DesperateAttack_e1e0bf0460"), value: damage ? -desperate : desperate});
  if (damage && modes.charge) modifiers.push({label: sbsI18n("swade-hud.UI.MountedCharge_8efe85224f"), value: 4});
  if (!damage && modes.sweep && !modes.twoHanded) modifiers.push({label: sbsI18n("swade-hud.UI.Sweep_310b02ef1b"), value: -2});
  if (!damage && modes.nonlethal && modes.flatBlade) modifiers.push({label: sbsI18n("swade-hud.UI.NonlethalFlatofblade_f20cfeff92"), value: -1});
  return modifiers;
}

function traitScore(skill) {
  return [Number(skill?.system.die?.sides ?? 4), Number(skill?.modifier ?? skill?.system.die?.modifier ?? -2)];
}

export function mountedSkill(actor, item, action) {
  const variant = item.system.actions?.additional?.[action];
  const trait = variant?.override || item.system.actions?.trait;
  const find = name => actor.items.find(entry => entry.type === "skill"
    && [entry.name, entry.system.swid].some(candidate => candidate?.toLowerCase() === name));
  const fighting = find("fighting");
  if (!["fighting", fighting?.name?.toLowerCase()].includes(String(trait ?? "").trim().toLowerCase())) return;
  const riding = find("riding");
  const [fSides, fMod] = traitScore(fighting);
  const [rSides, rMod] = traitScore(riding);
  return rSides < fSides || (rSides === fSides && rMod < fMod) ? {skill: riding} : undefined;
}

export async function rollMountedAttack(actor, item, action, skill, additionalMods) {
  const helper = game.swade.itemChatCardHelper;
  const variant = item.system.actions?.additional?.[action];
  const uses = variant?.resourcesUsed ?? 1;
  if (item.canExpendResources?.(uses) === false) return ui.notifications.warn(game.i18n.localize("SWADE.NotEnoughAmmo"));
  additionalMods.push(...(item.traitModifiers ?? []));
  if (variant?.modifier) additionalMods.push({label: variant.name, value: variant.modifier});
  const roll = await helper.doTraitAction(skill, actor, {
    item, additionalMods, rof: variant?.dice, flavour: variant?.name || sbsI18n("swade-hud.UI.Horsebackattack_a748343307"),
  });
  if (roll && variant) await item.consume(uses);
  helper.callActionHook?.(actor, item, action, roll);
  return roll;
}

function resolvedModes(data, roll) {
  const modes = {...data.modes};
  const ignored = label => roll.modifiers?.some(mod => mod.label === label && mod.ignore);
  if (ignored(sbsI18n("swade-hud.UI.WildAttack_90fb7b1f5f"))) modes.wild = false;
  if (ignored(sbsI18n("swade-hud.UI.DesperateAttack_e1e0bf0460"))) modes.desperate2 = modes.desperate4 = false;
  if (ignored(sbsI18n("swade-hud.UI.MountedCharge_8efe85224f"))) modes.charge = false;
  return modes;
}

export async function withWeaponRoll(actor, item, kind, modes, mods, execute) {
  if (!options.some(option => modes[option.id]) || !globalThis.Hooks?.on) return execute();
  const data = {itemUuid: item.uuid, kind, modes, wildFromEffect: actor.statuses?.has("wild-attack") ?? false};
  const mark = (_actor, _trait, roll, _modifiers, rollOptions) => {
    if (rollOptions?.additionalMods !== mods || !roll.terms?.[0]) return;
    roll.terms[0].options ??= {};
    roll.terms[0].options[MARKER] = data;
  };
  const hooks = (kind === "damage" ? ["swadeRollDamage"] : ["swadePreRollSkill", "swadePreRollAttribute"])
    .map(name => [name, Hooks.on(name, mark)]);
  try {
    const roll = await execute();
    if (roll && kind === "attack" && resolvedModes(data, roll).wild && !data.wildFromEffect) {
      await applyTimedStatus(actor, "vulnerable", 1, "rounds");
    }
    return roll;
  } finally {
    for (const [name, id] of hooks) Hooks.off(name, id);
  }
}

export function decorateWeaponMessage(message, _data, _options, userId) {
  if (userId !== game.user.id) return;
  const roll = message.rolls?.[0];
  const data = roll?.terms?.[0]?.options?.[MARKER];
  if (!data) return;
  const modes = resolvedModes(data, roll);
  const update = {"flags.swade-hud.weaponOptions": {...data, modes}};
  if (data.kind === "attack" && game.modules.get("swade-tools")?.active) {
    if (modes.wild && !data.wildFromEffect) update["flags.swade-tools.wildattack"] = 1;
    else if (modes.desperate2 || modes.desperate4) update["flags.swade-tools.desperateattack"] = modes.desperate4 ? 4 : 2;
  }
  message.updateSource(update);
}

export function renderWeaponMessage(message, html, useItem) {
  const data = message.flags?.[MODULE_ID]?.weaponOptions;
  if (!data || !message.isContentVisible) return;
  const content = html.querySelector(".swade-roll-message");
  if (!content || content.querySelector(".swade-hud-weapon-summary")) return;
  const summary = document.createElement("div");
  summary.className = "swade-hud-weapon-summary";
  const labels = options.filter(option => data.modes[option.id]).map(option => option.label);
  summary.textContent = labels.join(" · ");
  if (data.kind === "damage" && data.modes.nonlethal) summary.append(sbsI18n("swade-hud.UI.OnIncapacitationunconsciousfor1d6hours_02b1d8cb1b"));
  const item = foundry.utils.fromUuidSync(data.itemUuid);
  if (data.kind === "attack" && item?.actor?.isOwner && item.system.damage) {
    const damage = document.createElement("button");
    damage.type = "button";
    damage.textContent = sbsI18n("swade-hud.UI.Rolldamagewiththeseoptions_a9c6c53132");
    damage.onclick = async event => {
      damage.disabled = true;
      try {
        await useItem(item.actor, item, "damage", event, {nativeOnly: true, inheritedWeaponOptions: data.modes});
      } catch (error) { ui.notifications.error(error.message); }
      finally { damage.disabled = false; }
    };
    summary.append(damage);
  }
  content.append(summary);
}
