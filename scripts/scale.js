import {t as sbsI18n} from "./i18n.mjs";
import { renderSizeReference } from "./size-reference.js";
import { tokenFootprint } from "../../swade-better-setting/scripts/npc-size.mjs";
import { MODULE_ID } from "./swade.js";
export { tokenFootprint };

const tokenResizes = new WeakMap();

function sizePath(actor) {
  if (actor?.type === "vehicle") return "size";
  if (["character", "npc"].includes(actor?.type)) return "stats.size";
  return null;
}
function readSize(system, path) {
  return path === "size" ? system?.size : system?.stats?.size;
}
export function actorSize(actor) {
  const size = Number(readSize(actor.system, sizePath(actor)));
  return Number.isFinite(size) ? Math.trunc(size) : 0;
}
function changedSize(actor, changes) {
  const path = sizePath(actor);
  if (path) return changes["system." + path] ?? readSize(changes.system, path);
}

export function preparePrototypeSizeUpdate(actor, changes) {
  if (actor.isToken || !actor.prototypeToken) return;
  const size = changedSize(actor, changes);
  if (!Number.isSafeInteger(size) || size === readSize(actor._source.system, sizePath(actor))) return;
  const footprint = tokenFootprint(size);
  // Save the prototype footprint atomically with the permanent actor Size.
  Object.assign(changes.prototypeToken ??= {}, { width: footprint, height: footprint });
}

export function initializePrototypeSize(actor) {
  const path = sizePath(actor);
  if (actor.isToken || !actor.prototypeToken || !path) return;
  const size = readSize(actor._source.system, path);
  if (!Number.isSafeInteger(size)) return;
  const footprint = tokenFootprint(size);
  if (footprint !== 1) actor.updateSource({ prototypeToken: { width: footprint, height: footprint } });
}

export async function onActorSizeChange(actor, changes, options, userId) {
  if (userId !== game.user.id || !actor.isOwner) return;
  const size = changedSize(actor, changes);
  if (!Number.isSafeInteger(size)) return;
  const tokens = actor.isToken ? [actor.token] : actor.getDependentTokens({ linked: true, concreteOnly: true });
  const timedTargets = new Set();
  for (const effect of actor.effects ?? []) {
    const uuid = effect.flags?.[MODULE_ID]?.sizeChange?.tokenUuid;
    if (uuid && effect.active) timedTargets.add(uuid);
  }
  await Promise.all(tokens.map((token) => {
    if (!token || token.uuid === options.swadeHudResizeToken) return;
    const tokenSize = actor.isToken || timedTargets.has(token.uuid) ? actorSize(actor) : size;
    return syncTokenSize(actor, token, tokenSize);
  }));
}

export async function adjustScale(actor, token, delta) {
  if (![-1, 1].includes(delta)) return;
  if (!actor) return;
  return setActorSize(actor, token, actorSize(actor) + delta);
}
export async function setActorSize(actor, token, size) {
  const path = sizePath(actor);
  if (!actor?.isOwner || token?.isOwner === false || !path || !Number.isSafeInteger(size)) return;
  // Preserve any active-effect contribution to Size, just as resource edits do.
  const delta = size - actorSize(actor);
  const source = Number(readSize(actor._source?.system, path));
  const updated = await actor.update({ ["system." + path]: (Number.isFinite(source) ? source : actorSize(actor)) + delta },
    { swadeHudResizeToken: token?.uuid });
  if (token && (updated || actorSize(actor) === size)) await resizeToken(token, size);
}

function syncTokenSize(actor, token, size = actorSize(actor)) {
  if (!actor?.isOwner || !token?.isOwner || token.actor?.uuid !== actor.uuid) return;
  return resizeToken(token, size);
}

async function resizeToken(token, size) {
  const footprint = tokenFootprint(size);
  // Check dimensions after the previous write so a fast reversal is not skipped.
  const previous = tokenResizes.get(token) ?? Promise.resolve();
  const resize = previous.catch(() => {}).then(() => {
    if (token.width !== footprint || token.height !== footprint) {
      return token.update({ width: footprint, height: footprint });
    }
  });
  tokenResizes.set(token, resize);
  try { await resize; }
  finally {
    if (tokenResizes.get(token) === resize) tokenResizes.delete(token);
  }
}

