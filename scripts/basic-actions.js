import {t as sbsI18n} from "./i18n.mjs";
import { ATTRIBUTES, MODULE_ID, itemsOf, localize, rollAttribute, rollSkill } from "./swade.js";
import { rollSupport, traitActionReceiver } from "./support.js";

const SETTING_MODULE = "swade-better-setting";
const CORE = "swade-core-rules";
const CORE_ACTIONS = new Set(["disarm", "grapple", "jump", "push", "treat-wounds", "suppressive-fire",
  "network-the-nice-way", "network-the-not-so-nice-way"]);
const CHASE_SKILLS = new Set(["athletics", "boating", "driving", "piloting", "riding"]);
export const COMMON_SKILL_ACTIONS = {get support() { return sbsI18n("swade-hud.UI.Support_be91940b79"); }, get test() { return sbsI18n("swade-hud.UI.Test_532eaabd95"); }, get earn() { return sbsI18n("swade-hud.UI.Earn_a697f90fb1"); }};
export function hustleProvider() {
  const money = game.modules?.get("swade-better-money")?.api;
  return money?.hustleEnabled?.() ? money : null;
}

export function commonSkillActionLabel(kind) {
  return kind === "earn" ? hustleProvider()?.hustleLabel() ?? sbsI18n("swade-hud.UI.Earn_a697f90fb1") : COMMON_SKILL_ACTIONS[kind];
}

export function basicActionLabel(item) {
  return actionKind(item) === "earn" ? hustleProvider()?.hustleLabel() ?? item.name : item.name;
}
const PER_SKILL = new Set(Object.keys(COMMON_SKILL_ACTIONS));
const TEST_RAISE_NOTE = sbsI18n("swade-hud.UI.YouwontheTestwitha_94bf6185fe");
const TEST_QUERY = "swade-hud.resolveTest";
const testResolutions = new Map();
const generating = new WeakMap();
const normalized = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim()
  .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

export function isUnskilledAttempt(skill) {
  return ["unskilled", "unskilled-attempt"].includes(normalized(skill.system.swid))
    || ["unskilled-attempt", normalized(localize("SWADE.Unskilled", sbsI18n("swade-hud.UI.UnskilledAttempt_63ecc95eac")))].includes(normalized(skill.name));
}

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
  const skills = itemsOf(actor, "skill").filter(skill => !isUnskilledAttempt(skill));
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
  ui.notifications.info(created.length ? "Added " + created.length + " basic actions." : sbsI18n("swade-hud.UI.Nonewbasicactionstoadd_8e40ddcc01"));
  if (!core.length) ui.notifications.warn(sbsI18n("swade-hud.UI.EnableSavageWorldsAdventureEditionCore_d2664045bb"));
  if (!supplement.length) ui.notifications.warn(sbsI18n("swade-hud.UI.BetterSettingActionsbecomesavailableafter_1a6f959c47"));
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

export async function rollCommonSkillAction(actor, skill, kind, targetingResolved = false) {
  if (!actor?.isOwner || !Object.hasOwn(COMMON_SKILL_ACTIONS, kind)) return;
  const targeting = game.modules.get("swade-better-setting")?.api?.withAdvancedTargeting;
  if (!targetingResolved && targeting && ["support", "test"].includes(kind)) {
    return targeting({actor, traitAction: true}, () => rollCommonSkillAction(actor, skill, kind, true));
  }
  const hustles = kind === "earn" && hustleProvider();
  if (hustles) return hustles.hustle(actor, skill);
  const target = actionTarget();
  const title = COMMON_SKILL_ACTIONS[kind];
  const execute = () => rollSkill(actor, skill.id, {
    title: title + " · " + skill.name, flavour: title,
    effectFlags: ["support", "test"].includes(kind) ? [kind] : [],
  });
  if (kind === "support") return rollSupport(actor, target, execute);
  const roll = await execute();
  if (kind === "earn") await resolveEarn(actor, roll);
  else await resolveTest(skill, roll, target);
  return roll;
}

