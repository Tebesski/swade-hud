import { ATTRIBUTES, MODULE_ID, itemsOf, localize, rollAttribute, rollSkill } from "./swade.js";
import { rollSupport } from "./support.js";

const SETTING_MODULE = "swade-better-setting";
const CORE = "swade-core-rules";
const CORE_ACTIONS = new Set(["disarm", "grapple", "jump", "push", "treat-wounds", "suppressive-fire",
  "network-the-nice-way", "network-the-not-so-nice-way"]);
const CHASE_SKILLS = new Set(["athletics", "boating", "driving", "piloting", "riding"]);
const PER_SKILL = new Set(["support", "test", "earn"]);
const TEST_RAISE_NOTE = "You won the Test with a raise. The target is also Shaken or there may be other subjective effects as the GM allows, such as a tripped foe being knocked prone.";
const generating = new WeakMap();
const normalized = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim()
  .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

function skillMatches(skill, value) {
  const name = normalized(value);
  return name && [skill.id, skill.name, skill.system.swid].some(candidate => normalized(candidate) === name);
}

export function isOpposedAction(action) {
  return action?.type === "resist" || /^(oppose\b|resist\b|avoid prone\b)/i.test(action?.name?.trim() ?? "");
}

export function actionUsesSkill(item) {
  const actions = item.system.actions;
  const traits = [actions?.trait, ...Object.values(actions?.additional ?? {})
    .filter(action => action.type === "trait" && !isOpposedAction(action)).map(action => action.override)];
  return traits.some(trait => trait?.trim() && !ATTRIBUTES.some(([key, label]) =>
    [key, localize(label, key)].some(attribute => normalized(attribute) === normalized(trait))));
}

export function skillActions(actor, skill) {
  const matches = [];
  for (const item of itemsOf(actor, "action", "ability")) {
    if (item.system.hidden) continue;
    const actions = item.system.actions;
    if (skillMatches(skill, actions?.trait)) matches.push({ item, action: "formula", label: item.name });
    for (const [key, entry] of Object.entries(actions?.additional ?? {})) {
      if (entry.type !== "trait" || isOpposedAction(entry) || !skillMatches(skill, entry.override || actions.trait)) continue;
      matches.push({ item, action: key, label: item.name, variant: entry.name });
    }
  }
  return matches;
}

export async function coreSkillDocument(skill) {
  const pack = game.packs?.get(CORE + ".swade-skills");
  if (!pack || pack.visible === false) return skill;
  try {
    const index = await pack.getIndex({ fields: ["system.swid"] });
    const match = index.find(entry => skillMatches(skill, entry.name) || skillMatches(skill, entry.system?.swid));
    return (match && await pack.getDocument(match._id)) || skill;
  } catch (error) {
    console.warn("SWADE HUD | Core Rules skill lookup failed", error);
    return skill;
  }
}

function copyAction(document, { skill, kind, suffix = false } = {}) {
  const data = document.toObject();
  for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) delete data[key];
  const sourceId = document.flags?.[SETTING_MODULE]?.basicAction ?? (document.system.swid || normalized(document.name));
  const id = skill ? sourceId + ":" + (skill.system.swid || normalized(skill.name)) : sourceId;
  data.flags ??= {};
  data.flags[MODULE_ID] = { basicAction: id, actionKind: kind ?? sourceId };
  data.flags.core = { ...data.flags.core, sourceId: document.uuid };
  data.system.actions ??= {};
  if (skill) {
    data.system.actions.trait = skill.name;
    if (suffix) data.name += " (" + skill.name + ")";
  }
  return data;
}

export function generateBasicActions(actor) {
  if (!actor?.isOwner) return;
  if (generating.has(actor)) return generating.get(actor);
  const operation = addBasicActions(actor);
  generating.set(actor, operation);
  operation.finally(() => generating.delete(actor)).catch(() => {});
  return operation;
}

