import {t as sbsI18n} from "./i18n.mjs";
import { ATTRIBUTES, localize, statusDefinition, statusDefinitions } from "./swade.js";

const SHOW_ICON_ALWAYS = globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;

export function registerMountedStatus() {
  if (statusDefinition("mounted")) return;
  const mounted = {id: "mounted", name: sbsI18n("swade-hud.UI.Mounted_81f39eb58b"), img: "icons/tools/smithing/horseshoe-steel-grey.webp",
    description: sbsI18n("swade-hud.UI.Thisactorismounted_c900aaaa7e"), showIcon: SHOW_ICON_ALWAYS};
  if (Array.isArray(CONFIG.statusEffects)) CONFIG.statusEffects.push(mounted);
  else CONFIG.statusEffects.mounted = mounted;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}
function action(parent, name, glyph, label) {
  const link = node("a");
  link.tabIndex = 0;
  link.setAttribute("role", "button");
  link.setAttribute("aria-label", label);
  link.dataset.effectAction = name;
  link.title = label;
  const icon = node("i", "fa-solid fa-fw " + glyph);
  icon.setAttribute("aria-hidden", "true");
  link.append(icon);
  link.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); link.click(); }
  });
  parent.append(link);
  return link;
}

export function actorEffects(actor) {
  if (!actor?.isOwner) return [];
  const effects = actor?.allApplicableEffects ? Array.from(actor.allApplicableEffects()) : Array.from(actor?.effects ?? []);
  return [...new Map(effects.filter((effect) => effect.type !== "modifier")
    .map((effect) => [effect.uuid ?? effect.id, effect])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function activeEffects(actor) {
  const neverShowIcon = globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.NEVER ?? 0;
  return actorEffects(actor).filter((effect) => (effect.showIcon !== neverShowIcon || effect.flags?.["swade-hud"]?.showInEffectPanels === true)
    && (!effect.flags?.["swade-better-mounts-and-vehicles"]?.binding ||
      game.modules.get("swade-better-mounts-and-vehicles")?.api?.sourceToken?.(actor)?.uuid === effect.flags["swade-better-mounts-and-vehicles"].binding.rider)
    && !effect.statuses?.has("incapacitated") && !effect.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)
    && effect.active !== false && !effect.disabled && !effect.isSuppressed);
}

export async function showEffectVisibilityDialog(actor, effect) {
  if (!actor?.isOwner || !actorEffects(actor).includes(effect)) return;
  const never = globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.NEVER ?? 0;
  const current = effect.showIcon === never
    ? (effect.flags?.["swade-hud"]?.showInEffectPanels === true ? "panel" : "hidden") : "both";
  const choices = [
    ["hidden", sbsI18n("swade-hud.UI.Hidecompletely_21b0df7148"), sbsI18n("swade-hud.UI.Hidetheiconontokensand_514b800fab")],
    ["panel", sbsI18n("swade-hud.UI.Hideonlyontoken_a23e26ef8c"), sbsI18n("swade-hud.UI.Showtheiconinbotheffect_9081f284df")],
    ["both", sbsI18n("swade-hud.UI.Showontokenandpanel_a2507c91fd"), sbsI18n("swade-hud.UI.Showtheiconontokensand_52ce980457")],
  ];
  const escape = foundry.utils.escapeHTML;
  const choice = await foundry.applications.api.DialogV2.prompt({
    classes: ["swade-hud-effect-visibility"], window: {title: "Effect visibility · " + effect.name},
    rejectClose: false,
    content: `<div class="standard-form">` + choices.map(([value, label, hint]) =>
      `<label><input type="radio" name="visibility" value="${value}" ${current === value ? "checked" : ""}> ${escape(label)}<p class="hint">${escape(hint)}</p></label>`).join("")
      + "</div>",
    ok: {label: sbsI18n("swade-hud.UI.Apply_31e392d1c0"), callback: (_event, button) => button.form.elements.namedItem("visibility").value},
  });
  if (!choices.some(([value]) => value === choice) || !actor.isOwner || !actorEffects(actor).includes(effect)) return;
  return effect.update({
    showIcon: choice === "both" ? SHOW_ICON_ALWAYS : never,
    "flags.swade-hud.showInEffectPanels": choice === "panel",
  });
}

const deletionPrompts = new WeakSet();
export async function confirmEffectDeletion(effect) {
  if (deletionPrompts.has(effect)) return;
  deletionPrompts.add(effect);
  try {
    return await effect.deleteDialog({
      classes: ["swade-hud-effect-delete"],
      yes: {label: sbsI18n("swade-hud.UI.Delete_e2d0a54968"), default: false, callback: () => {
        if (effect.parent?.effects.some((entry) => entry === effect)) return effect.delete();
      }},
      no: {label: sbsI18n("swade-hud.UI.Cancel_19766ed6cc"), default: true}, rejectClose: false
    });
  } finally {
    deletionPrompts.delete(effect);
  }
}

const reactionUpdates = new WeakMap();
export function reactionEffect(actor) {
  return actor?.isOwner ? actor.effects.find((effect) => effect.flags?.["swade-hud"]?.reactionUsed === true) : undefined;
}
export async function toggleReactionEffect(actor) {
  if (!actor?.isOwner) return;
  // Serialize quick clicks so a second click removes the effect created by
  // the first, even while its embedded-document request is still pending.
  const operation = (reactionUpdates.get(actor) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!actor.isOwner) return;
    const existing = reactionEffect(actor);
    if (existing) return existing.delete();
    return actor.createEmbeddedDocuments("ActiveEffect", [{
      name: sbsI18n("swade-hud.UI.Reactionused_60175f88e8"), type: "base", img: "icons/svg/direction.svg",
      description: sbsI18n("swade-hud.UI.Thisactorhasusedtheirreaction_654e398218"),
      origin: actor.uuid, transfer: false, disabled: false,
      duration: { value: 1, units: "rounds", expiry: "turnEnd", expired: false },
      start: CONFIG.ActiveEffect.documentClass.getEffectStart(),
      system: { changes: [], removeEffect: true },
      flags: { "swade-hud": { reactionUsed: true } },
    }]);
  });
  reactionUpdates.set(actor, operation);
  try { return await operation; }
  finally { if (reactionUpdates.get(actor) === operation) reactionUpdates.delete(actor); }
}
export function nonSystemEffects(actor) {
  const definitions = statusDefinitions();
  return actorEffects(actor).filter((effect) => !effect.isSuppressed
    && (effect.active !== false || effect.disabled)
    && !definitions.some((definition) => (definition._id && effect.id === definition._id)
      || effect.statusId === definition.id || effect.statuses?.has(definition.id)));
}
export function findStatusEffect(actor, statusId) {
  if (!actor?.isOwner) return;
  const definition = statusDefinition(statusId);
  if (!definition) return;
  const applicable = actorEffects(actor);
  return applicable.find((effect) => (definition._id && effect.id === definition._id) || effect.statusId === statusId)
    ?? applicable.find((effect) => effect.statuses?.has(statusId));
}
export async function openStatusEffect(actor, statusId) {
  if (!actor?.isOwner) return;
  const definition = statusDefinition(statusId);
  if (!definition) return;
  const existing = findStatusEffect(actor, statusId);
  if (existing) return existing.sheet.render({ force: true });

  // Inspect an inactive status without applying it or editing CONFIG.statusEffects.
  const previewId = "swade-hud-status-" + (actor.uuid ?? actor.id).replaceAll(".", "-") + "-" + statusId;
  const open = foundry.applications.instances?.get(previewId);
  if (open) return open.render({ force: true });
  const preview = await statusEffectDocument(actor, statusId);
  class StatusPreview extends preview.sheet.constructor {
    get isEditable() { return false; }
  }
  return new StatusPreview({ document: preview, id: previewId }).render({ force: true });
}
export async function statusEffectDocument(actor, statusId) {
  if (!actor?.isOwner) return;
  const definition = statusDefinition(statusId);
  if (!definition) return;
  const existing = findStatusEffect(actor, statusId);
  if (existing) return existing;
  const Effect = CONFIG.ActiveEffect.documentClass;
  if (!Array.isArray(CONFIG.statusEffects)) return Effect.fromStatusEffect(statusId, { parent: actor });
  const { id, hud: _hud, ...data } = foundry.utils.deepClone(definition);
  data.name = localize(data.name);
  data.statuses = Array.from(new Set([id, ...(data.statuses ?? [])]));
  return new Effect(data, { parent: actor });
}

