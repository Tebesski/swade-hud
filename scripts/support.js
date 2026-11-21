import {t as sbsI18n} from "./i18n.mjs";
import { ATTRIBUTES, MODULE_ID, itemsOf, localize } from "./swade.js";
import { importSwadeTools } from "./tools-imports.js";

const QUERY = "swade-hud.applySupport";
const MARKER = "swadeHudSupport";
const grants = new Map();

function supportTraits(actor) {
  return [
    [sbsI18n("swade-hud.UI.Attributes_4b0ed88f7d"), ATTRIBUTES.filter(([key]) => actor.system.attributes?.[key])
      .map(([key, label]) => ({kind: "attribute", key, name: localize(label, key)}))],
    [sbsI18n("swade-hud.UI.Skills_66d0f523a3"), itemsOf(actor, "skill").sort((a, b) => a.name.localeCompare(b.name))
      .map(item => ({kind: "skill", key: item.id, name: item.name}))],
  ];
}

export function traitActionReceiver(actor, message) {
  if (actor.isOwner) return game.user;
  const canResolve = user => user?.active && (!message?.whisper?.length || message.whisper.includes(user.id))
    && actor.testUserPermission(user, "OWNER");
  const gm = game.users?.activeGM;
  return game.users?.find(user => !user.isGM && canResolve(user))
    ?? (canResolve(gm) ? gm : game.users?.find(canResolve));
}

export async function rollSupport(actor, target, execute) {
  if (!target?.actor) {
    const allies = (globalThis.canvas?.tokens?.placeables ?? []).filter(token => token.actor && token.actor.uuid !== actor.uuid
      && token.visible !== false && token.isVisible !== false
      && (token.actor.isOwner || token.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY));
    if (!allies.length) return ui.notifications.warn(sbsI18n("swade-hud.UI.TargetanallytoSupport_058425e1a0"));
    const id = await foundry.applications.api.DialogV2.prompt({
      window: {title: sbsI18n("swade-hud.UI.Support_be91940b79")}, rejectClose: false,
      content: `<label>Ally to Support <select name="target" autofocus>` + allies.map(token =>
        `<option value="${foundry.utils.escapeHTML(token.id)}">${foundry.utils.escapeHTML(token.name)}</option>`).join("")
        + "</select></label>",
      ok: {label: sbsI18n("swade-hud.UI.ChooseTrait_9228991791"), callback: (_event, button) => button.form.elements.namedItem("target").value},
    });
    target = allies.find(token => token.id === id)?.document;
    if (!target?.actor) return;
  }
  if (target.actor.uuid === actor.uuid) return ui.notifications.warn(sbsI18n("swade-hud.UI.ChooseanotheractortoSupport_8450bfcfdd"));
  const groups = supportTraits(target.actor).filter(([, traits]) => traits.length);
  if (!groups.length) return ui.notifications.warn(sbsI18n("swade-hud.UI.Thistargethasnotraitsto_0445538c53"));

  const escape = foundry.utils.escapeHTML;
  const content = groups.map(([group, traits]) => `<optgroup label="${group}">${traits.map(({kind, key, name}) =>
    `<option value="${kind}:${escape(key)}">${escape(name)}</option>`).join("")}</optgroup>`).join("");
  const selection = await foundry.applications.api.DialogV2.prompt({
    window: {title: "Support · " + target.name}, rejectClose: false,
    content: `<label>${sbsI18n("swade-hud.UI.TraittoSupport_a23977f7a4")} <select name="trait" required autofocus>${content}</select></label>`,
    ok: {label: sbsI18n("swade-hud.UI.RollSupport_e88a7f81bf"), callback: (_event, button) => button.form.elements.namedItem("trait").value},
  });
  if (!selection) return;
  const [kind, key] = selection.split(":");
  const roll = await execute();
  if (!roll) return;
  if (roll.isCritfail) ui.notifications.info(sbsI18n("swade-hud.UI.SupportcriticallyfailedResolvethe2_24ef021da7"));
  if (roll.isCritfail || !(roll.successes >= 1)) return roll;
  const message = game.messages.get(roll.messageId);
  if (!message) throw new Error(sbsI18n("swade-hud.UI.ThecompletedSupportrollcouldnot_abc42dfa95"));
  const receiver = traitActionReceiver(target.actor, message);
  if (!receiver) return ui.notifications.warn(sbsI18n("swade-hud.UI.SharetheSupportrollwitha_6966e67249"));
  await message.setFlag(MODULE_ID, "supportGrant", {targetUuid: target.uuid, kind, key});
  if (target.actor.isOwner) await applySupport(message, game.user);
  else {
    await receiver.query(QUERY, {messageUuid: message.uuid});
    if (!message.getFlag(MODULE_ID, "supportApplied")) await message.setFlag(MODULE_ID, "supportApplied", true);
  }
  return roll;
}

