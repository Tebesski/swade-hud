import {t as sbsI18n} from "./i18n.mjs";
import { rollAttribute, rollSkill } from "./swade.js";
import { findEdge, withActionEdges } from "./basic-actions.js";

export const EXTRAS = [
  ["falling", sbsI18n("swade-hud.UI.Fallingdamage_1f658c978e"), "fa-person-falling"],
  ["hold-breath", sbsI18n("swade-hud.UI.Holdbreath_90932dc968"), "fa-lungs"],
  ["natural-healing", sbsI18n("swade-hud.UI.NaturalHealing_0716896d47"), "fa-heart-pulse"],
  ["fear", sbsI18n("swade-hud.UI.Fearcheck_d7e567f7a8"), "fa-ghost"],
  ["evade", sbsI18n("swade-hud.UI.Evade_53e75daf07"), "fa-person-running"],
  ["hold", sbsI18n("swade-hud.UI.Hold_8e685d5409"), "fa-hand-back-fist"],
];

const HEALING_COOLDOWN = sbsI18n("swade-hud.UI.NaturalHealingCooldown_10b239039c");

function prompt(title, content, label, read) {
  return foundry.applications.api.DialogV2.prompt({
    window: {title}, content, rejectClose: false, ok: {label, callback: (_event, button) => read(button.form.elements)}
  });
}

export function fallingFormula(distance, snow, water) {
  const dice = Math.min(10, Math.floor(distance / 2));
  if (!dice || water === "raise") return "0";
  const damage = dice + "d6 + " + dice;
  // The SWADE damage roll applies acing to dice directly. Formula helpers nest their dice.
  const nestedDamage = dice + "d6x + " + dice;
  if (water === "success") return "floor((" + nestedDamage + ") / 2)";
  return snow > 0 ? "max(0, " + nestedDamage + " - " + snow + ")" : damage;
}

async function falling(actor, token) {
  const data = await prompt(sbsI18n("swade-hud.UI.Fallingdamage_1f658c978e"), `<div class="standard-form">
    <div class="form-group"><label for="swade-hud-fall-distance">${sbsI18n("swade-hud.UI.Distanceininches_530fa64892")}</label><input id="swade-hud-fall-distance" name="distance" type="number" min="0" step="any" value="2" required autofocus></div>
    <div class="form-group"><label for="swade-hud-fall-snow">${sbsI18n("swade-hud.UI.Softsnowinfeet_88defd39ab")}</label><input id="swade-hud-fall-snow" name="snow" type="number" min="0" step="1" value="0" required></div>
    <div class="form-group"><label for="swade-hud-fall-water">${sbsI18n("swade-hud.UI.Deepwater_97c373b8cd")}</label><input id="swade-hud-fall-water" name="water" type="checkbox"></div></div>`,
  "Calculate", fields => ({distance: fields.distance.valueAsNumber, snow: fields.snow.valueAsNumber, water: fields.water.checked}));
  if (!data) return;
  const {distance, snow, water} = data;
  if (!Number.isFinite(distance) || distance < 0 || !Number.isInteger(snow) || snow < 0) throw new Error(sbsI18n("swade-hud.UI.Enteravaliddistanceandsnow_0a394ebf36"));
  let result;
  if (water && distance > 0 && distance <= 10) {
    const athletics = actor.items.find(item => item.type === "skill" && (item.system.swid === "athletics" || item.name === "Athletics"));
    const roll = await rollSkill(actor, athletics?.id, {title: sbsI18n("swade-hud.UI.FallingintoWater_3c0510c6f3"), flavour: sbsI18n("swade-hud.UI.FallingintoWater_3c0510c6f3")});
    if (!roll) return;
    if (roll.successes >= 2) result = "raise";
    else if (roll.successes === 1) result = "success";
  }
  const formula = fallingFormula(distance, water ? 0 : snow, result);
  if (formula === "0") return ui.notifications.info(sbsI18n("swade-hud.UI.Nofallingdamage_40bac4c7d7"));
  const roll = new CONFIG.Dice.DamageRoll(formula, actor.getRollData(), {acing: true});
  return game.swade.RollDialog.asPromise({
    roll, mods: [], ap: 0, isHeavyWeapon: false, speaker: ChatMessage.getSpeaker({actor, token}),
    title: sbsI18n("swade-hud.UI.FallingDamage_4c0e132089"), flavor: "Falling Damage · " + distance + "″"
  });
}

async function holdBreath(actor, token) {
  const vigor = Number(actor.system.attributes?.vigor?.die?.sides);
  if (!Number.isFinite(vigor) || vigor <= 0) throw new Error(sbsI18n("swade-hud.UI.ThisactorneedsaVigordie_6008a19d0d"));
  const prepared = await prompt(sbsI18n("swade-hud.UI.Holdbreath_90932dc968"), `<label><input type="checkbox" name="prepared" checked> ${sbsI18n("swade-hud.UI.Hadtimetotakeabreath_56c9991d02")}</label>`,
    sbsI18n("swade-hud.UI.Holdbreath_90932dc968"), fields => ({value: fields.prepared.checked}));
  if (!prepared) return;
  const rounds = Math.floor((2 + vigor) / (prepared.value ? 1 : 2));
  const duration = {value: rounds, units: "rounds", expiry: "turnEnd", expired: false};
  const start = CONFIG.ActiveEffect.documentClass.getEffectStart();
  const description = `<p>${sbsI18n("swade-hud.UI.Holdingbreathfor_0c91df435c")} ` + rounds + " rounds.</p>";
  const existing = actor.effects.find(effect => effect.flags?.["swade-hud"]?.holdBreath);
  if (existing) return existing.update({description, duration, start, disabled: false});
  return actor.createEmbeddedDocuments("ActiveEffect", [{
    name: sbsI18n("swade-hud.UI.Holdbreath_90932dc968"), type: "base", img: "icons/svg/clockwork.svg", showIcon: 2,
    description, origin: token?.uuid ?? actor.uuid,
    transfer: false, disabled: false, duration, start, system: {changes: [], removeEffect: true},
    flags: {"swade-hud": {holdBreath: true}},
  }]);
}