async function resolveTest(skill, roll, target) {
  if (!roll) return;
  if (roll.isCritfail || !(roll.total >= 4)) return;
  const attribute = ATTRIBUTES.find(([key]) => key === skill?.system.attribute);
  if (!attribute) return ui.notifications.info(sbsI18n("swade-hud.UI.ResolvetheTestwiththeappropriate_b91daf382d"));
  const [key, label] = attribute;
  const name = localize(label, key);
  if (!target?.actor) {
    return ui.notifications.info("Test total " + roll.total + ". The defender opposes with " + name + ".");
  }
  const choice = await foundry.applications.api.DialogV2.wait({
    window: {title: "Resolve Test · " + target.name},
    content: `<p>${sbsI18n("swade-hud.UI.Opposewith_7ef5ec8bec")} ` + foundry.utils.escapeHTML(name) + " against " + roll.total + ".</p>",
    rejectClose: false,
    buttons: [
      {action: "distracted", label: sbsI18n("swade-hud.UI.Distracted_a3e6990bfc")},
      {action: "vulnerable", label: sbsI18n("swade-hud.UI.Vulnerable_cb44173a1e")},
    ]
  });
  if (!["distracted", "vulnerable"].includes(choice)) return;
  const message = game.messages.get(roll.messageId);
  if (!message) return ui.notifications.warn(sbsI18n("swade-hud.UI.ThecompletedTestrollcouldnot_d957f1085a"));
  const receiver = traitActionReceiver(target.actor, message);
  if (!receiver) return ui.notifications.warn(sbsI18n("swade-hud.UI.SharetheTestrollwitha_6e7afa9132"));
  await message.setFlag(MODULE_ID, "testRequest", {targetUuid: target.uuid, skillId: skill.id, choice});
  const resolved = receiver.id === game.user.id
    ? await resolveTestRequest(message, game.user)
    : await receiver.query(TEST_QUERY, {messageUuid: message.uuid});
  if (resolved && !message.getFlag(MODULE_ID, "testResolved")) await message.setFlag(MODULE_ID, "testResolved", true);
}

async function resolveTestRequest(message, user) {
  if (!message?.id || message.author?.id !== user.id) throw new Error(sbsI18n("swade-hud.UI.TheTestrollmustbelongto_c435ff355e"));
  if (message.isContentVisible === false) throw new Error(sbsI18n("swade-hud.UI.SharetheTestrollwiththe_8b87c0d32d"));
  if (message.getFlag(MODULE_ID, "testResolved")) return true;
  if (testResolutions.has(message.id)) return testResolutions.get(message.id);
  const request = message.getFlag(MODULE_ID, "testRequest");
  const source = ChatMessage.getSpeakerActor(message.speaker);
  const roll = message.rolls?.[0];
  const skill = source?.items.get(request?.skillId);
  const key = skill?.type === "skill" ? skill.system.attribute : null;
  if (!source?.testUserPermission(user, "OWNER") || !ATTRIBUTES.some(([id]) => id === key)
    || !["distracted", "vulnerable"].includes(request?.choice)
    || roll?.rollType !== "trait" || roll.isCritfail || !(roll.total >= 4)) {
    throw new Error(sbsI18n("swade-hud.UI.ResolvingaTestrequiresavalid_2845c8af3d"));
  }
  const operation = resistTest(message, request, key, roll.total);
  testResolutions.set(message.id, operation);
  try { return await operation; }
  finally { testResolutions.delete(message.id); }
}

async function resistTest(message, {targetUuid, choice}, key, total) {
  const token = await foundry.utils.fromUuid(targetUuid);
  const defender = token?.actor;
  if (token?.documentName !== "Token" || !defender?.isOwner || !defender.system.attributes?.[key]) {
    throw new Error(sbsI18n("swade-hud.UI.TheTesttargetisnolonger_6c13108875"));
  }
  const resistance = await rollAttribute(defender, key, {title: "Resist Test · " + token.name, flavour: sbsI18n("swade-hud.UI.ResistTest_040c5663d2"), effectFlags: ["test"]});
  if (!resistance) return false;
  if (resistance.isCritfail || resistance.total < total) {
    if (!defender.statuses.has(choice)) await defender.toggleActiveEffect(choice, {active: true});
    if (total - resistance.total >= 4) await game.messages.get(resistance.messageId)?.setFlag(MODULE_ID, "testRaise", true);
  }
  if (message.author.id === game.user.id || game.user.isGM) await message.setFlag(MODULE_ID, "testResolved", true);
  return true;
}