function applySupport(message, user) {
  if (!message?.id || message.author?.id !== user.id) throw new Error(sbsI18n("swade-hud.UI.TheSupportrollmustbelongto_207b432c30"));
  if (grants.has(message.id)) return grants.get(message.id);
  const operation = createSupportEffect(message, user);
  grants.set(message.id, operation);
  operation.finally(() => grants.delete(message.id)).catch(() => {});
  return operation;
}

async function createSupportEffect(message, user) {
  if (message.getFlag(MODULE_ID, "supportApplied")) return;
  const source = ChatMessage.getSpeakerActor(message.speaker);
  const roll = message.rolls?.[0];
  const grant = message.getFlag(MODULE_ID, "supportGrant");
  if (!source?.testUserPermission(user, "OWNER") || !grant || roll?.rollType !== "trait" || roll.isCritfail || !(roll.successes >= 1)) {
    throw new Error(sbsI18n("swade-hud.UI.SupportrequiresasuccessfulTraitroll_d73a34b526"));
  }
  const token = await foundry.utils.fromUuid(grant.targetUuid);
  const actor = token?.actor;
  if (!actor?.isOwner || token.documentName !== "Token") throw new Error(sbsI18n("swade-hud.UI.TheSupporttargetisnolonger_1aa84666d7"));
  const trait = supportTraits(actor).flatMap(([, entries]) => entries).find(entry => entry.kind === grant.kind && entry.key === grant.key);
  if (!trait) throw new Error(sbsI18n("swade-hud.UI.Thechosentraitisnolonger_ee5eccadc4"));
  const value = Math.min(2, roll.successes);
  const key = trait.kind === "attribute" ? `system.attributes.${trait.key}.die.modifier` : `@Skill{${trait.key}}[system.die.modifier]`;
  const existing = actor.effects.find(effect => effect.getFlag(MODULE_ID, "support")?.messageId === message.id);
  if (!existing) await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: sbsI18n("swade-hud.UI.Support_246aa73217", {p0: (trait.name), p1: (value)}), type: "base", img: "icons/svg/upgrade.svg", showIcon: 2,
    description: sbsI18n("swade-hud.UI.Expiresafterthenextrollwith_46ca9620bc"), origin: source.uuid,
    system: {changes: [{key, type: "add", value, phase: "initial"}]},
    flags: {[MODULE_ID]: {support: {kind: trait.kind, key: trait.key, messageId: message.id}}},
  }]);
  if (message.author.id === game.user.id || game.user.isGM) await message.setFlag(MODULE_ID, "supportApplied", true);
}

function matchingSupport(actor, kind, key) {
  return actor.effects.filter(effect => {
    const support = effect.flags?.[MODULE_ID]?.support;
    return support?.kind === kind && support.key === key && effect.active;
  });
}

function supportForRoll(actor, kind, key) {
  if (!actor || !key) return;
  const effectIds = matchingSupport(actor, kind, key).map(effect => effect.id);
  if (effectIds.length) return {actorUuid: actor.uuid, kind, key, effectIds};
}

export function markSupportRoll(actor, kind, key, roll) {
  const data = supportForRoll(actor, kind, key);
  if (data && roll.terms[0]) (roll.terms[0].options ??= {})[MARKER] = data;
}

export async function consumeSupport(message, userId) {
  if (userId !== game.user.id) return;
  const roll = message.rolls?.[0];
  if (!Number.isFinite(roll?.total)) return;
  const data = roll.terms[0]?.options?.[MARKER] ?? message.flags?.["swade-tools"]?.[MARKER];
  if (!data) return;
  const actor = foundry.utils.fromUuidSync(data.actorUuid);
  if (!actor?.isOwner) return;
  const ids = matchingSupport(actor, data.kind, data.key).map(effect => effect.id).filter(id => data.effectIds.includes(id));
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

export function registerSupportQuery() {
  CONFIG.queries[QUERY] = async ({messageUuid}, {user}) => {
    const message = await foundry.utils.fromUuid(messageUuid);
    if (message?.isContentVisible === false) throw new Error(sbsI18n("swade-hud.UI.SharetheSupportrollwiththe_d5fd28acc9"));
    await applySupport(message, user);
  };
}

export async function installToolsSupport() {
  if (!game.modules.get("swade-tools")?.active) return;
  const [{default: CharRoll}] = await importSwadeTools("scripts/class/CharRoll.js");
  for (const [method, kind] of [[sbsI18n("swade-hud.UI.rollAtt_811178a407"), "attribute"], [sbsI18n("swade-hud.UI.rollSkill_54151af40b"), "skill"]]) {
    const original = CharRoll.prototype[method];
    if (!original) continue;
    CharRoll.prototype[method] = function (trait, ...args) {
      const key = kind === "attribute" ? trait : this.actor?.items.find(item => item.type === "skill" && item.name === trait)?.id;
      this.addFlag(MARKER, supportForRoll(this.actor, kind, key) ?? null);
      return original.call(this, trait, ...args);
    };
  }
}