const timedStatuses = new WeakMap();
function isDefeatedStatus(statusId) {
  return statusId === (CONFIG.specialStatusEffects?.DEFEATED ?? "dead");
}

async function removeDefeatedCombatant(actor, token, statusId) {
  const combatant = token?.combatant;
  if (combatant && combatant.token === token && token.actor?.uuid === actor.uuid && actor.statuses.has(statusId)) {
    await combatant.delete();
  }
}

export async function toggleHudStatus(actor, token, statusId) {
  if (!actor?.isOwner) return;
  if (!isDefeatedStatus(statusId)) return actor.toggleActiveEffect(statusId);
  const definition = statusDefinition(statusId);
  if (!definition) return;
  // A permanent effect must also opt into icon rendering for its overlay to draw.
  const applied = await actor.toggleActiveEffect({ ...definition, showIcon: SHOW_ICON_ALWAYS }, { overlay: true });
  if (applied) await removeDefeatedCombatant(actor, token, statusId);
  return applied;
}

function timedStatusEffect(actor, definition) {
  const statuses = new Set([definition.id, ...(definition.statuses ?? [])]);
  return actor.effects.find((effect) => effect.type !== "modifier" && ((definition._id && effect.id === definition._id)
    || effect.statuses?.size === statuses.size && [...statuses].every((status) => effect.statuses.has(status))));
}
export async function applyTimedStatus(actor, statusId, value, units, token = actor?.token) {
  const definition = actor?.isOwner && statusDefinition(statusId);
  if (!definition) return;
  if (!Number.isSafeInteger(value) || value <= 0 || !["rounds", "minutes", "hours"].includes(units)) {
    throw new Error(sbsI18n("swade-hud.UI.Enterapositivewholenumberduration_0db07fc537"));
  }
  let pending = timedStatuses.get(actor);
  if (!pending) timedStatuses.set(actor, pending = new Map());
  if (pending.has(statusId)) return pending.get(statusId);
  const operation = (async () => {
    const duration = { value, units, expiry: "turnEnd", expired: false };
    const start = CONFIG.ActiveEffect.documentClass.getEffectStart();
    const defeated = isDefeatedStatus(statusId);
    let effect = timedStatusEffect(actor, definition);
    if (effect) {
      const changes = { disabled: false, duration, start, "system.removeEffect": true };
      if (defeated) Object.assign(changes, { showIcon: SHOW_ICON_ALWAYS, "flags.core.overlay": true });
      await effect.update(changes);
    } else {
      // Keep SWADE's canonical changes, callbacks and related statuses.
      const data = foundry.utils.deepClone(definition);
      data.duration = duration;
      data.start = start;
      data.disabled = false;
      data.transfer = false;
      data.system = { ...data.system, removeEffect: true };
      if (defeated) data.showIcon = SHOW_ICON_ALWAYS;
      await actor.toggleActiveEffect(data, defeated ? { active: true, overlay: true } : { active: true });
      effect = timedStatusEffect(actor, definition);
    }
    if (defeated && effect?.active) await removeDefeatedCombatant(actor, token, statusId);
    return effect;
  })();
  pending.set(statusId, operation);
  try { return await operation; }
  finally { pending.delete(statusId); }
}