export function registerTestQuery() {
  CONFIG.queries[TEST_QUERY] = async ({messageUuid}, {user}) =>
    resolveTestRequest(await foundry.utils.fromUuid(messageUuid), user);
}

export function renderTestRaiseNote(message, html) {
  if (message.isContentVisible === false || !message.getFlag(MODULE_ID, "testRaise")) return;
  const content = html.querySelector(".message-content") ?? html;
  if (content.querySelector(".swade-hud-test-note")) return;
  const section = document.createElement("section");
  section.className = "sbe-roll-notes swade-hud-test-note";
  section.setAttribute("aria-label", sbsI18n("swade-hud.UI.Rollnote_34660ea579"));
  section.tabIndex = 0;
  const entry = document.createElement("div");
  entry.className = "sbe-roll-note";
  const label = document.createElement("strong");
  label.className = "sbe-roll-note-label";
  label.textContent = sbsI18n("swade-hud.UI.Test_532eaabd95");
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
      window: {title: sbsI18n("swade-hud.UI.EvadeChase_b4d0b91496")}, rejectClose: false,
      buttons: [{action: "free", label: sbsI18n("swade-hud.UI.Freeaction2_3dc3a1f062")}, {action: "action", label: sbsI18n("swade-hud.UI.Action4_eacd8a203b")}]
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
  if (roll.isCritfail && kind === "climb") return ui.notifications.warn(sbsI18n("swade-hud.UI.TheclimberfallsUseFallingdamage_a006857f49"));
  if (roll.isCritfail && kind === "swim") {
    if (!actor.effects.some(effect => effect.flags?.[MODULE_ID]?.drowning)) {
      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name: sbsI18n("swade-hud.UI.Drowning_6328ce017a"), type: "base", showIcon: 2, img: "icons/svg/hazard.svg",
        description: `<p>${sbsI18n("swade-hud.UI.CheckremainingbreaththenresolveUUID_f48270a523")}</p>`,
        system: {changes: []}, flags: {[MODULE_ID]: {drowning: true}}
      }]);
    }
    return ui.notifications.warn(sbsI18n("swade-hud.UI.TheswimmerstartstodrownCheck_edc14ce194"));
  }
  if (kind === "earn") return resolveEarn(actor, roll);
}

async function resolveEarn(actor, roll) {
  if (!roll || !actor.isOwner) return;
  if (roll.isCritfail) {
    ui.notifications.info(sbsI18n("swade-hud.UI.EarnfailedcriticallyResolveembarrassmentand_fefa2e81ed"));
    return;
  }
  if (roll.successes >= 1 && Number.isFinite(Number(actor.system.details?.currency))) {
    const ranks = ["novice", "seasoned", "veteran", "heroic", "legendary"];
    const rank = ranks.indexOf(normalized(actor.system.advances?.rank));
    const advances = Math.max(0, Number(actor.system.advances?.value) || 0);
    const tier = rank >= 0 ? rank + 1 : Math.min(5, Math.floor(advances / 4) + 1);
    const earnings = 100 * tier * (roll.successes >= 2 ? 2 : 1);
    const money = game.modules?.get("swade-better-money")?.api;
    if (await money?.receiveEarnings?.(actor, earnings)) return;
    await actor.update({"system.details.currency": Number(actor.system.details.currency) + earnings});
    ui.notifications.info(actor.name + " earned " + earnings + ".");
  } else if (roll.successes === 0 && actor.system.fatigue) {
    const {value, max} = actor.system.fatigue;
    await actor.update({"system.fatigue.value": Math.min(max, value + 1)});
  }
}