async function addBasicActions(actor) {
  const corePack = game.packs?.get(CORE + ".swade-actions");
  const setting = game.modules.get(SETTING_MODULE)?.api;
  const [core, supplement] = await Promise.all([
    corePack?.visible !== false ? corePack?.getDocuments() ?? [] : [],
    setting?.libraryActions?.() ?? game.packs?.get("world.better-setting-actions")?.getDocuments() ?? [],
  ]);
  const skills = itemsOf(actor, "skill").filter(skill => !["unskilled", "unskilled-attempt"].includes(normalized(skill.system.swid || skill.name)));
  const chaseSkills = skills.filter(skill => CHASE_SKILLS.has(normalized(skill.system.swid || skill.name)));
  const candidates = core.filter(item => item.type === "action" && CORE_ACTIONS.has(normalized(item.name))).map(item => copyAction(item));
  for (const item of supplement.filter(item => item.type === "action")) {
    const kind = item.flags?.[SETTING_MODULE]?.actionKind ?? normalized(item.name);
    if (kind === "each-skill" || PER_SKILL.has(kind)) {
      for (const skill of skills) candidates.push(copyAction(item, { skill, kind: normalized(item.name), suffix: true }));
    } else if (kind === "chase" && chaseSkills.length) {
      for (const skill of chaseSkills) candidates.push(copyAction(item, { skill, kind, suffix: chaseSkills.length > 1 }));
    } else candidates.push(copyAction(item, { kind }));
  }
  const existing = itemsOf(actor, "action");
  const keys = new Set(existing.map(item => item.flags?.[MODULE_ID]?.basicAction).filter(Boolean));
  const names = new Set(existing.map(item => normalized(item.name)));
  const data = candidates.filter(item => {
    const key = item.flags[MODULE_ID].basicAction;
    const name = normalized(item.name);
    if (keys.has(key) || names.has(name)) return false;
    keys.add(key);
    names.add(name);
    return true;
  });
  if (!actor.isOwner) return;
  const created = data.length ? await actor.createEmbeddedDocuments("Item", data) : [];
  ui.notifications.info(created.length ? "Added " + created.length + " basic actions." : "No new basic actions to add.");
  if (!core.length) ui.notifications.warn("Enable Savage Worlds Adventure Edition Core Rules to import its actions.");
  if (!supplement.length) ui.notifications.warn("Better Setting — Actions becomes available after a GM initializes the compendium.");
  return created;
}

export function actionKind(item) {
  return item.flags?.[MODULE_ID]?.actionKind ?? item.flags?.[SETTING_MODULE]?.actionKind;
}

export function findEdge(actor, ...ids) {
  return itemsOf(actor, "edge").find(item => ids.includes(normalized(item.system.swid)) || ids.includes(normalized(item.name)));
}

export async function withActionEdges(actor, mods, edges, execute) {
  if (!edges.length || !globalThis.Hooks?.on) return execute();
  const apply = (rollingActor, _trait, _roll, modifiers, options) => {
    if (rollingActor !== actor || options?.additionalMods !== mods) return;
    for (const [edge, value] of edges) {
      const modifier = modifiers.find(entry => normalized(entry.label) === normalized(edge.name));
      if (modifier) modifier.ignore = false;
      else modifiers.push({label: edge.name, value});
    }
  };
  const names = ["swadePreRollSkill", "swadePreRollAttribute"];
  const ids = names.map(name => Hooks.on(name, apply));
  try { return await execute(); }
  finally { names.forEach((name, index) => Hooks.off(name, ids[index])); }
}

export function basicActionEdges(actor, item) {
  const kind = actionKind(item);
  const name = normalized(item.name);
  const athletics = normalized(item.system.actions?.trait) === "athletics";
  const edge = kind === "evade" ? findEdge(actor, "improved-dodge")
    : (kind === "climb" || name === "climb-giant-foe" || (kind === "chase" && athletics)) ? findEdge(actor, "free-runner") : null;
  return edge ? [[edge, 2]] : [];
}