export async function applySizeChange(actor, token, size, timing) {
  if (!timing) return setActorSize(actor, token, size);
  const path = sizePath(actor);
  if (!actor?.isOwner || !token?.isOwner || token.actor?.uuid !== actor.uuid || !path || !Number.isSafeInteger(size)) return;
  const { duration, units } = timing;
  if (!Number.isSafeInteger(duration) || duration <= 0 || !["rounds", "minutes", "hours"].includes(units)) {
    throw new Error(sbsI18n("swade-hud.UI.Enterapositivewholenumberduration_0db07fc537"));
  }
  const delta = size - actorSize(actor);
  const effects = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Size: " + size, type: "base",
    img: delta >= 0 ? "icons/svg/upgrade.svg" : "icons/svg/downgrade.svg",
    origin: token.uuid, transfer: false, disabled: false,
    duration: { value: duration, units, expiry: "turnEnd" },
    system: {
      changes: [{ key: "system." + path, type: "add", value: delta, phase: "initial" }],
      removeEffect: true,
    },
    flags: { [MODULE_ID]: { sizeChange: { tokenUuid: token.uuid } } },
  }]);
  // The system has prepared the actor with its new effective Size at this point.
  await syncTokenSize(actor, token);
  return effects;
}

export async function onSizeEffectChange(effect, userId) {
  const target = effect.flags?.[MODULE_ID]?.sizeChange?.tokenUuid;
  if (!target || userId !== game.user.id) return;
  // Let the embedded-document operation finish preparing the parent actor.
  // Only the initiating client updates the token, avoiding competing writes.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const token = await fromUuid(target);
  const actor = effect.actor ?? effect.parent;
  if (token?.actor?.uuid === actor?.uuid) await syncTokenSize(token.actor, token);
}

export function showSizeDialog(actor, apply) {
  if (!actor?.isOwner || !sizePath(actor)) return;
  const content = document.createElement("div");
  const sizeRow = document.createElement("div");
  sizeRow.className = "form-group";
  const label = document.createElement("label");
  label.htmlFor = "swade-hud-actor-size";
  label.textContent = sbsI18n("swade-hud.UI.Size_1af8519073");
  const input = document.createElement("input");
  input.id = label.htmlFor;
  input.name = sbsI18n("swade-hud.UI.size_ccdcbe846f");
  input.type = "number";
  input.step = "1";
  input.required = true;
  input.autofocus = true;
  input.setAttribute("value", String(actorSize(actor)));
  sizeRow.append(label, input);
  content.append(sizeRow);
  const durationRow = document.createElement("div");
  durationRow.className = "form-group size-duration";
  const durationLabel = document.createElement("label");
  durationLabel.htmlFor = "swade-hud-size-duration";
  durationLabel.textContent = sbsI18n("swade-hud.UI.Durationoptional_b86b27f4c2");
  const duration = document.createElement("input");
  Object.assign(duration, { id: durationLabel.htmlFor, name: sbsI18n("swade-hud.UI.duration_caa79af4db"), type: "number", min: "1", step: "1" });
  const units = document.createElement("select");
  units.name = sbsI18n("swade-hud.UI.units_c981a30c0e");
  units.setAttribute("aria-label", sbsI18n("swade-hud.UI.Durationunits_b249354e44"));
  for (const [value, text] of [["rounds", sbsI18n("swade-hud.UI.Rounds_e9af9cdec8")], ["minutes", sbsI18n("swade-hud.UI.Minutes_4f846a84e7")], ["hours", sbsI18n("swade-hud.UI.Hours_21e8492938")]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    units.append(option);
  }
  durationRow.append(durationLabel, duration, units);
  content.append(durationRow);
  return foundry.applications.api.DialogV2.wait({
    classes: ["swade-hud-size-dialog"], window: { title: "Size - " + actor.name },
    content: content.outerHTML,
    buttons: [
      { action: "apply", label: sbsI18n("swade-hud.UI.Apply_31e392d1c0"), icon: "fa-solid fa-check", default: true,
        callback: (_event, button) => {
          const form = button.form;
          const value = form.elements.namedItem("size").valueAsNumber;
          const duration = form.elements.namedItem("duration");
          const timing = duration.value.trim() ? { duration: duration.valueAsNumber, units: form.elements.namedItem("units").value } : undefined;
          if (Number.isSafeInteger(value)) return apply(value, timing);
        } },
      { action: "cancel", label: sbsI18n("swade-hud.UI.Cancel_19766ed6cc"), icon: "fa-solid fa-xmark", callback: () => {} },
    ],
  });
}

let reference = null;
export function showSizeReference() {
  if (!reference) {
    class SizeReference extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = {
        classes: ["swade-hud-size-reference"],
        position: { width: 900, height: "auto" },
        window: { title: sbsI18n("swade-hud.UI.SizeTable_a85aa336bb"), resizable: true },
      };
      async _renderHTML() { return renderSizeReference(); }
      _replaceHTML(result, content) { content.replaceChildren(result); }
    }
    reference = new SizeReference({ id: "swade-hud-size-reference", window: { title: sbsI18n("swade-hud.UI.SizeTable_a85aa336bb") } });
  }
  return reference.render({ force: true });
}