let nextTimedStatusDialog = 0;
export function showTimedStatusDialog(actor, statusId, token) {
  const definition = actor?.isOwner && statusDefinition(statusId);
  if (!definition) return;
  const content = node("div", "form-group");
  const id = "swade-hud-status-duration-" + (++nextTimedStatusDialog);
  const label = node("label", "", sbsI18n("swade-hud.UI.Duration_4fc52a3c4c")); label.htmlFor = id;
  const duration = node("input");
  Object.assign(duration, { id, name: sbsI18n("swade-hud.UI.duration_caa79af4db"), type: "number", min: "1", step: "1", required: true, autofocus: true });
  duration.setAttribute("value", "1");
  const units = node("select"); units.name = sbsI18n("swade-hud.UI.units_c981a30c0e"); units.setAttribute("aria-label", sbsI18n("swade-hud.UI.Durationunits_b249354e44"));
  for (const [value, name] of [["rounds", sbsI18n("swade-hud.UI.Rounds_e9af9cdec8")], ["minutes", sbsI18n("swade-hud.UI.Minutes_4f846a84e7")], ["hours", sbsI18n("swade-hud.UI.Hours_21e8492938")]]) {
    const option = node("option", "", name); option.value = value; units.append(option);
  }
  content.append(label, duration, units);
  return foundry.applications.api.DialogV2.wait({
    classes: ["swade-hud-status-duration"], window: { title: "Apply " + localize(definition.name) + " - " + actor.name },
    content: content.outerHTML,
    buttons: [
      { action: "apply", label: sbsI18n("swade-hud.UI.Apply_31e392d1c0"), icon: "fa-solid fa-check", default: true, callback: (_event, button) => {
        const fields = button.form.elements;
        return applyTimedStatus(actor, statusId, fields.namedItem("duration").valueAsNumber, fields.namedItem("units").value, token);
      } },
      { action: "cancel", label: sbsI18n("swade-hud.UI.Cancel_19766ed6cc"), icon: "fa-solid fa-xmark", callback: () => {} },
    ],
  });
}
export function effectDuration(effect) {
  effect.updateDuration?.();
  const duration = effect.duration ?? {};
  if (duration.expired) return { label: sbsI18n("swade-hud.UI.Expired_424a2551d3"), badge: sbsI18n("swade-hud.UI.Expired_424a2551d3") };
  if (effect.flags?.["swade-hud"]?.support) return {label: sbsI18n("swade-hud.UI.Untilthenextrollwiththis_5c28d9eb4e"), badge: ""};
  if (!Number.isFinite(duration.value) || duration.value === null) return { label: sbsI18n("swade-hud.UI.Unlimitedduration_134530e09d"), badge: "" };
  const remaining = Number.isFinite(duration.remaining) ? Math.max(0, Math.ceil(duration.remaining)) : duration.value;
  const units = duration.units || "rounds";
  const unit = remaining === 1 ? units.replace(/s$/, "") : units;
  return {
    label: remaining + " " + unit + " remaining",
    badge: remaining + ({ rounds: "r", turns: "t", seconds: "s", minutes: "m", hours: "h", days: "d" }[units] ?? ""),
  };
}
export function changeLabel(change, actor) {
  const labels = {
    "system.stats.size": sbsI18n("swade-hud.UI.Size_1af8519073"), "system.size": sbsI18n("swade-hud.UI.Size_1af8519073"),
    "system.stats.parry.value": sbsI18n("swade-hud.UI.Parry_e5567f841f"), "system.stats.toughness.value": sbsI18n("swade-hud.UI.Toughness_19cd2c1eec"),
    "system.stats.toughness.armor": sbsI18n("swade-hud.UI.Armour_642ebd131f"), "system.stats.globalMods.trait": sbsI18n("swade-hud.UI.Traitrolls_7660128157"),
    "system.stats.globalMods.attack": sbsI18n("swade-hud.UI.Attackrolls_955ec594ab"), "system.stats.globalMods.damage": sbsI18n("swade-hud.UI.Damage_0c874f581a"),
    "system.stats.globalMods.attackRanged": sbsI18n("swade-hud.UI.Rangedattacks_35be551263"), "system.stats.globalMods.attackMelee": sbsI18n("swade-hud.UI.Meleeattacks_bbc8940217"),
    "system.pace.ground": sbsI18n("swade-hud.UI.GroundPace_d17c7654b0"),
    "system.pace": sbsI18n("swade-hud.UI.Paceallmovement_7c8b148616"), "system.pace.running.mod": sbsI18n("swade-hud.UI.Runningdiemodifier_06e0edf23a"),
    "system.damage": sbsI18n("swade-hud.UI.Damage_0c874f581a"), "system.parry": sbsI18n("swade-hud.UI.Parrybonus_086f2163c3"), "system.armor": sbsI18n("swade-hud.UI.Armourbonus_9ea07e1b9d"),
    "system.actions.traitMod": sbsI18n("swade-hud.UI.Traitmodifier_ff87ba5302"), "system.actions.dmgMod": sbsI18n("swade-hud.UI.Damagemodifier_bc0d310cd9"),
  };
  if (change.label || labels[change.key]) return change.label || labels[change.key];
  const linked = ATTRIBUTES.find(([key]) => change.key === "system.stats.globalMods." + key);
  if (linked) {
    const [key, label] = linked;
    const name = key[0].toUpperCase() + key.slice(1);
    return localize("SWADE.GlobalMod." + name, localize(label, name) + " and linked Skills");
  }
  const skill = /^@Skill\{([^}]+)\}\[(.+)\]$/i.exec(change.key);
  if (skill) return (actor?.items.get(skill[1])?.name ?? skill[1]) + " · " + changeLabel({key:skill[2]});
  const attribute = /^system\.attributes\.([^.]+)\.die\.(modifier|sides)$/.exec(change.key);
  if (attribute) return attribute[1][0].toUpperCase() + attribute[1].slice(1) + (attribute[2]==="modifier"?" modifier":" die");
  if (/^system\.powerPoints\./.test(change.key)) return "Power Points · " + change.key.split(".").slice(2).join(" ");
  return change.key.replace(/^system\./,"").replaceAll(".", " ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,(letter)=>letter.toUpperCase());
}