export function actionTarget() {
  const targets = [...(game.user.targets ?? [])];
  return targets.length === 1 ? targets[0].document ?? targets[0] : null;
}

export async function rollCommonSkillAction(actor, skill, kind) {
  const target = actionTarget();
  const title = {support: "Support", test: "Test", earn: "Earn"}[kind];
  const execute = () => rollSkill(actor, skill.id, {title: title + " · " + skill.name, flavour: title});
  if (kind === "support") return rollSupport(target, execute);
  const roll = await execute();
  if (kind === "earn") await resolveEarn(actor, roll);
  else await resolveTest(skill, roll, target);
  return roll;
}

async function resolveTest(skill, roll, target) {
  if (!roll) return;
  if (roll.isCritfail || !(roll.total >= 4)) return;
  const attribute = ATTRIBUTES.find(([key]) => key === skill?.system.attribute);
  if (!attribute) return ui.notifications.info("Resolve the Test with the appropriate opposed attribute.");
  const defender = target?.actor;
  const [key, label] = attribute;
  const name = localize(label, key);
  if (!defender?.isOwner || !defender.system.attributes?.[key]) {
    return ui.notifications.info("Test total " + roll.total + ". The defender opposes with " + name + ".");
  }
  const choice = await foundry.applications.api.DialogV2.wait({
    window: {title: "Resolve Test · " + target.name},
    content: "<p>Oppose with " + foundry.utils.escapeHTML(name) + " against " + roll.total + ".</p>",
    rejectClose: false,
    buttons: [
      {action: "distracted", label: "Roll · Distracted on a loss"},
      {action: "vulnerable", label: "Roll · Vulnerable on a loss"},
    ]
  });
  if (!["distracted", "vulnerable"].includes(choice)) return;
  const resistance = await rollAttribute(defender, key, {title: "Resist Test", flavour: "Resist Test"});
  if (!resistance || !defender.isOwner || (!resistance.isCritfail && resistance.total >= roll.total)) return;
  if (!defender.statuses.has(choice)) await defender.toggleActiveEffect(choice, {active: true});
  if (roll.total - resistance.total >= 4) {
    const message = game.messages.get(resistance.messageId);
    if (message) await message.setFlag(MODULE_ID, "testRaise", true);
  }
}

export function renderTestRaiseNote(message, html) {
  if (message.isContentVisible === false || !message.getFlag(MODULE_ID, "testRaise")) return;
  const content = html.querySelector(".message-content") ?? html;
  if (content.querySelector(".swade-hud-test-note")) return;
  const section = document.createElement("section");
  section.className = "sbe-roll-notes swade-hud-test-note";
  section.setAttribute("aria-label", "Roll note");
  section.tabIndex = 0;
  const entry = document.createElement("div");
  entry.className = "sbe-roll-note";
  const label = document.createElement("strong");
  label.className = "sbe-roll-note-label";
  label.textContent = "Test";
  const body = document.createElement("p");
  body.className = "sbe-roll-note-body";
  body.textContent = TEST_RAISE_NOTE;
  entry.append(label, body);
  section.append(entry);
  content.append(section);
}

export async function runChaseAction(actor, item) {
  const kind = actionKind(item);
  const evade = kind === "chase-evade";
  let value = 2;
  if (evade) {
    const choice = await foundry.applications.api.DialogV2.wait({
      window: {title: "Evade (Chase)"}, rejectClose: false,
      buttons: [{action: "free", label: "Free action (−2)"}, {action: "action", label: "Action (−4)"}]
    });
    if (!choice) return;
    value = choice === "action" ? -4 : -2;
  }
  const changes = [{key: "system.stats.globalMods.targetAttack", type: "add", value, phase: "initial"}];
  if (evade) changes.push({key: "system.stats.globalMods.attack", type: "add", value, phase: "initial"});
  const duration = {value: 1, units: "rounds", expiry: "turnStart", expired: false};
  const start = CONFIG.ActiveEffect.documentClass.getEffectStart();
  const existing = actor.effects.find(effect => effect.flags?.[MODULE_ID]?.chaseAction === item.id);
  const flags = {[MODULE_ID]: {chaseAction: item.id, chaseKind: kind}};
  if (existing) return existing.update({duration, start, disabled: false, "system.changes": changes, flags});
  return actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name, img: item.img, type: "base", showIcon: 2, duration, start,
    description: item.system.description,
    system: {changes, removeEffect: true}, flags
  }]);
}

