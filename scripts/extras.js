import { rollAttribute, rollSkill } from "./swade.js";
import { findEdge, withActionEdges } from "./basic-actions.js";

export const EXTRAS = [
  ["falling", "Falling damage", "fa-person-falling"],
  ["hold-breath", "Hold breath", "fa-lungs"],
  ["natural-healing", "Natural Healing", "fa-heart-pulse"],
  ["fear", "Fear check", "fa-ghost"],
  ["evade", "Evade", "fa-person-running"],
  ["hold", "Hold", "fa-hand-back-fist"],
];

const HEALING_COOLDOWN = "Natural Healing Cooldown";

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
  const data = await prompt("Falling damage", `<div class="standard-form">
    <div class="form-group"><label for="swade-hud-fall-distance">Distance in inches</label><input id="swade-hud-fall-distance" name="distance" type="number" min="0" step="any" value="2" required autofocus></div>
    <div class="form-group"><label for="swade-hud-fall-snow">Soft snow in feet</label><input id="swade-hud-fall-snow" name="snow" type="number" min="0" step="1" value="0" required></div>
    <div class="form-group"><label for="swade-hud-fall-water">Deep water</label><input id="swade-hud-fall-water" name="water" type="checkbox"></div></div>`,
  "Calculate", fields => ({distance: fields.distance.valueAsNumber, snow: fields.snow.valueAsNumber, water: fields.water.checked}));
  if (!data) return;
  const {distance, snow, water} = data;
  if (!Number.isFinite(distance) || distance < 0 || !Number.isInteger(snow) || snow < 0) throw new Error("Enter a valid distance and snow depth.");
  let result;
  if (water && distance > 0 && distance <= 10) {
    const athletics = actor.items.find(item => item.type === "skill" && (item.system.swid === "athletics" || item.name === "Athletics"));
    const roll = await rollSkill(actor, athletics?.id, {title: "Falling into Water", flavour: "Falling into Water"});
    if (!roll) return;
    if (roll.successes >= 2) result = "raise";
    else if (roll.successes === 1) result = "success";
  }
  const formula = fallingFormula(distance, water ? 0 : snow, result);
  if (formula === "0") return ui.notifications.info("No falling damage.");
  const roll = new CONFIG.Dice.DamageRoll(formula, actor.getRollData(), {acing: true});
  return game.swade.RollDialog.asPromise({
    roll, mods: [], ap: 0, isHeavyWeapon: false, speaker: ChatMessage.getSpeaker({actor, token}),
    title: "Falling Damage", flavor: "Falling Damage · " + distance + "″"
  });
}

async function holdBreath(actor, token) {
  const vigor = Number(actor.system.attributes?.vigor?.die?.sides);
  if (!Number.isFinite(vigor) || vigor <= 0) throw new Error("This actor needs a Vigor die to hold their breath.");
  const prepared = await prompt("Hold breath", `<label><input type="checkbox" name="prepared" checked> Had time to take a breath</label>`,
    "Hold breath", fields => ({value: fields.prepared.checked}));
  if (!prepared) return;
  const rounds = Math.floor((2 + vigor) / (prepared.value ? 1 : 2));
  const duration = {value: rounds, units: "rounds", expiry: "turnEnd", expired: false};
  const start = CONFIG.ActiveEffect.documentClass.getEffectStart();
  const description = "<p>Holding breath for " + rounds + " rounds.</p>";
  const existing = actor.effects.find(effect => effect.flags?.["swade-hud"]?.holdBreath);
  if (existing) return existing.update({description, duration, start, disabled: false});
  return actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Hold breath", type: "base", img: "icons/svg/clockwork.svg", showIcon: 2,
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
  if (naturalHealingCooldown(actor)) return ui.notifications.info("Natural Healing is on cooldown.");
  if (!actor.system.wounds?.value) return ui.notifications.info("This actor has no wounds to heal.");
  const edge = findEdge(actor, "fast-healer");
  const additionalMods = [];
  const title = "Natural Healing · every " + (edge ? 3 : 5) + " days";
  const roll = await withActionEdges(actor, additionalMods, edge ? [[edge, 2]] : [],
    () => rollAttribute(actor, "vigor", {title, flavour: "Natural Healing", additionalMods}));
  if (!roll || !actor.isOwner) return;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: HEALING_COOLDOWN, type: "base", img: "icons/svg/clockwork.svg", showIcon: 2,
    description: "Natural Healing becomes available after 12 in-game hours.", origin: actor.uuid,
    duration: {value: 12, units: "hours"}, start: CONFIG.ActiveEffect.documentClass.getEffectStart(),
    system: {changes: [], removeEffect: true}, flags: {"swade-hud": {naturalHealingCooldown: true}},
  }]);
  const {value, max} = actor.system.wounds;
  if (roll.isCritfail) {
    await actor.update({"system.wounds.value": Math.min(max + 1, value + 1)});
    if (value >= max) {
      await actor.toggleActiveEffect("incapacitated", {active: true});
      ui.notifications.warn("Natural Healing caused Incapacitation. Resolve the 12-hour Vigor checks.");
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
  if (!macro) throw new Error("Enable Savage Worlds Adventure Edition Core Rules for the Fear Table macro.");
  return macro.execute({actor, token: token?.object});
}

function evade(actor) {
  const edge = findEdge(actor, "improved-dodge");
  const additionalMods = [{label: "Evasion", value: -2}];
  return withActionEdges(actor, additionalMods, edge ? [[edge, 2]] : [],
    () => rollAttribute(actor, "agility", {title: "Evade", flavour: "Evade", additionalMods}));
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
    if (!game.user.isGM) return ui.notifications.info("Only the GM can act from Hold.");
    if (!combat.combatant || (combat.combatant === combatant && combat.round === combatant.roundHeld)) {
      return ui.notifications.info("Advance to another combatant’s turn before acting from Hold.");
    }
    return after ? combatant.actAfterCurrentCombatant() : combatant.actNow();
  }
  if (after) return;
  if (!combatant?.isOwner || combatant !== combat.combatant || combatant.group || combatant.turnLost) {
    return ui.notifications.info("Hold is available on the combatant’s turn.");
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