export function naturalHealingCooldown(actor) {
  return actor.effects.find(effect => {
    if (!effect.flags?.["swade-hud"]?.naturalHealingCooldown && effect.name !== HEALING_COOLDOWN) return false;
    effect.updateDuration?.();
    return !effect.duration?.expired && (effect.duration?.secondsRemaining ?? Infinity) > 0;
  });
}

async function naturalHealing(actor) {
  const money = game.modules.get("swade-better-money")?.api;
  if (money?.canHealNaturally?.(actor) === false) {
    return ui.notifications.warn(sbsI18n("swade-hud.UI.ThischaractersupkeeppreventsNatural_d8c9425503"));
  }
  if (naturalHealingCooldown(actor)) return ui.notifications.info(sbsI18n("swade-hud.UI.NaturalHealingisoncooldown_d65c326326"));
  if (!actor.system.wounds?.value) return ui.notifications.info(sbsI18n("swade-hud.UI.Thisactorhasnowoundsto_b56a16480e"));
  const edge = findEdge(actor, "fast-healer");
  const additionalMods = [];
  const title = "Natural Healing · every " + (edge ? 3 : 5) + " days";
  const roll = await withActionEdges(actor, additionalMods, edge ? [[edge, 2]] : [],
    () => rollAttribute(actor, "vigor", {title, flavour: sbsI18n("swade-hud.UI.NaturalHealing_0716896d47"), additionalMods}));
  if (!roll || !actor.isOwner) return;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: HEALING_COOLDOWN, type: "base", img: "icons/svg/clockwork.svg", showIcon: 2,
    description: sbsI18n("swade-hud.UI.NaturalHealingbecomesavailableafter12_0faac18c16"), origin: actor.uuid,
    duration: {value: 12, units: "hours"}, start: CONFIG.ActiveEffect.documentClass.getEffectStart(),
    system: {changes: [], removeEffect: true}, flags: {"swade-hud": {naturalHealingCooldown: true}},
  }]);
  const {value, max} = actor.system.wounds;
  if (roll.isCritfail) {
    await actor.update({"system.wounds.value": Math.min(max + 1, value + 1)});
    if (value >= max) {
      await actor.toggleActiveEffect("incapacitated", {active: true});
      ui.notifications.warn(sbsI18n("swade-hud.UI.NaturalHealingcausedIncapacitationResolvethe_4531bb211e"));
    }
  } else if (roll.successes >= 1) {
    await actor.update({"system.wounds.value": Math.max(0, value - Math.min(2, roll.successes))});
  }
}

async function fear(actor, token) {
  const pack = game.packs.get("swade-core-rules.swade-macros");
  const index = await pack?.getIndex();
  const entry = index?.find(document => document.name === "Fear Table");
  const macro = entry && await pack.getDocument(entry._id);
  if (!macro) throw new Error(sbsI18n("swade-hud.UI.EnableSavageWorldsAdventureEditionCore_32904bdb2c"));
  return macro.execute({actor, token: token?.object});
}

function evade(actor) {
  const edge = findEdge(actor, "improved-dodge");
  const additionalMods = [{label: sbsI18n("swade-hud.UI.Evasion_3643dd816b"), value: -2}];
  return withActionEdges(actor, additionalMods, edge ? [[edge, 2]] : [],
    () => rollAttribute(actor, "agility", {title: sbsI18n("swade-hud.UI.Evade_53e75daf07"), flavour: sbsI18n("swade-hud.UI.Evade_53e75daf07"), additionalMods}));
}

export function holdCombatant(actor, token) {
  const combat = game.combat;
  if (!combat?.started) return;
  const matches = combatant => combatant?.actor?.uuid === actor.uuid && (!token || combatant.tokenId === token.id);
  if (matches(combat.combatant)) return combat.combatant;
  const candidates = combat.combatants.filter(matches);
  if (candidates.length === 1) return candidates[0];
}

async function hold(actor, token, {after = false} = {}) {
  const combat = game.combat;
  const combatant = holdCombatant(actor, token);
  if (combatant?.roundHeld) {
    if (!game.user.isGM) return ui.notifications.info(sbsI18n("swade-hud.UI.OnlytheGMcanactfrom_2344610dcb"));
    if (!combat.combatant || (combat.combatant === combatant && combat.round === combatant.roundHeld)) {
      return ui.notifications.info(sbsI18n("swade-hud.UI.Advancetoanothercombatantsturn_b6854a0406"));
    }
    return after ? combatant.actAfterCurrentCombatant() : combatant.actNow();
  }
  if (after) return;
  if (!combatant?.isOwner || combatant !== combat.combatant || combatant.group || combatant.turnLost) {
    return ui.notifications.info(sbsI18n("swade-hud.UI.Holdisavailableonthecombatant_9dd42387a0"));
  }
  return combatant.toggleHold();
}

const handlers = {falling, "hold-breath": holdBreath, "natural-healing": naturalHealing, fear, evade, hold};
const running = new WeakMap();
export async function runExtra(actor, token, key, options) {
  if (!actor?.isOwner || !Object.hasOwn(handlers, key)) return;
  const active = running.get(actor) ?? new Set();
  if (active.has(key)) return;
  active.add(key);
  running.set(actor, active);
  try { return await handlers[key](actor, token, options); }
  finally { active.delete(key); }
}
