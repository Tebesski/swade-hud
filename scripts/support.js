import { ATTRIBUTES, MODULE_ID, itemsOf, localize } from "./swade.js";
import { importSwadeTools } from "./tools-imports.js";

const QUERY = "swade-hud.applySupport";
const MARKER = "swadeHudSupport";
const grants = new Map();

function supportTraits(actor) {
  return [
    ["Attributes", ATTRIBUTES.filter(([key]) => actor.system.attributes?.[key])
      .map(([key, label]) => ({kind: "attribute", key, name: localize(label, key)}))],
    ["Skills", itemsOf(actor, "skill").sort((a, b) => a.name.localeCompare(b.name))
      .map(item => ({kind: "skill", key: item.id, name: item.name}))],
  ];
}

export async function rollSupport(target, execute) {
  if (!target?.actor) return ui.notifications.warn("Target one ally to Support.");
  const groups = supportTraits(target.actor).filter(([, traits]) => traits.length);
  if (!groups.length) return ui.notifications.warn("This target has no traits to Support.");
  const receiver = game.users?.activeGM ?? game.users?.find?.(user => user.active && target.actor.testUserPermission(user, "OWNER"));
  if (!target.actor.isOwner && !receiver) return ui.notifications.warn("A connected owner or GM is needed to apply Support to this target.");

  const escape = foundry.utils.escapeHTML;
  const content = groups.map(([group, traits]) => `<optgroup label="${group}">${traits.map(({kind, key, name}) =>
    `<option value="${kind}:${escape(key)}">${escape(name)}</option>`).join("")}</optgroup>`).join("");
  const selection = await foundry.applications.api.DialogV2.prompt({
    window: {title: "Support · " + target.name}, rejectClose: false,
    content: `<label>Trait to Support <select name="trait" required autofocus>${content}</select></label>`,
    ok: {label: "Roll Support", callback: (_event, button) => button.form.elements.namedItem("trait").value},
  });
  if (!selection) return;
  const [kind, key] = selection.split(":");
  const roll = await execute();
  if (!roll) return;
  if (roll.isCritfail) ui.notifications.info("Support critically failed. Resolve the −2 penalty with the GM.");
  if (roll.isCritfail || !(roll.successes >= 1)) return roll;
  const message = game.messages.get(roll.messageId);
  if (!message) throw new Error("The completed Support roll could not be found.");
  await message.setFlag(MODULE_ID, "supportGrant", {targetUuid: target.uuid, kind, key});
  if (target.actor.isOwner) await applySupport(message, game.user);
  else {
    await receiver.query(QUERY, {messageUuid: message.uuid});
    if (!message.getFlag(MODULE_ID, "supportApplied")) await message.setFlag(MODULE_ID, "supportApplied", true);
  }
  return roll;
}

function applySupport(message, user) {
  if (!message?.id || message.author?.id !== user.id) throw new Error("The Support roll must belong to the requesting user.");
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
    throw new Error("Support requires a successful Trait roll from an actor you own.");
  }
  const token = await foundry.utils.fromUuid(grant.targetUuid);
  const actor = token?.actor;
  if (!actor?.isOwner || token.documentName !== "Token") throw new Error("The Support target is no longer available.");
  const trait = supportTraits(actor).flatMap(([, entries]) => entries).find(entry => entry.kind === grant.kind && entry.key === grant.key);
  if (!trait) throw new Error("The chosen trait is no longer available.");
  const value = Math.min(2, roll.successes);
  const key = trait.kind === "attribute" ? `system.attributes.${trait.key}.die.modifier` : `@Skill{${trait.key}}[system.die.modifier]`;
  const existing = actor.effects.find(effect => effect.getFlag(MODULE_ID, "support")?.messageId === message.id);
  if (!existing) await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: `Support · ${trait.name} (+${value})`, type: "base", img: "icons/svg/upgrade.svg", showIcon: 2,
    description: "Expires after the next roll with the supported trait.", origin: source.uuid,
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
    if (message?.isContentVisible === false) throw new Error("Share the Support roll with the target’s owner or GM.");
    await applySupport(message, user);
  };
}

export async function installToolsSupport() {
  if (!game.modules.get("swade-tools")?.active) return;
  const [{default: CharRoll}] = await importSwadeTools("scripts/class/CharRoll.js");
  for (const [method, kind] of [["rollAtt", "attribute"], ["rollSkill", "skill"]]) {
    const original = CharRoll.prototype[method];
    if (!original) continue;
    CharRoll.prototype[method] = function (trait, ...args) {
      const key = kind === "attribute" ? trait : this.actor?.items.find(item => item.type === "skill" && item.name === trait)?.id;
      this.addFlag(MARKER, supportForRoll(this.actor, kind, key) ?? null);
      return original.call(this, trait, ...args);
    };
  }
}