export function adjustChaseAttackModifiers(source, target, _skill, item, _ranged, _melee, modifiers) {
  const steady = actor => actor?.effects?.find(effect => effect.active && effect.flags?.[MODULE_ID]?.chaseKind === "chase-steady");
  const ignored = new Set();
  if (steady(source?.actor) || steady(item?.actor)) {
    for (const key of ["SWADE.Running", "SWADE.UnstablePlatform"]) {
      ignored.add(key);
      ignored.add(localize(key));
    }
  }
  const defender = steady(target?.actor);
  if (defender && target.hasStatusEffect?.("vulnerable")) ignored.add(defender.name);
  for (let i = modifiers.length - 1; i >= 0; i--) if (ignored.has(modifiers[i].label)) modifiers.splice(i, 1);
}

export async function resolveBasicAction(actor, item, roll, target) {
  if (!roll || !actor.isOwner) return;
  const kind = actionKind(item);
  if (kind === "intimidation" && game.combat?.started) {
    const skill = itemsOf(actor, "skill").find(entry => skillMatches(entry, "intimidation"));
    return resolveTest(skill, roll, target);
  }
  if (kind === "test") {
    const skill = itemsOf(actor, "skill").find(entry => skillMatches(entry, item.system.actions?.trait));
    return resolveTest(skill, roll, target);
  }
  if (roll.isCritfail && kind === "climb") return ui.notifications.warn("The climber falls. Use Falling damage in Extras.");
  if (roll.isCritfail && kind === "swim") {
    if (!actor.effects.some(effect => effect.flags?.[MODULE_ID]?.drowning)) {
      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name: "Drowning", type: "base", showIcon: 2, img: "icons/svg/hazard.svg",
        description: "<p>Check remaining breath, then resolve @UUID[Compendium.swade-core-rules.swade-rules.JournalEntry.swadecor04theadv.JournalEntryPage.04drowning000000]{Drowning}.</p>",
        system: {changes: []}, flags: {[MODULE_ID]: {drowning: true}}
      }]);
    }
    return ui.notifications.warn("The swimmer starts to drown. Check Hold breath and the Drowning rules.");
  }
  if (kind === "earn") return resolveEarn(actor, roll);
}

async function resolveEarn(actor, roll) {
  if (!roll || !actor.isOwner) return;
  if (roll.isCritfail) {
    ui.notifications.info("Earn failed critically. Resolve embarrassment and any dangerous-job wounds.");
    return;
  }
  if (roll.successes >= 1 && Number.isFinite(Number(actor.system.details?.currency))) {
    const ranks = ["novice", "seasoned", "veteran", "heroic", "legendary"];
    const rank = ranks.indexOf(normalized(actor.system.advances?.rank));
    const advances = Math.max(0, Number(actor.system.advances?.value) || 0);
    const tier = rank >= 0 ? rank + 1 : Math.min(5, Math.floor(advances / 4) + 1);
    const earnings = 100 * tier * (roll.successes >= 2 ? 2 : 1);
    await actor.update({"system.details.currency": Number(actor.system.details.currency) + earnings});
    ui.notifications.info(actor.name + " earned " + earnings + ".");
  } else if (roll.successes === 0 && actor.system.fatigue) {
    const {value, max} = actor.system.fatigue;
    await actor.update({"system.fatigue.value": Math.min(max, value + 1)});
  }
}