export function effectListTooltipPosition(section, row, tooltip, width, height) {
  let left = section.right + 8;
  if (left + tooltip.width > width - 5) left = section.left - tooltip.width - 8;
  return {
    left: Math.max(5, Math.min(left, width - tooltip.width - 5)),
    top: Math.max(5, Math.min(row.top + row.height / 2 - tooltip.height / 2, height - tooltip.height - 5)),
  };
}

export class EffectPanels {
  actor = null;
  element = null;
  tooltip = null;
  anchor = null;
  hoverVersion = 0;
  closeTimer = null;
  hoverTimer = null;
  tooltipPanel = null;
  tooltipObserver = null;

  constructor(report) { this.report = report; }
  bindListTooltip(actor, row, panel) {
    const control = row.querySelector(".effect-toggle");
    control.removeAttribute("title");
    const enter = () => this.scheduleListTooltip(actor, row, panel());
    const leave = () => this.leaveListTooltip(row);
    control.addEventListener("pointerenter", enter);
    control.addEventListener("pointerleave", leave);
    control.addEventListener("focus", enter);
    control.addEventListener("blur", leave);
    control.addEventListener("click", () => this.hideListTooltip());
  }
  scheduleListTooltip(actor, row, panel) {
    this.hideTooltip();
    if (!actor?.isOwner || !row.isConnected || !panel?.isConnected) return;
    this.anchor = row; this.tooltipPanel = panel;
    const version = this.hoverVersion;
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      const show = async () => {
        if (version !== this.hoverVersion || !actor.isOwner || !row.isConnected || !panel.isConnected) return;
        const effect = row.dataset.effectUuid ? actorEffects(actor).find((effect) => effect.uuid === row.dataset.effectUuid)
          : await statusEffectDocument(actor, row.dataset.status);
        if (!effect || version !== this.hoverVersion || !actor.isOwner || !row.isConnected || !panel.isConnected) return;
        await this.showTooltip(actor, effect, row, "list", panel);
      };
      show().catch(this.report);
    }, 400);
  }
  leaveListTooltip(row) {
    if (this.anchor !== row) return;
    if (!this.tooltip) this.hideTooltip();
    else this.scheduleHide();
  }
  hideListTooltip() { if (this.tooltipPanel) this.hideTooltip(); }
  buildDock(root, actor) {
    const effects = activeEffects(actor);
    if (!effects.length) return;
    const container = node("div");
    container.dataset.panel = "effects";
    const article = node("article");
    for (const effect of effects) article.append(this.effectElement(actor, effect, "dock"));
    container.append(article);
    root.append(container);
  }
  renderSidebar(actor) {
    this.hideTooltip();
    this.actor = actor ?? null;
    this.element?.remove();
    this.element = null;
    const effects = activeEffects(actor);
    if (!effects.length) return;
    const panel = node("article", "swade-hud-element");
    panel.id = "swade-hud-effects-panel";
    for (const effect of effects) panel.append(this.effectElement(actor, effect, "sidebar"));
    const parent = document.getElementById("ui-right-column-1");
    if (parent) parent.append(panel);
    else {
      panel.classList.add("standalone");
      document.body.append(panel);
    }
    this.element = panel;
  }
  effectElement(actor, effect, location) {
    const entry = node("div", "effect-item");
    entry.dataset.action = "handleClick";
    entry.dataset.effectUuid = effect.uuid;
    entry.dataset.itemId = effect.id;
    entry.dataset.itemUuid = effect.uuid;
    entry.tabIndex = 0;
    entry.setAttribute("role", "button");
    entry.setAttribute("aria-label", effect.name);
    const changes = effect.system?.changes ?? effect.changes ?? [];
    const aura = Array.from(changes).some((change) => change.key?.startsWith("system.auras."));
    const image = node("div", "icon" + (aura ? " aura" : ""));
    image.style.backgroundImage = "url(" + JSON.stringify(effect.img || "icons/svg/aura.svg") + ")";
    const duration = effectDuration(effect);
    if (duration.badge) {
      const wrapper = node("div", "value-wrapper");
      const value = node("div", "value");
      value.append(node("strong", "", duration.badge));
      wrapper.append(value);
      image.append(wrapper);
    }
    entry.append(image);
    entry.addEventListener("pointerenter", () => {
      clearTimeout(this.closeTimer);
      this.showTooltip(actor, effect, entry, location).catch(this.report);
    });
    entry.addEventListener("pointerleave", () => this.scheduleHide());
    entry.addEventListener("focus", () => this.showTooltip(actor, effect, entry, location).catch(this.report));
    entry.addEventListener("blur", () => this.scheduleHide());
    entry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (actor.isOwner) Promise.resolve(effect.sheet.render({ force: true })).catch(this.report);
    });
    entry.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (actor.isOwner) {
        this.hideTooltip();
        confirmEffectDeletion(effect).catch(this.report);
      }
    });
    entry.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); entry.click(); }
    });
    return entry;
  }
  async content(actor, effect, forChat = false, { instructions = true, statusId } = {}) {
    const content = node("div", "content");
    content.dataset.itemUuid = effect.uuid;
    const title = node("h1", "", effect.name);
    if (!forChat) {
      action(title, sbsI18n("swade-hud.UI.sendtochat_c2ebc204bb"), "fa-comment-alt", sbsI18n("swade-hud.UI.SendtoChat_531f83e5ee"))
        .addEventListener("click", () => this.sendToChat(actor, effect).catch(this.report));
      if (actor.isOwner) action(title, sbsI18n("swade-hud.UI.edit_262121c537"), "fa-pencil", sbsI18n("swade-hud.UI.EditEffect_77b01eb4b2"))
        .addEventListener("click", () => Promise.resolve(statusId ? openStatusEffect(actor, statusId) : effect.sheet.render({ force: true })).catch(this.report));
      if (actor.isOwner && actorEffects(actor).includes(effect)) {
        action(title, sbsI18n("swade-hud.UI.visibility_7d2fb3da93"), "fa-eye", sbsI18n("swade-hud.UI.Effectvisibility_7a95d96c5c")).addEventListener("click", () => {
          this.hideTooltip();
          showEffectVisibilityDialog(actor, effect).catch(this.report);
        });
      }
    }
    content.append(title);
    const tags = node("div", "tags");
    const tag = (label) => { if (label) tags.append(node("div", "tag tag_secondary", label)); };
    tag(effectDuration(effect).label);
    // A timed effect can have no turn-based expiration behavior.
    if (effect.isTemporary && effect.duration?.expiry) tag(effect.expirationText);
    for (const status of effect.statuses ?? []) tag(localize(statusDefinition(status)?.name ?? status));
    if (effect.system?.conditionalEffect) tag(sbsI18n("swade-hud.UI.Conditionaleffect_61fd3d5eef"));
    content.append(tags);
    let source = effect.parent?.documentName === "Item" ? effect.parent : null;
    if (!source && effect.origin) {
      try { source = await fromUuid(effect.origin); } catch { /* A deleted origin is still a valid effect. */ }
    }
    const sourceName = source?.name || effect.sourceName;
    if (sourceName) content.append(node("div", "effect-source", "Source: " + sourceName));
    if (!forChat && instructions && actor.isOwner) {
      const instructions = node("div", "instructions");
      instructions.append(node("div", "", sbsI18n("swade-hud.UI.LeftClickOpeneffect_450049bca8")), node("div", "", sbsI18n("swade-hud.UI.RightClickConfirmremoval_fde46a923b")));
      content.append(instructions);
    }
    const description = node("div", "description");
    description.innerHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      effect.description || source?.system?.description || "", {
        relativeTo: effect, rollData: actor.getRollData?.() ?? {}, secrets: !forChat && actor.isOwner,
      });
    if (!description.textContent.trim()) description.append(node("p", "", sbsI18n("swade-hud.UI.Nodescription_06a6948209")));
    const changes = Array.from(effect.system?.changes ?? effect.changes ?? []);
    if (changes.length) {
      description.append(node("h4", "", sbsI18n("swade-hud.UI.Modifiers_072da57fac")));
      const list = node("ul", "effect-modifiers");
      for (const change of changes) list.append(node("li", "", changeLabel(change, actor) + ": " + change.value));
      description.append(list);
    }
    content.append(description);
    return content;
  }
  createDescription(actor, effect, statusId) {
    const panels = this;
    class EffectDescription extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = {
        classes: ["swade-hud-popup", "swade-hud-effect-description"],
        position: { width: 430 }, window: { resizable: false, minimizable: false },
      };
      async _renderHTML() {
        const content = await panels.content(actor, effect, false, { instructions: false, statusId });
        const image = node("img", "effect-image"); image.src = effect.img || "icons/svg/aura.svg"; image.alt = "";
        content.querySelector("h1").prepend(image);
        return content;
      }
      _replaceHTML(result, content) { content.replaceChildren(result); }
    }
    const id = String(effect.uuid ?? effect.id ?? effect.statusId ?? [...(effect.statuses ?? [])][0] ?? effect.name).replace(/[^a-z0-9_-]/gi, "-");
    return new EffectDescription({ id: "swade-hud-effect-description-" + id,
      window: { title: actor.name + " - " + effect.name } });
  }
  async showTooltip(actor, effect, anchor, location, panel = null) {
    this.hideTooltip();
    this.anchor = anchor; this.tooltipPanel = panel;
    const version = this.hoverVersion;
    const content = await this.content(actor, effect, false, { instructions: location !== "list", statusId: location === "list" ? anchor.dataset.status : undefined });
    if (version !== this.hoverVersion || !actor.isOwner || !anchor.isConnected || (panel && !panel.isConnected)) return;
    const tooltip = node("aside", "active themed theme-dark swade-hud-element swade-hud-effect-info effect-info application locked-tooltip "
      + (location === "dock" ? "text-center" : "text-left"));
    tooltip.setAttribute("role", "tooltip");
    tooltip.setAttribute("popover", "manual");
    tooltip.dataset.location = location;
    tooltip.append(content);
    tooltip.addEventListener("pointerenter", () => clearTimeout(this.closeTimer));
    tooltip.addEventListener("pointerleave", () => this.scheduleHide());
    tooltip.addEventListener("focusin", () => clearTimeout(this.closeTimer));
    tooltip.addEventListener("focusout", () => this.scheduleHide());
    document.body.append(tooltip);
    tooltip.showPopover?.();
    this.tooltip = tooltip;
    this.anchor = anchor;
    this.positionTooltip(location);
    if (location === "list" && this.tooltip && globalThis.ResizeObserver) {
      this.tooltipObserver = new ResizeObserver(() => this.positionTooltip());
      this.tooltipObserver.observe(tooltip);
      this.tooltipObserver.observe(panel);
      this.tooltipObserver.observe(anchor);
    }
  }
  positionTooltip(location = this.tooltip?.dataset.location) {
    if (!this.tooltip) return;
    if (!this.anchor?.isConnected) { this.hideTooltip(); return; }
    const anchor = this.anchor.getBoundingClientRect();
    const bounds = this.tooltip.getBoundingClientRect();
    if (location === "list") {
      if (!this.tooltipPanel?.isConnected) { this.hideTooltip(); return; }
      const section = (this.anchor.closest(".effect-column") ?? this.tooltipPanel).getBoundingClientRect();
      const visible = (this.tooltipPanel.querySelector(".inner") ?? this.tooltipPanel).getBoundingClientRect();
      if (!anchor.width || !anchor.height || anchor.bottom <= visible.top || anchor.top >= visible.bottom) { this.hideTooltip(); return; }
      const position = effectListTooltipPosition(section, anchor, bounds, innerWidth, innerHeight);
      this.tooltip.style.left = position.left + "px";
      this.tooltip.style.top = position.top + "px";
      return;
    }
    let left = location === "sidebar" ? anchor.left - bounds.width - 8 : anchor.left;
    let top = location === "sidebar" ? anchor.top : anchor.top - bounds.height - 8;
    if (location === "dock" && top < 5) top = anchor.bottom + 8;
    this.tooltip.style.left = Math.max(5, Math.min(left, innerWidth - bounds.width - 5)) + "px";
    this.tooltip.style.top = Math.max(5, Math.min(top, innerHeight - bounds.height - 5)) + "px";
  }
  scheduleHide() {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.hideTooltip(), 180);
  }
  hideTooltip() {
    clearTimeout(this.closeTimer);
    clearTimeout(this.hoverTimer); this.hoverTimer = null;
    this.tooltipObserver?.disconnect(); this.tooltipObserver = null;
    this.hoverVersion++;
    this.tooltip?.remove();
    this.tooltip = null;
    this.anchor = null;
    this.tooltipPanel = null;
  }
  async sendToChat(actor, effect) {
    const content = await this.content(actor, effect, true);
    const Message = globalThis.getDocumentClass?.("ChatMessage") ?? globalThis.ChatMessage;
    const data = { speaker: Message.getSpeaker({ actor }), content: content.outerHTML };
    Message.applyMode?.(data, game.settings.get("core", "messageMode") ?? "public");
    return Message.create(data);
  }
}
