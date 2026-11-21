import {t as sbsI18n} from "./i18n.mjs";
import {
  MODULE_ID, ATTRIBUTES, SIDEBARS, PHYSICAL, localize, itemsOf,
  sorted, canRollSkills, dieLabel, powerPools, statusDefinitions,
  hasStatus, useItem, adjustResource, updatePool, rollAttribute, rollSkill, rollRunning, recoverShaken,
  hasSwadeToolsItemDialog, openSwadeToolsItemDialog,
} from "./swade.js";
import { createItemPopup } from "./popup.js";
import { raiseHudPanel } from "./panel-focus.js";
import { EffectPanels, actorEffects, confirmEffectDeletion, nonSystemEffects, effectDuration, findStatusEffect, openStatusEffect, statusEffectDocument, showTimedStatusDialog, toggleHudStatus, reactionEffect, toggleReactionEffect } from "./effects.js";
import { dispositionDetails, showDispositionDialog } from "./disposition.js";
import { powerTemplates, placePowerTemplate, isTemplateRange, isBoostLowerTrait, powerPoolUsesNoPP, powerCostPresentation } from "./powers.js";
import { showModifierDialog } from "./modifiers.js";
import { actionKind, actionUsesSkill, basicActionLabel, COMMON_SKILL_ACTIONS, commonSkillActionLabel, coreSkillDocument, generateBasicActions, isChaseAction, isResistanceOnlyAction, isOpposedAction, isUnskilledAttempt, rollCommonSkillAction, skillActions } from "./basic-actions.js";
import { holdCombatant, naturalHealingCooldown, runExtra, EXTRAS } from "./extras.js";
import { attackOptions, attackOptionState, setAttackOption } from "./attack-options.js";
import { itemShortcutActions } from "./item-actions.js";
import { bennyPool } from "./bennies.js";
import { actorSize, adjustScale, applySizeChange, showSizeDialog, showSizeReference } from "./scale.js";

const ITEM_CONTEXT_TARGET = sbsI18n("swade-hud.UI.itemdataitemidvariantsdata_db9ad42901");

function styleTier(item, parts) {
  game.modules?.get?.("swade-better-money")?.api?.styleItemTier?.(item, parts);
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = String(text);
  return el;
}

function coatingIcons(item, hoverable = false) {
  const effects = game.modules.get("swade-better-usables")?.api?.getCoatingEffects?.(item);
  if (!effects?.length) return;
  const icons = node("span", "swade-hud-coatings");
  if (!hoverable) icons.setAttribute("aria-hidden", "true");
  for (const effect of effects) {
    const image = node("img");
    image.src = effect.img;
    image.alt = hoverable ? effect.name : "";
    image.draggable = false;
    if (hoverable) image.title = effect.name;
    icons.append(image);
  }
  return icons;
}
function icon(name, classes = "") {
  const el = node("i", "fa-solid " + name + (classes ? " " + classes : ""));
  el.setAttribute("aria-hidden", "true");
  return el;
}
function link(parent, action, glyph, text, title, data = {}) {
  const el = node("a");
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.dataset.action = action;
  Object.assign(el.dataset, data);
  if (title) {
    el.title = title;
    el.setAttribute("aria-label", title);
  }
  if (glyph) el.append(icon(glyph));
  if (text !== undefined && text !== "") el.append(node("span", "", text));
  parent.append(el);
  return el;
}
function panel(root, name) {
  const el = node("div");
  el.dataset.panel = name;
  root.append(el);
  return el;
}
function input(parent, value, data = {}, small = false) {
  const el = node("input", small ? "small text-number" : "text-number");
  el.type = "number";
  el.min = "0";
  el.value = String(value ?? 0);
  Object.assign(el.dataset, data);
  parent.append(el);
  return el;
}
function header(parent, label) {
  const el = node("header");
  el.append(node("div", "name", label));
  parent.append(el);
  return el;
}
function weightLabel(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return String(Math.round(Number(value) * 10) / 10);
}

export class SwadeHUD {
  actor = null;
  token = null;
  element = null;
  sidebar = null;
  activeSidebar = null;
  description = null;
  page = 0;
  showEffects = true;
  queued = false;
  hotbarHome = null;
  layoutObserver = null;
  layoutHost = null;
  tooltip = null;
  sidebarContextMenu = null;
  effectPanels = new EffectPanels((error) => this.report(error));
  lastOwnedTokenId = null;
  lastScene = null;
  canvasPointer = null;
  pendingSkillExpansion = new Map();
  skillExpansionWrite = Promise.resolve();
  filteredSkillExpansion = new Map();

  constructor() {
    document.addEventListener("keydown", (event) => this.onKey(event));
    document.addEventListener("pointerdown", (event) => this.onCanvasPointerDown(event), true);
    document.addEventListener("pointermove", (event) => this.onCanvasPointerMove(event), true);
    document.addEventListener("pointerup", (event) => this.onCanvasPointerUp(event), true);
    document.addEventListener("pointercancel", (event) => {
      if (event.pointerId === this.canvasPointer?.id) this.canvasPointer = null;
    }, true);
  }
  onCanvasPointerDown(event) {
    // Token clicks use the same PIXI board. Dialogs and other Foundry UI can
    // contain their own canvases, so only the scene's board should dismiss us.
    const board = document.getElementById("board");
    if (!board || !event.composedPath().includes(board)) return;
    this.canvasPointer = {id: event.pointerId, x: event.clientX, y: event.clientY, board};
  }
  onCanvasPointerMove(event) {
    const pointer = this.canvasPointer;
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4) {
      this.canvasPointer = null;
    }
  }
  onCanvasPointerUp(event) {
    this.onCanvasPointerMove(event);
    const pointer = this.canvasPointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    this.canvasPointer = null;
    if (!event.composedPath().includes(pointer.board)) return;
    this.closeSidebar();
    this.closeDescription();
    this.hideTooltip();
    this.effectPanels.hideTooltip();
  }
  schedule() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.render(); });
  }
  get profileKey() {
    return this.actor?.token ? this.actor.id + "-" + this.actor.token.id : this.actor?.id;
  }
  get profiles() { return game.user.getFlag(MODULE_ID, "profiles") ?? {}; }
  get profile() { return this.profiles[this.profileKey] ?? {}; }
  get owned() { return Boolean(this.actor?.isOwner); }
  get appearance() { return game.user.getFlag(MODULE_ID, "appearance") ?? {}; }

  resolveToken() {
    const scene = globalThis.canvas?.scene?.id ?? "canvas";
    if (this.lastScene !== scene) this.forgetToken();
    const controlled = (globalThis.canvas?.tokens?.controlled ?? []).filter((token) => this.ownsToken(token));
    const selected = controlled.find((token) => token.id === this.lastOwnedTokenId) ?? controlled.at(-1);
    if (selected) this.rememberToken(selected);
    const retained = (globalThis.canvas?.tokens?.placeables ?? []).find((token) => token.id === this.lastOwnedTokenId);
    if (selected) return selected;
    if (this.ownsToken(retained)) return retained;
    this.forgetToken();
    return null;
  }
  ownsToken(token) { return Boolean(token?.actor?.isOwner && token.document?.isOwner !== false); }
  rememberToken(token) {
    if (!this.ownsToken(token)) return;
    this.lastOwnedTokenId = token.id;
    this.lastScene = globalThis.canvas?.scene?.id ?? "canvas";
  }
  forgetToken() {
    this.lastOwnedTokenId = null;
    this.lastScene = globalThis.canvas?.scene?.id ?? "canvas";
  }
  render() {
    if (!Number.isInteger(this.page) || this.page < 0 || this.page > 2) this.page = 0;
    const token = this.resolveToken();
    const actor = token?.actor;
    if (!this.ownsToken(token) || !actor || !["character", "npc", "vehicle", "group"].includes(actor.type)) {
      this.hide();
      return;
    }
    if (this.actor?.uuid !== actor.uuid) {
      this.page = 0;
      this.closeSidebar();
      this.closeDescription();
    }
    this.actor = actor;
    this.token = token;
    const root = this.element ?? node("div", "swade-hud-element advanced");
    root.id = "swade-hud-persistent";
    root.classList.toggle("cleaned", Boolean(this.appearance.cleanPortrait));
    if (!this.element) this.bind(root);
    this.element = root;
    const hotbar = document.getElementById("hotbar");
    if (hotbar) {
      if (!this.hotbarHome && hotbar.parentElement !== root) {
        this.hotbarHome = { parent: hotbar.parentElement, next: hotbar.nextSibling };
      }
      hotbar.remove();
    }
    root.replaceChildren();
    this.buildMenu(root);
    this.buildPortrait(root);
    this.buildStatistics(root);
    this.buildSidebars(root);
    this.buildShortcuts(root);
    this.buildShortcutMenu(root);
    if (this.showEffects) this.effectPanels.buildDock(root, actor);
    if (hotbar) root.append(hotbar);
    root.dataset.dock = "left";
    const parent = document.getElementById("interface") ?? document.body;
    parent?.append(root);
    this.reservePlayersSpace();
    if (!this.layoutObserver) {
      this.layoutObserver = new ResizeObserver(() => this.reservePlayersSpace());
      this.layoutObserver.observe(root);
    }
    this.effectPanels.renderSidebar(actor);
    if (this.activeSidebar) this.renderSidebar();
    this.description?.positionAtShortcut?.();
  }

  hide() {
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.layoutHost?.style.removeProperty("--swade-hud-players-space");
    this.layoutHost = null;
    this.closeSidebar();
    this.closeDescription();
    this.hideTooltip();
    const hotbar = this.element?.querySelector("#hotbar");
    if (hotbar) {
      const home = this.hotbarHome;
      const parent = home?.parent?.isConnected ? home.parent : document.getElementById("ui-bottom");
      parent?.insertBefore(hotbar, home?.next?.parentElement === parent ? home.next : null);
    }
    this.hotbarHome = null;
    this.element?.remove();
    this.element = null;
    this.actor = null;
    this.token = null;
    this.effectPanels.renderSidebar(game.user.character?.isOwner ? game.user.character : null);
  }

  reservePlayersSpace() {
    const host = document.getElementById("interface");
    if (!host || !this.element?.isConnected) return;
    // PF2e HUD occupies the left column below Players. Reserve its unscaled
    // height here while the HUD itself remains an independent overlay.
    host.style.setProperty("--swade-hud-players-space", Math.ceil(this.element.offsetHeight + 8) + "px");
    this.layoutHost = host;
  }

  buildMenu(root) {
    const menu = panel(root, "menu");
    const effects = node("div", "group single");
    link(effects, "toggle-effects", "fa-person-rays", "", "Show / hide active effects");
    menu.append(effects);
    const group = node("div", "group");
    link(group, "toggle-avatar", "fa-image-user", "", sbsI18n("swade-hud.UI.Useactortokenportrait_468f2a306b"));
    link(group, "toggle-clean", "fa-chart-bar", "", sbsI18n("swade-hud.UI.Showportraitstatisticsonhover_22fbe4849e"));
    menu.append(group);
    const bottom = node("div", "group bottom");
    link(bottom, "hotbar-lock", ui.hotbar?.locked ? "fa-lock" : "fa-lock-open", "", "Lock / unlock hotbar");
    link(bottom, "hotbar-mute", game.audio?.globalMute ? "fa-volume-xmark" : "fa-volume", "", "Mute / unmute audio");
    link(bottom, "hotbar-clear", "fa-trash", "", sbsI18n("swade-hud.UI.Clearhotbar_496ee3fc7a"));
    menu.append(bottom);
  }

  buildPortrait(root) {
    const actor = this.actor;
    const portrait = panel(root, "portrait");
    const avatar = node("div", "avatar");
    avatar.dataset.action = "open-actor";
    avatar.title = sbsI18n("swade-hud.UI.Opencharactersheet_d9a9cd7e5d");
    const source = (this.appearance.tokenAvatar ? this.token?.document?.texture?.src : actor.img)
      || actor.img || "icons/svg/mystery-man.svg";
    const media = node(/\.(webm|mp4)(\?|$)/i.test(source) ? "video" : "img", "image");
    media.src = source;
    media.alt = actor.name;
    if (media.tagName === "VIDEO") Object.assign(media, { autoplay: true, muted: true, loop: true, playsInline: true });
    avatar.append(media);
    portrait.append(avatar, node("div", "flash"));
    const name = panel(root, "name");
    const title = node("div", "full");
    title.dataset.section = "name";
    title.append(node("span", "", this.token?.name || actor.name));
    name.append(title);
    const stats = panel(root, "stats");
    this.statInput(stats, "wounds", "fa-heart-crack", actor.system.wounds, "Wounds", true);
    this.statInput(stats, "fatigue", "fa-battery-three-quarters", actor.system.fatigue, "Fatigue", true);
    const parry = node("div");
    parry.dataset.section = "parry";
    parry.dataset.modifier = "parry";
    parry.title = sbsI18n("swade-hud.UI.Parry_e5567f841f");
    parry.append(icon("fa-swords"), node("span", "", actor.system.stats?.parry?.value ?? "—"));
    const toughness = node("div");
    toughness.dataset.section = "toughness";
    toughness.dataset.modifier = "toughness";
    toughness.title = sbsI18n("swade-hud.UI.ToughnessArmour_9e8caf20ac");
    toughness.append(icon("fa-shield-halved"));
    const values = node("span", "toughness-values");
    const value = node("span", "", actor.system.stats?.toughness?.value ?? "—");
    value.dataset.modifier = "toughness";
    value.title = sbsI18n("swade-hud.UI.ToughnessRightclickforatemporary_6a53322cd2");
    const armour = node("span", "", "(" + (actor.system.stats?.toughness?.armor ?? 0) + ")");
    armour.dataset.modifier = "armour";
    armour.title = sbsI18n("swade-hud.UI.ArmourRightclickforatemporary_ccf63267d5");
    values.append(value, document.createTextNode(" "), armour);
    toughness.append(values);
    stats.append(parry, toughness);
  }
  statInput(parent, key, glyph, data, title, double) {
    const section = node("div");
    section.dataset.section = key;
    section.title = title;
    const adjust = link(section, "resource-adjust", glyph, "", title + " · Left-click +1 · Right-click −1", { key });
    adjust.className = "stat-resource-icon";
    if (key === "wounds") {
      adjust.title += sbsI18n("swade-hud.UI.ShiftLeftclicktoggleShakenShift_0d938cbc6a");
      adjust.setAttribute("aria-label", adjust.title);
    }
    if (double) {
      const numbers = node("div", "numbers");
      const field = input(numbers, data?.value ?? 0, { path: "system." + key + ".value" });
      field.disabled = !this.owned || !data;
      field.setAttribute("aria-label", title);
      numbers.append(node("span", "separator", "/"), node("span", "max", data?.max ?? "—"));
      section.append(numbers);
    } else {
      const field = input(section, data?.value ?? 0, { path: "system." + key + ".value" }, true);
      field.disabled = !this.owned || !data;
      field.setAttribute("aria-label", title);
    }
    parent.append(section);
  }
  buildStatistics(root) {
    const actor = this.actor;
    const details = panel(root, "details");
    this.statLink(details, "advance", "fa-user-graduate", actor.system.advances?.value ?? "—", "Advances");
    this.statLink(details, "running", "fa-shoe-prints", actor.system.pace?.default ?? actor.system.pace?.ground ?? "—", sbsI18n("swade-hud.UI.Pacerollrunning_ac22b4dc7b"));
    const statistics = panel(root, "statistics");
    for (const [key, label, glyph] of ATTRIBUTES) {
      const data = actor.system.attributes?.[key];
      if (!data) continue;
      const el = this.statLink(statistics, "attribute", glyph, dieLabel(data.die), localize(label, key), { attribute: key });
      el.draggable = true;
      el.dataset.dragType = "attribute";
    }
    const notice = itemsOf(actor, "skill").find((item) => item.system.swid === "notice");
    this.statLink(statistics, "skill", "fa-eye", notice ? dieLabel(notice.system.die, notice.modifier) : "—", "Notice", { itemId: notice?.id });
    const disposition = panel(root, "alliance");
    const detailsValue = dispositionDetails(this.token?.document?.disposition);
    this.statLink(disposition, "disposition", detailsValue.icon, detailsValue.letter, "Disposition");
    const resources = panel(root, "resources");
    const pools = powerPools(actor).filter(([name]) => !powerPoolUsesNoPP(actor, name));
    const [poolName, pool] = pools.find(([name]) => name === "general") ?? pools[0] ?? [];
    if (!game.settings.get("swade", "noPowerPoints") && pool) this.slider(resources, "powerPoints", "fa-sparkles", pool.value, sbsI18n("swade-hud.UI.PowerPoints_844847817f"), { pool: poolName });
    const bennies = bennyPool(actor);
    const bennyRow = this.slider(resources, "bennies", bennies.icon, bennies.value, bennies.label);
    resources.classList.toggle("bennies-only", !resources.querySelector('[data-section="powerPoints"]'));
    if (!bennies.editable) for (const control of bennyRow.querySelectorAll("a")) {
      control.classList.add("disabled");
      control.setAttribute("aria-disabled", "true");
    }
  }
  statLink(parent, action, glyph, value, title, data = {}) {
    const el = link(parent, action, glyph, value, title, data);
    el.dataset.section = action;
    return el;
  }
  slider(parent, key, glyph, value, title, extra = {}) {
    const row = node("div");
    row.dataset.section = key;
    row.title = title;
    const resourceIcon = link(row, "resource-adjust", glyph, "", title + " · Left-click +1 · Right-click −1",
      { key, ...extra });
    resourceIcon.className = "resource-icon";
    const slider = node("div", "slider");
    const amount = link(slider, "resource-adjust", "", value, title + " · Left-click +1 · Right-click −1", { key, ...extra });
    amount.className = "value resource-value";
    if (key === "powerPoints") {
      row.dataset.modifier = "powerPoints";
      row.dataset.pool = extra.pool ?? "";
      amount.title += sbsI18n("swade-hud.UI.Shiftrightclickforatemporary_226df1efaa");
      resourceIcon.title = amount.title;
    }
    row.append(slider);
    parent.append(row);
    return row;
  }
  buildSidebars(root) {
    const bar = panel(root, "sidebars");
    for (const [key, title, glyph] of SIDEBARS) {
      const el = link(bar, "sidebar", glyph, "", title, { sidebar: key });
      if (key === this.activeSidebar) el.classList.add("active");
    }
  }
  shortcuts() {
    const stored = this.profile.pages?.[this.page];
    if (stored) return stored;
    return Array(18).fill(null);
  }
  resolveShortcut(shortcut) {
    if (!shortcut) return null;
    if (shortcut.type === "attribute") {
      const attribute = ATTRIBUTES.find(([key]) => key === shortcut.key);
      if (!attribute) return null;
      return { name: localize(attribute[1], shortcut.key), img: "icons/svg/dice-target.svg",
        label: dieLabel(this.actor.system.attributes?.[shortcut.key]?.die), icon: attribute[2] };
    }
    const doc = fromUuidSync(shortcut.uuid);
    if (!doc) return null;
    const item = doc.documentName === "Item";
    const traitName = doc.system?.actions?.trait;
    const trait = itemsOf(this.actor, "skill").find((skill) => skill.name === traitName || skill.system.swid === traitName);
    return { doc, name: doc.name, img: doc.img, icon: !item ? "fa-play"
      : doc.type === "weapon" ? "fa-sword" : doc.type === "power" ? "fa-wand-magic-sparkles" : "fa-play",
      label: doc.type === "weapon" && trait ? dieLabel(trait.system.die, trait.modifier) : "",
      count: doc.type === "weapon" && doc.system.shots ? doc.system.currentShots
        : item && PHYSICAL.includes(doc.type) ? doc.system.quantity : null,
      cost: doc.type === "power" ? doc.system.ppModifiers?.cost ?? doc.system.pp : null };
  }
  buildShortcuts(root) {
    const grid = panel(root, "shortcuts");
    const shortcuts = this.shortcuts();
    for (let index = 0; index < 18; index++) {
      const slot = node("div", "shortcut");
      slot.dataset.slot = String(index);
      const shortcut = shortcuts[index];
      const info = this.resolveShortcut(shortcut);
      if (!info) slot.classList.add("empty");
      else {
        slot.classList.add("item");
        slot.dataset.action = "shortcut";
        slot.draggable = true;
        slot.title = info.name;
        slot.setAttribute("aria-label", info.name);
        slot.tabIndex = 0;
        const image = node("div", "image");
        image.style.backgroundImage = "url(" + JSON.stringify(info.img) + ")";
        styleTier(info.doc, {icon: image});
        slot.append(image);
        const glyph = node("div", "icon");
        glyph.append(icon(info.icon));
        slot.append(glyph, node("div", "overlay"));
        const coatings = coatingIcons(info.doc);
        if (coatings) slot.append(coatings);
        slot.addEventListener("mouseenter", () => this.showTooltip(slot, info));
        slot.addEventListener("mouseleave", () => this.hideTooltip());
      }
      grid.append(slot);
    }
  }
  buildShortcutMenu(root) {
    const menu = panel(root, "shortcuts-menu");
    const tabs = node("div", "tabs");
    const title = sbsI18n("swade-hud.UI.ShortcutpageLeftclicknextRight_f69d18107c");
    link(tabs, "shortcut-page", "fa-grid-2", "", title, { delta: 1 }).className = "shortcut-page-icon";
    const slider = node("div", "slider");
    link(slider, "shortcut-page", "", this.page + 1, title, { delta: 1 }).className = "value";
    tabs.append(slider);
    menu.append(tabs);
    const used = Boolean(reactionEffect(this.actor));
    const reaction = link(menu, "reaction", "fa-rotate-right", "", used ? sbsI18n("swade-hud.UI.RemoveReactionused_8fdf41998d") : sbsI18n("swade-hud.UI.MarkReactionused1round_611e3011d0"));
    reaction.classList.toggle("active", used);
    reaction.setAttribute("aria-pressed", String(used));
    link(menu, "prototype-token", "fa-user-pen", "", sbsI18n("swade-hud.UI.PrototypeToken_d09ca5b5c7"));
    link(menu, "scale", "fa-expand", actorSize(this.actor),
      sbsI18n("swade-hud.UI.ScaleLeftclick1Rightclick_4320aa025c"));
    const bin = panel(menu, "shortcut-bin");
    bin.dataset.action = "shortcut-bin";
    bin.append(icon("fa-trash-can"));
  }

  renderSidebar() {
    this.effectPanels.hideListTooltip();
    const zIndex = this.sidebar?.style.zIndex;
    const scroll = this.sidebar?.querySelector(".inner")?.scrollTop ?? 0;
    const search = this.sidebar?.querySelector("input[type=text]")?.value ?? "";
    const filterVisible = this.sidebar?.querySelector('[data-panel="filter"]')?.classList.contains("visible");
    const focused = document.activeElement;
    const focusedSkill = this.sidebar?.contains(focused) && focused.matches(".skill-actions-toggle")
      ? focused.dataset.itemId : null;
    this.closeSidebarContextMenu();
    this.sidebar?.remove();
    const sidebar = node("div", "swade-hud-element");
    sidebar.id = "swade-hud-sidebar";
    sidebar.dataset.type = this.activeSidebar;
    sidebar.dataset.hud = "persistent";
    this.bind(sidebar);
    const inner = node("div", "inner");
    const list = node("div", "item-list");
    switch (this.activeSidebar) {
      case "actions": this.actionSidebar(list); break;
      case "items": this.inventorySidebar(list); break;
      case "spells": this.powerSidebar(list); break;
      case "skills": this.skillSidebar(list); break;
      case "feats": this.featureSidebar(list); break;
      case "extras": this.extrasSidebar(list); break;
      case "utilities": this.utilitiesSidebar(list); break;
    }
    inner.append(list);
    sidebar.append(inner);
    const filter = panel(sidebar, "filter");
    filter.classList.toggle("visible", Boolean(search) || !!filterVisible);
    const field = node("input");
    field.type = "text";
    field.placeholder = sbsI18n("swade-hud.UI.Filter_638e249f4a");
    field.value = search;
    field.addEventListener("input", () => {
      this.filteredSkillExpansion.clear();
      this.filterSidebar(field.value);
    });
    filter.append(field);
    document.body.append(sidebar);
    this.sidebar = sidebar;
    if (zIndex) sidebar.style.zIndex = zIndex;
    else raiseHudPanel(sidebar);
    sidebar.addEventListener("pointerdown", () => raiseHudPanel(sidebar), { capture: true });
    if (this.activeSidebar === "extras") {
      this.bindEffectContextMenu(sidebar);
      sidebar.addEventListener("scroll", () => this.effectPanels.positionTooltip(), true);
    } else this.bindItemContextMenu(sidebar);
    this.positionSidebar();
    inner.scrollTop = scroll;
    if (search) this.filterSidebar(search);
    if (focusedSkill) sidebar.querySelector(`#swade-hud-skill-toggle-${CSS.escape(focusedSkill)}`)?.focus({ preventScroll: true });
  }
  positionSidebar() {
    if (!this.sidebar || !this.element) return;
    const active = this.element.querySelector('[data-sidebar="' + this.activeSidebar + '"]');
    if (!active) return;
    const anchor = active.getBoundingClientRect();
    const scale = this.element.getBoundingClientRect().width / this.element.offsetWidth || 1;
    const arrowSize = 2 * parseFloat(getComputedStyle(this.element).getPropertyValue("--sidebar-external-padding")) * scale;
    const available = Math.max(80, (anchor.top - arrowSize) / scale);
    const sidebar = this.sidebar;
    sidebar.style.setProperty("--ui-scale", scale);
    sidebar.style.setProperty("--max-height", available + "px");
    const inner = sidebar.querySelector(".inner");
    const list = sidebar.querySelector(".item-list");
    sidebar.style.left = "0px";
    sidebar.style.top = "0px";
    sidebar.style.setProperty("--nb-columns", "1");
    const style = getComputedStyle(sidebar);
    const em = parseFloat(style.fontSize);
    const columnWidth = parseFloat(style.getPropertyValue("--max-column-width")) * em;
    list.style.width = columnWidth + "px";
    const maxColumns = Math.max(1, Math.min(5, Math.floor((innerWidth / scale - 28) / columnWidth)));
    let contentHeight = list.scrollHeight;
    let columnHeight = Math.max(50, available - 30);
    if (this.activeSidebar === "skills") {
      const sections = [...list.querySelectorAll(".skill-section:not([hidden])")];
      const height = section => section.offsetHeight + parseFloat(getComputedStyle(section).marginBottom);
      const footer = sections.find(section => section.classList.contains("unskilled-attempt"));
      const heights = sections.filter(section => section !== footer).map(height);
      // Skill accordions stay together. A tall accordion sets the minimum
      // column height, while Unskilled Attempt spans below all columns.
      contentHeight = heights.reduce((total, value) => total + value, 0);
      columnHeight = Math.max(50, columnHeight - (footer ? height(footer) : 0), ...heights);
    }
    // Effects have two explicit columns, rather than flowing across CSS columns.
    const columns = this.activeSidebar === "extras" ? Math.max(1, list.querySelectorAll(".effect-column:not([hidden])").length)
      : Math.min(maxColumns, Math.max(1, Math.ceil(contentHeight / columnHeight)));
    sidebar.style.setProperty("--nb-columns", String(columns));
    const listWidth = columns * columnWidth + (columns - 1) * 4;
    list.style.width = (this.activeSidebar === "extras"
      ? Math.min(listWidth, innerWidth / scale - 2 * parseFloat(style.paddingLeft) - 12) : listWidth) + "px";
    sidebar.style.position = "fixed";
    const bounds = sidebar.getBoundingClientRect();
    sidebar.style.left = Math.max(0, Math.min(anchor.left + anchor.width / 2 - bounds.width / 2, innerWidth - bounds.width)) + "px";
    const bottomPadding = parseFloat(style.paddingBottom) * scale;
    sidebar.style.top = Math.max(0, anchor.top - arrowSize + bottomPadding - bounds.height) + "px";
    if (this.effectPanels.tooltipPanel === sidebar) this.effectPanels.positionTooltip();
  }
  closeSidebar() {
    this.effectPanels.hideListTooltip();
    this.closeSidebarContextMenu();
    this.sidebarContextMenu = null;
    this.filteredSkillExpansion.clear();
    this.sidebar?.remove();
    this.sidebar = null;
    this.activeSidebar = null;
    this.element?.querySelectorAll("[data-sidebar]").forEach((el) => el.classList.remove("active"));
  }
  filterSidebar(value) {
    this.effectPanels.hideListTooltip();
    this.closeSidebarContextMenu();
    const query = value.trim().toLocaleLowerCase();
    const entries = this.sidebar.querySelectorAll("[data-filter-value]");
    entries.forEach((el) => {
      el.classList.remove("filtered");
      el.hidden = Boolean(query) && !el.dataset.filterValue.includes(query);
    });
    const visibleEntry = el => [...el.querySelectorAll("[data-filter-value]")].some(entry => !entry.hidden);
    this.sidebar.querySelectorAll(".effect-group,.effect-column,.skill-section").forEach(el => { el.hidden = Boolean(query) && !visibleEntry(el); });
    for (const section of this.sidebar.querySelectorAll(".skill-section:not([hidden])")) {
      const heading = section.querySelector(".skill-heading");
      heading.hidden = false;
      const actions = section.querySelector(".skill-actions");
      if (!actions) continue;
      const id = heading.dataset.itemId;
      const expanded = this.isSkillExpanded(id) || (Boolean(query) && visibleEntry(actions));
      this.setSkillActionsExpanded(section, this.filteredSkillExpansion.get(id) ?? expanded);
    }
    this.sidebar.querySelectorAll("header").forEach(heading => {
      const members = [];
      for (let next = heading.nextElementSibling; next && next.tagName !== "HEADER"; next = next.nextElementSibling) {
        if (next.matches("[data-filter-value]")) members.push(next);
        members.push(...next.querySelectorAll("[data-filter-value]"));
      }
      heading.hidden = Boolean(query) && !heading.closest(".skill-section") && !members.some(entry => !entry.hidden);
    });
    let empty = this.sidebar.querySelector(".search-empty");
    if (!empty) { empty = node("p", "empty search-empty", sbsI18n("swade-hud.UI.Nomatches_2df01a03ff")); this.sidebar.querySelector(".item-list").append(empty); }
    empty.hidden = !query || [...entries].some(entry => !entry.hidden);
    this.positionSidebar();
  }
  itemShell(parent, item, className = "", tag = sbsI18n("swade-hud.UI.div_cd35a24260")) {
    const row = node(tag, "item " + className);
    row.dataset.itemId = item.id;
    row.dataset.filterValue = item.name.toLocaleLowerCase();
    row.draggable = true;
    parent.append(row);
    return row;
  }
  itemImage(parent, item) {
    const image = link(parent, "item-description", "", "", "Read " + item.name + " · Shift-click to send to chat");
    image.className = "image";
    image.dataset.itemChatGesture = "";
    const img = node("img");
    img.src = item.img || "icons/svg/item-bag.svg";
    img.alt = "";
    image.append(img, icon("fa-book-open", "chat"));
    styleTier(item, {icon: image});
  }
  itemName(parent, item) {
    const name = node("div", "name");
    const label = link(name, "item-description", "", item.name, item.name + " · Shift-click to send to chat");
    label.dataset.itemChatGesture = "";
    styleTier(item, {name: label});
    parent.append(name);
    return name;
  }
  variant(parent, item, label, action, className = "") {
    const el = link(parent, "item-action", "", label, label, { itemId: item.id, itemAction: action });
    el.className = "variant " + className;
    return el;
  }
  actionVariants(parent, item, { baseDamage = false } = {}) {
    const actions = Object.entries(item.system.actions?.additional ?? {})
      .filter(([, action]) => !(item.type === "weapon" && isOpposedAction(action))
        && !(isBoostLowerTrait(item) && (action.type === "resist" || /^resist$/i.test(action.name ?? ""))));
    if (!actions.length && !(baseDamage && item.system.damage)) return;
    const variants = node("div", "variants controls");
    variants.dataset.itemId = item.id;
    variants.dataset.filterValue = item.name.toLocaleLowerCase();
    if (baseDamage && item.system.damage) this.variant(variants, item, "Damage (" + item.system.damage + ")", "damage", "damage");
    for (const [key, action] of actions) this.variant(variants, item, action.name || key, key, action.type === "damage" ? "damage" : "");
    parent.append(variants);
  }
  actionSidebar(list) {
    const toggles = node("div", "hud-attack-options");
    for (const option of attackOptions(this.actor)) {
      const label = node("label");
      const field = node("input");
      field.type = "checkbox";
      field.checked = attackOptionState(this.actor, option.id);
      label.title = option.help;
      field.addEventListener("change", () => {
        setAttackOption(this.actor, option.id, field.checked);
        this.schedule();
      });
      label.append(field, node("span", "", option.label));
      toggles.append(label);
    }
    list.append(toggles);
    if (this.owned) link(list, "generate-actions", "fa-list-check", sbsI18n("swade-hud.UI.Generatebasicactions_f3bcac1a6c"), sbsI18n("swade-hud.UI.Generatebasicactions_f3bcac1a6c"));
    const weapons = sorted(itemsOf(this.actor, "weapon"));
    header(list, "Attacks");
    for (const item of weapons) {
      const row = this.itemShell(list, item, "attack ready");
      const name = node("div", "name weapon-heading");
      this.itemImage(name, item);
      const label = link(name, "item-description", "", item.name, item.name + " · Shift-click to send to chat");
      label.dataset.itemChatGesture = "";
      styleTier(item, {name: label});
      const coatings = coatingIcons(item, true);
      if (coatings) name.append(coatings);
      row.append(name);
      const variants = node("div", "variants");
      variants.append(icon("fa-sword", "category"));
      this.variant(variants, item, "Attack", "formula", "attack");
      if (item.system.damage) this.variant(variants, item, "Damage", "damage", "damage");
      if (item.system.hasReloadButton) this.variant(variants, item, "Reload", "reload", "auxiliary");
      row.append(variants);
      if (item.system.range || item.system.shots) {
        const stats = node("div", "variants controls");
        if (item.system.range) stats.append(node("span", "variant info", "Range " + item.system.range));
        if (item.system.shots) stats.append(node("span", "variant info", "Ammo " + item.system.currentShots + "/" + item.system.shots));
        row.append(stats);
      }
      this.actionVariants(row, item);
    }
    if (!weapons.length) list.append(node("p", "empty", sbsI18n("swade-hud.UI.Noweapons_0097db6895")));
    this.actionItems(list, itemsOf(this.actor, "action", "ability")
      .filter(item => !item.system.hidden && !isChaseAction(item) && !isResistanceOnlyAction(item) && !actionUsesSkill(item))
      .filter(item => ![actionKind(item), item.system.swid, item.name]
        .some(value => /^(natural[ -]healing|wild[ -]attack)$/i.test(value ?? ""))), "Actions & Abilities");
  }
  actionItems(list, items, title) {
    if (!items.length) return;
    header(list, title);
    for (const item of this.favoriteActions(items)) {
      const row = this.actionRow(list, item);
      const coatings = coatingIcons(item, true);
      if (coatings) row.append(coatings);
    }
  }
  actionRow(parent, item) {
    const row = this.itemShell(parent, item, "action trait-action-row");
    this.itemImage(row, item);
    const label = basicActionLabel(item);
    row.dataset.filterValue += " " + label.toLocaleLowerCase();
    const name = link(row, "choose-action", "", label, "Use " + label + " · Shift-click to send to chat");
    name.dataset.itemChatGesture = "";
    styleTier(item, {name});
    this.actionStar(row, item);
    return row;
  }
  async chooseItemAction(item, event) {
    const actor = this.actor;
    const actions = itemShortcutActions(actor, item);
    if (!actions.length && ["chase-evade", "chase-steady"].includes(actionKind(item))) {
      return useItem(actor, item, "formula", event);
    }
    if (!actions.length) return this.showDescription(item);
    const choice = actions.length === 1 ? actions[0].key : await foundry.applications.api.DialogV2.wait({
      window: {title: basicActionLabel(item)}, classes: ["swade-hud-action-choices"], rejectClose: false,
      buttons: actions.map(({key, label}) => ({action: key, label: foundry.utils.escapeHTML(label)})),
    });
    if (choice && this.actor === actor && actor.items.get(item.id) === item) {
      return useItem(actor, item, choice, event, {nativeOnly: true});
    }
  }
  favoriteActions(items) {
    const favorites = new Set(this.profile.actionFavorites ?? []);
    return sorted(items).sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
  }
  actionStar(parent, item) {
    const starred = this.profile.actionFavorites?.includes(item.id) ?? false;
    const button = link(parent, "action-favorite", starred ? "fa-star" : "fa-star fa-regular", "",
      (starred ? sbsI18n("swade-hud.UI.Unstar_053662946a") : sbsI18n("swade-hud.UI.Star_0bb8478a5e")) + item.name, { itemId: item.id });
    const glyph = button.querySelector("i");
    if (!starred) glyph.classList.remove("fa-solid");
    button.className = "action-star" + (starred ? " starred" : "");
    button.setAttribute("aria-pressed", String(starred));
  }
  skillSidebar(list) {
    const skills = sorted(itemsOf(this.actor, "skill"));
    const unskilled = skills.find(isUnskilledAttempt);
    for (const item of [...skills.filter(skill => !isUnskilledAttempt(skill)), ...(unskilled ? [unskilled] : [])]) {
      const section = node("section", "skill-section");
      if (item === unskilled) section.classList.add("unskilled-attempt");
      list.append(section);
      const row = this.itemShell(section, item, "statistic proficient skill-heading", "h3");
      row.dataset.modifier = "skill";
      row.title = sbsI18n("swade-hud.UI.RightclickEditDeleteShiftRight_7ac4ad51ae");
      this.itemImage(row, item);
      const name = node("div", "name");
      const roll = link(name, "skill", "", "", "Roll " + item.name, { itemId: item.id });
      roll.dataset.itemChatGesture = "";
      roll.append(node("span", "skill-title", item.name), node("span", "skill-die", dieLabel(item.system.die, item.modifier)));
      row.append(name);
      const attr = ATTRIBUTES.find(([key]) => key === item.system.attribute);
      if (attr) {
        const attribute = node("span", "attribute-name", localize(attr[1], attr[0]));
        attribute.dataset.modifier = "attribute";
        attribute.dataset.attribute = attr[0];
        attribute.title = sbsI18n("swade-hud.UI.Rightclickforatemporaryattribute_a804eb6898");
        row.append(attribute);
      }
      if (item === unskilled) continue;
      const common = node("div", "skill-common");
      common.dataset.filterValue = ("support test earn " + commonSkillActionLabel("earn") + " " + item.name).toLocaleLowerCase();
      for (const kind of Object.keys(COMMON_SKILL_ACTIONS)) {
        const label = commonSkillActionLabel(kind);
        link(common, "skill-common", "", label, label + " with " + item.name, {itemId: item.id, kind});
      }
      section.append(common);
      const toggle = link(section, "toggle-skill-actions", "fa-chevron-right", "Actions", "Actions for " + item.name,
        { itemId: item.id });
      toggle.className = "skill-actions-toggle";
      toggle.id = "swade-hud-skill-toggle-" + item.id;
      toggle.setAttribute("aria-controls", "swade-hud-skill-actions-" + item.id);
      const body = node("div", "skill-actions");
      body.id = toggle.getAttribute("aria-controls");
      section.append(body);
      this.setSkillActionsExpanded(section, this.isSkillExpanded(item.id));
      const actions = Map.groupBy(skillActions(this.actor, item), entry => entry.item);
      const entries = [...actions.keys()].filter(action => !["support", "test", "earn"].includes(actionKind(action)));
      for (const action of this.favoriteActions(entries)) {
        const actionRow = this.actionRow(body, action);
        actionRow.dataset.filterValue += " " + item.name.toLocaleLowerCase()
          + " " + actions.get(action).map(entry => entry.variant ?? "").join(" ").toLocaleLowerCase();
      }
    }
    if (!unskilled && canRollSkills(this.actor)) {
      const title = localize("SWADE.Unskilled", sbsI18n("swade-hud.UI.UnskilledAttempt_63ecc95eac"));
      const section = node("section", "skill-section unskilled-attempt");
      const row = node("h3", "item statistic proficient skill-heading");
      row.dataset.filterValue = title.toLocaleLowerCase();
      const name = node("div", "name");
      const roll = link(name, "unskilled", "fa-dice-d4", "", "Roll " + title);
      roll.append(node("span", "skill-title", title), node("span", "skill-die", sbsI18n("swade-hud.UI.d42_273b8b713a")));
      row.append(name);
      section.append(row);
      list.append(section);
    }
  }
  setSkillActionsExpanded(section, expanded) {
    section.querySelector(".skill-actions").hidden = !expanded;
    section.querySelector(".skill-actions-toggle").setAttribute("aria-expanded", String(expanded));
  }
  isSkillExpanded(skillId) {
    return this.pendingSkillExpansion.get(this.profileKey)?.get(skillId)?.expanded
      ?? this.profile.expandedSkills?.includes(skillId) ?? false;
  }
  toggleSkillActions(target, skillId) {
    const section = target.closest(".skill-section");
    const expanded = section.querySelector(".skill-actions").hidden;
    const searching = Boolean(this.sidebar.querySelector('[data-panel="filter"] input').value.trim());
    this.setSkillActionsExpanded(section, expanded);
    this.positionSidebar();
    if (searching) this.filteredSkillExpansion.set(skillId, expanded);
    return this.saveSkillExpansion(skillId, expanded);
  }
  saveSkillExpansion(skillId, expanded) {
    const profileKey = this.profileKey;
    const pending = this.pendingSkillExpansion.get(profileKey) ?? new Map();
    const change = { expanded };
    pending.set(skillId, change);
    this.pendingSkillExpansion.set(profileKey, pending);
    const write = this.skillExpansionWrite.catch(() => {}).then(async () => {
      try {
        if (pending.get(skillId) !== change) return;
        const openSkills = new Set(this.profiles[profileKey]?.expandedSkills ?? []);
        if (expanded) openSkills.add(skillId);
        else openSkills.delete(skillId);
        await game.user.update({ [`flags.${MODULE_ID}.profiles.${profileKey}.expandedSkills`]: [...openSkills] });
      } catch (error) {
        this.schedule();
        throw error;
      } finally {
        if (pending.get(skillId) === change) pending.delete(skillId);
        if (!pending.size) this.pendingSkillExpansion.delete(profileKey);
      }
    });
    this.skillExpansionWrite = write;
    return write;
  }
  utilitiesSidebar(list) {
    header(list, "Extras");
    for (const [key, label, glyph] of EXTRAS) {
      const row = node("div", "row");
      row.dataset.filterValue = label.toLocaleLowerCase();
      const control = link(row, "extra", glyph, label, label, {extra: key});
      if (key === "natural-healing" && naturalHealingCooldown(this.actor)) {
        control.classList.add("disabled");
        control.setAttribute("aria-disabled", "true");
        control.title = sbsI18n("swade-hud.UI.NaturalHealingisoncooldown_14e59d7bbf");
      }
      if (key === "hold") {
        const held = Boolean(holdCombatant(this.actor, this.token?.document)?.roundHeld);
        control.setAttribute("aria-pressed", String(held));
        control.title = held ? sbsI18n("swade-hud.UI.LeftclickActNowRightclick_7b8ae2e472") : sbsI18n("swade-hud.UI.Holdonthiscombatantsturn_c61449ed9a");
      }
      list.append(row);
    }
  }
  featureSidebar(list) {
    for (const [type, title] of [["ancestry", sbsI18n("swade-hud.UI.Ancestry_65a0468287")], ["edge", sbsI18n("swade-hud.UI.Edges_658b158af9")], ["hindrance", sbsI18n("swade-hud.UI.Hindrances_6276d146ad")], ["ability", sbsI18n("swade-hud.UI.SpecialAbilities_baea04bd44")]]) {
      const items = sorted(itemsOf(this.actor, type));
      if (!items.length) continue;
      header(list, title);
      for (const item of items) {
        const row = this.itemShell(list, item, "feat");
        this.itemImage(row, item);
        this.itemName(row, item);
      }
    }
    if (!list.childElementCount) list.append(node("p", "empty", sbsI18n("swade-hud.UI.NoEdgesorHindrances_60557964f6")));
  }
  inventorySidebar(list) {
    const actor = this.actor;
    const wealth = node("div", "inventory-wealth");
    const coins = node("div", "coins");
    coins.append(icon("fa-coins"), node("span", "", "Wealth: " + (actor.system.details?.currency ?? 0)));
    wealth.append(coins);
    list.append(wealth);
    const enc = actor.system.details?.encumbrance;
    if (enc) {
      const bulk = node("div", "inventory-bulk");
      bulk.append(icon("fa-weight-hanging"));
      const meter = node("div", "encumbrance");
      const bar = node("div", "encumbrance-bar" + (enc.value > enc.max ? " over-limit" : ""));
      bar.style.width = Math.min(100, enc.max > 0 ? enc.value / enc.max * 100 : 0) + "%";
      meter.append(bar, node("div", "left", weightLabel(enc.value) + " / " + weightLabel(enc.max)), node("div", "right", game.settings.get("swade", "weightUnit") === "imperial" ? "lb" : "kg"));
      bulk.append(meter);
      list.append(bulk);
    }
    for (const [types, title] of [[["weapon", "shield"], sbsI18n("swade-hud.UI.WeaponsShields_1775a3ab1b")], [["armor"], sbsI18n("swade-hud.UI.Armor_a592855d05")], [["gear"], sbsI18n("swade-hud.UI.Equipment_7f2465ac7c")], [["consumable"], sbsI18n("swade-hud.UI.Consumables_7cb53ac085")]]) {
      const items = sorted(itemsOf(actor, ...types));
      if (!items.length) continue;
      header(list, title);
      for (const item of items) this.inventoryItem(list, item);
    }
  }
  inventoryItem(list, item) {
    const row = this.itemShell(list, item);
    this.itemImage(row, item);
    const details = node("div", "details");
    this.itemName(details, item);
    const extras = node("div", "extras");
    const stats = node("div", "stats");
    const quantity = node("div", "quantity");
    input(quantity, item.system.quantity ?? 1, { itemId: item.id, itemProperty: "system.quantity" });
    const weight = node("div", "bulk");
    weight.append(icon("fa-scale-balanced"), node("span", "", weightLabel(item.system.weight)));
    stats.append(quantity, weight);
    const controls = node("div", "item-controls");
    if (item.type === "consumable" || item.system.actions?.trait) {
      link(controls, item.type === "consumable" ? "consume" : "item-action", "fa-play", "", sbsI18n("swade-hud.UI.Useitem_1e14a7f3be"),
        { itemId: item.id, itemAction: "formula" });
    }
    if ("equipStatus" in item.system) {
      const equip = link(controls, "equip", "fa-shirt", "", sbsI18n("swade-hud.UI.Toggleequippedcarried_74aea1cdf8"), { itemId: item.id });
      equip.className = "item-carry-type worn" + (item.system.equipStatus >= 2 ? " active" : "");
    }
    link(controls, "item-description", "fa-circle-question", "", sbsI18n("swade-hud.UI.Itemdescription_89ed70057c"), { itemId: item.id });
    link(controls, "edit-item", "fa-pen-to-square", "", sbsI18n("swade-hud.UI.Edititem_9f84eeebf8"), { itemId: item.id });
    link(controls, "delete-item", "fa-trash", "", sbsI18n("swade-hud.UI.Deleteitem_a12c385440"), { itemId: item.id }).className = "delete";
    extras.append(stats, controls);
    details.append(extras);
    row.append(details);
  }
  powerSidebar(list) {
    if (this.owned && game.modules.get("swade-better-powers")?.api?.openPowerTimers) {
      link(header(list, "").firstElementChild, "power-timers", "fa-hourglass-half", sbsI18n("swade-hud.UI.PowerTimers_967db5e745"), sbsI18n("swade-hud.UI.PowerTimers_967db5e745"));
    }
    const powers = sorted(itemsOf(this.actor, "power"));
    const groups = Map.groupBy(powers, (item) => item.system.arcane || "general");
    for (const [key, items] of groups) {
      const title = header(list, key === "general" ? sbsI18n("swade-hud.UI.Powers_3286cc91e5") : key);
      const pool = this.actor.system.powerPoints?.[key];
      if (pool && !powerPoolUsesNoPP(this.actor, key)) {
        const controls = node("div", "controls power-pool");
        controls.dataset.modifier = "powerPoints";
        controls.dataset.pool = key;
        input(controls, pool.value, { pool: key }, true).setAttribute("aria-label", key + " Power Points");
        controls.append(node("span", "", "/ " + pool.max));
        title.append(controls);
      }
      for (const item of items) {
        const row = this.itemShell(list, item, "chat-card power-row");
        this.itemImage(row, item);
        const details = node("div", "details");
        this.itemName(details, item);
        const extras = node("div", "extras");
        const category = node("div");
        category.dataset.section = "category";
        category.className = "power-range";
        const templates = powerTemplates(item);
        if (!isTemplateRange(item.system.range) || !templates.length) {
          const distance = node("span", "power-distance");
          distance.append(icon("fa-ruler"), node("span", "", item.system.range || "—"));
          distance.title = sbsI18n("swade-hud.UI.Range_5de74a81b1");
          category.append(distance);
        }
        templates.forEach((template, index) => {
          if (index) category.append(document.createTextNode(", "));
          link(category, "place-template", "fa-ruler-combined", template.label, template.title,
            { itemId: item.id, preset: template.preset }).className = "template-option";
        });
        const actions = node("div", "actions");
        const presentation = powerCostPresentation(item, this.actor);
        const cost = node("span", "pp-cost", presentation.text);
        cost.title = presentation.title;
        actions.append(cost);
        link(actions, "item-action", "fa-play", "", sbsI18n("swade-hud.UI.Castpower_eb8ed5b2f2"), { itemId: item.id, itemAction: "formula" }).className = "cast";
        extras.append(category, actions);
        details.append(extras);
        row.append(details);
        this.actionVariants(list, item, { baseDamage: true });
      }
    }
    if (!powers.length) list.append(node("p", "empty", sbsI18n("swade-hud.UI.Nopowers_901a19c71a")));
  }
  extrasSidebar(list) {
    list.classList.add("effects-columns");
    const favorites = new Set(this.profile.effectFavorites ?? []);
    const actorColumn = node("section", "effect-column actor-effect-list");
    header(actorColumn, sbsI18n("swade-hud.UI.ActorEffects_3ca787fbee"));
    const effects = nonSystemEffects(this.actor);
    const starred = effects.filter((effect) => favorites.has("effect:" + effect.uuid));
    const remaining = effects.filter((effect) => !favorites.has("effect:" + effect.uuid));
    const temporary = effect => Boolean(effect.flags?.[MODULE_ID]?.support)
      || (effect.isTemporary ?? Number.isFinite(effect.duration?.value));
    for (const [label, entries] of [[sbsI18n("swade-hud.UI.Starred_07a2d579c3"), starred], [sbsI18n("swade-hud.UI.TemporaryEffects_fb4833a441"), remaining.filter(temporary)],
      [sbsI18n("swade-hud.UI.PermanentEffects_2f38cd5b6d"), remaining.filter((effect) => !temporary(effect))]]) {
      if (!entries.length) continue;
      const group = node("div", "effect-group");
      group.append(node("h3", "effect-group-title", label));
      for (const effect of entries) {
        const active = effect.active !== false && !effect.disabled;
        const source = effect.parent?.documentName === "Item" ? effect.parent.name : "";
        const detail = [active ? "" : sbsI18n("swade-hud.UI.Disabled_75081b593d"), temporary(effect) ? effectDuration(effect).label : sbsI18n("swade-hud.UI.Permanent_455a95491f"), source]
          .filter(Boolean).join(" · ");
        this.effectListRow(group, { name: effect.name, img: effect.img, active, detail,
          action: "effect-toggle", data: { effectUuid: effect.uuid }, favoriteKey: "effect:" + effect.uuid, favorites });
      }
      actorColumn.append(group);
    }
    if (!effects.length) actorColumn.append(node("p", "empty", sbsI18n("swade-hud.UI.Noactoreffects_743c546daa")));
    const systemColumn = node("section", "effect-column system-effect-list");
    header(systemColumn, sbsI18n("swade-hud.UI.SystemEffects_29098b9904"));
    const statuses = node("div", "status-list");
    const definitions = [...statusDefinitions()].sort((a, b) => Number(favorites.has("status:" + b.id))
      - Number(favorites.has("status:" + a.id)) || localize(a.name).localeCompare(localize(b.name)));
    for (const definition of definitions) {
      this.effectListRow(statuses, { name: localize(definition.name), img: definition.img,
        active: hasStatus(this.actor, definition.id), action: "status", data: { status: definition.id },
        favoriteKey: "status:" + definition.id, favorites });
    }
    systemColumn.append(statuses);
    list.append(actorColumn, systemColumn);
  }
  effectListRow(parent, { name, img, active, action, data, detail, favoriteKey, favorites }) {
    const row = node("div", "row effect-row" + (active ? " selected" : ""));
    Object.assign(row.dataset, data);
    row.dataset.filterValue = name.toLocaleLowerCase();
    const control = link(row, action, "", "", name + " · Left-click: toggle"
      + (action === "status" ? sbsI18n("swade-hud.UI.ShiftLeftclickapplyfora_8836bb0e76") : "")
      + " · Right-click: Edit / Delete · Shift+Right-click: description", data);
    control.className = "effect-toggle";
    control.setAttribute("aria-pressed", String(active));
    const image = node("img");
    image.src = img || "icons/svg/aura.svg";
    image.alt = "";
    const details = node("span", "effect-details");
    details.append(node("span", "effect-name", name));
    if (detail) details.append(node("span", "effect-detail", detail));
    control.append(image, details);
    this.effectPanels.bindListTooltip(this.actor, row, () => this.sidebar);
    row.addEventListener("contextmenu", (event) => {
      this.effectPanels.hideListTooltip();
      if (!event.shiftKey) return;
      event.preventDefault(); event.stopPropagation();
      this.closeSidebarContextMenu();
      this.showEffectDescription(row).catch((error) => this.report(error));
    }, true);
    const starred = favorites.has(favoriteKey);
    const star = link(row, "effect-favorite", "fa-star", "", (starred ? sbsI18n("swade-hud.UI.Unstar_053662946a") : sbsI18n("swade-hud.UI.Star_0bb8478a5e")) + name, { favoriteKey });
    star.className = "effect-star" + (starred ? " starred" : "");
    star.setAttribute("aria-pressed", String(starred));
    if (!starred) star.firstChild.className = "fa-regular fa-star";
    parent.append(row);
    return row;
  }
  bindEffectContextMenu(sidebar) {
    const ContextMenu = foundry.applications.ux.ContextMenu.implementation;
    this.sidebarContextMenu = new ContextMenu(sidebar, ".effect-row", [
      { label: sbsI18n("swade-hud.UI.Edit_464c4ffd01"), icon: "fa-solid fa-pen-to-square", visible: () => this.owned,
        onClick: (_event, row) => this.onEffectContextAction(row, "edit").catch((error) => this.report(error)) },
      { label: sbsI18n("swade-hud.UI.Delete_e2d0a54968"), icon: "fa-solid fa-trash", visible: (row) => this.owned && Boolean(this.effectForRow(row)),
        onClick: (_event, row) => this.onEffectContextAction(row, "delete").catch((error) => this.report(error)) },
    ], { jQuery: false, fixed: true, classes: ["swade-hud-effect-context"] });
  }
  bindItemContextMenu(sidebar) {
    const ContextMenu = foundry.applications.ux.ContextMenu.implementation;
    const itemForRow = (row) => this.owned && this.sidebar === sidebar && sidebar.contains(row)
      ? this.actor.items.get(row.dataset.itemId) : undefined;
    const visible = (row) => Boolean(itemForRow(row));
    const select = (action) => async (_event, row) => {
      try {
        const item = itemForRow(row);
        if (item) await action(item);
      } catch (error) { this.report(error); }
    };
    this.sidebarContextMenu = new ContextMenu(sidebar, ITEM_CONTEXT_TARGET, [
      { label: sbsI18n("swade-hud.UI.Edit_464c4ffd01"), icon: "fa-solid fa-pen-to-square", visible,
        onClick: select((item) => item.sheet.render({ force: true })) },
      { label: sbsI18n("swade-hud.UI.Delete_e2d0a54968"), icon: "fa-solid fa-trash", visible,
        onClick: select((item) => item.deleteDialog()) },
    ], { jQuery: false, fixed: true, classes: ["swade-hud-item-context"] });
  }
  effectForRow(row) {
    return row.dataset.effectUuid ? actorEffects(this.actor).find((effect) => effect.uuid === row.dataset.effectUuid)
      : findStatusEffect(this.actor, row.dataset.status);
  }
  async onEffectContextAction(row, action) {
    if (!this.owned || !this.sidebar?.contains(row)) return;
    const effect = this.effectForRow(row);
    if (action === "edit") {
      if (effect) return effect.sheet.render({ force: true });
      if (row.dataset.status) return openStatusEffect(this.actor, row.dataset.status);
    } else if (action === "delete" && effect) {
      if (await confirmEffectDeletion(effect)) this.schedule();
    }
  }
  closeSidebarContextMenu() {
    if (this.sidebarContextMenu?.element?.isConnected) this.sidebarContextMenu.close({ animate: false });
  }

  bind(root) {
    root.addEventListener("click", (event) => {
      // Keep native hotbar listeners and actions intact.
      if (this.isNativeHotbarEvent(event)) return;
      this.onClick(event).catch((error) => this.report(error));
    });
    root.addEventListener("change", (event) => this.onChange(event).catch((error) => this.report(error)));
    root.addEventListener("keydown", (event) => {
      if (this.isNativeHotbarEvent(event)) return;
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.target.blur();
      else if ((event.key === "Enter" || event.key === " ") && event.target.matches("a,[data-action=shortcut]")) {
        event.preventDefault();
        event.target.click();
      }
    });
    root.addEventListener("focusin", (event) => {
      if (!this.isNativeHotbarEvent(event) && event.target.type === "number") event.target.select();
    });
    root.addEventListener("contextmenu", (event) => this.onContext(event));
    root.addEventListener("dragstart", (event) => this.onDragStart(event));
    root.addEventListener("dragover", (event) => {
      if (this.isNativeHotbarEvent(event)) return;
      if (event.target.closest("[data-slot],[data-panel=shortcut-bin],.no-macro")) event.preventDefault();
    });
    root.addEventListener("drop", (event) => this.onDrop(event).catch((error) => this.report(error)));
    root.addEventListener("dragend", (event) => {
      if (!this.isNativeHotbarEvent(event)) this.element?.classList.remove("drag-active");
    });
  }
  isNativeHotbarEvent(event) {
    // Foundry can replace hotbar parts during the click. The original event
    // path still identifies its source after the clicked node is detached.
    return event.composedPath?.().some((node) => node instanceof Element && node.id === "hotbar")
      || Boolean(event.target.closest?.("#hotbar"));
  }
  changeShortcutPage(delta) {
    if (delta !== -1 && delta !== 1) return;
    if (this.description?.shortcutItemUuid) this.closeDescription();
    this.page = Math.min(2, Math.max(0, (Number.isInteger(this.page) ? this.page : 0) + delta));
    return this.render();
  }
  async onClick(event) {
    if (this.isNativeHotbarEvent(event)) return;
    const target = event.target.closest("[data-action]");
    if (!target || target.classList.contains("disabled")) return;
    event.preventDefault();
    event.stopPropagation();
    const data = target.dataset;
    const item = this.actor.items.get(data.itemId ?? target.closest("[data-item-id]")?.dataset.itemId);
    const action = data.action;
    if (action === "sidebar") {
      if (data.sidebar === this.activeSidebar) this.closeSidebar();
      else { this.closeSidebar(); this.activeSidebar = data.sidebar; this.render(); }
      return;
    }
    if (action === "open-actor") return this.actor.sheet.render({ force: true });
    if (action === "advance") {
      const sheet = this.actor.sheet;
      await sheet.render({ force: true });
      sheet.changeTab("about", "primary");
      sheet.changeTab("advances", "about");
      return;
    }
    if (action === "shortcut-page") {
      return this.changeShortcutPage(Number(data.delta));
    }
    if (action === "toggle-effects") { this.showEffects = !this.showEffects; return this.render(); }
    if (action === "toggle-avatar") return this.toggleAppearance("tokenAvatar");
    if (action === "toggle-clean") return this.toggleAppearance("cleanPortrait");
    if (action.startsWith("hotbar-")) {
      document.querySelector("#hotbar [data-action=" + ({ "hotbar-lock": "lock", "hotbar-mute": "mute", "hotbar-clear": "clear" }[action]) + "]")?.click();
      return this.schedule();
    }
    if (event.shiftKey && "itemChatGesture" in data && item) return item.show();
    if (action === "item-description") {
      const actor = this.actor;
      const document = item?.type === "skill" ? await coreSkillDocument(item) : item;
      if (this.actor === actor) return this.showDescription(document);
      return;
    }
    if (action === "close-description") return this.closeDescription();
    if (action === "edit-item") return item?.sheet.render({ force: true });
    if (action === "effect-sheet") return this.actor.effects.get(data.effectId)?.sheet.render({ force: true });
    if (!this.owned) return;
    switch (action) {
      case "power-timers": return game.modules.get("swade-better-powers")?.api?.openPowerTimers?.(this.actor);
      case "item-chat": return item?.show();
      case "generate-actions": await generateBasicActions(this.actor); return this.schedule();
      case "action-favorite": {
        if (!item) return;
        const favorites = new Set(this.profile.actionFavorites ?? []);
        if (favorites.has(item.id)) favorites.delete(item.id);
        else favorites.add(item.id);
        return this.saveProfile({ ...this.profile, actionFavorites: [...favorites] });
      }
      case "skill-common": return item && rollCommonSkillAction(this.actor, item, data.kind);
      case "toggle-skill-actions": return item && this.toggleSkillActions(target, item.id);
      case "choose-action": return item && this.chooseItemAction(item, event);
      case "extra": return runExtra(this.actor, this.token?.document, data.extra);
      case "item-action": return useItem(this.actor, item, data.itemAction, event, { castCard: true });
      case "attribute": return rollAttribute(this.actor, data.attribute);
      case "skill": if (canRollSkills(this.actor) && item) return rollSkill(this.actor, item.id); break;
      case "unskilled": if (canRollSkills(this.actor)) return rollSkill(this.actor, null); break;
      case "running": return rollRunning(this.actor);
      case "place-template": return placePowerTemplate(data.preset, item);
      case "resource-adjust":
        if (data.key === "wounds" && event.shiftKey) return this.actor.toggleActiveEffect("shaken");
        return this.adjustCounter(data.key, data.pool, 1);
      case "disposition": return showDispositionDialog(this.token?.document, target);
      case "status": return event.shiftKey && target.closest(".system-effect-list")
        ? showTimedStatusDialog(this.actor, data.status, this.token?.document)
        : toggleHudStatus(this.actor, this.token?.document, data.status);
      case "effect-toggle": {
        const effect = actorEffects(this.actor).find((effect) => effect.uuid === data.effectUuid);
        if (effect && !effect.isSuppressed) {
          await effect.update({ disabled: !effect.disabled });
          this.schedule();
        }
        break;
      }
      case "effect-favorite": {
        const favorites = new Set(this.profile.effectFavorites ?? []);
        if (favorites.has(data.favoriteKey)) favorites.delete(data.favoriteKey);
        else favorites.add(data.favoriteKey);
        return this.saveProfile({ ...this.profile, effectFavorites: [...favorites] });
      }
      case "adjust":
        if (data.key === "powerPoints") {
          const pool = this.actor.system.powerPoints?.[data.pool];
          if (pool) return updatePool(this.actor, data.pool, pool.value + Number(data.delta));
        } else return adjustResource(this.actor, data.key, Number(data.delta));
        break;
      case "equip": return item?.setEquipState(item.system.equipStatus >= 2 ? 1 : item.type === "weapon" ? 4 : 3);
      case "consume": return item?.consume();
      case "delete-item": return item?.deleteDialog();
      case "reaction": await toggleReactionEffect(this.actor); return this.schedule();
      case "prototype-token": {
        const actor = this.actor.token?.baseActor ?? this.actor;
        if (actor?.isOwner && actor.prototypeToken) {
          return new CONFIG.Token.prototypeSheetClass({ prototype: actor.prototypeToken }).render({ force: true });
        }
        break;
      }
      case "scale": return event.shiftKey ? this.editScale() : this.changeScale(1);
      case "shortcut": return this.useShortcut(Number(data.slot), event);
      case "recover-shaken": return recoverShaken(this.actor);
      case "soak": return rollAttribute(this.actor, "vigor", {
        additionalMods: [{ label: sbsI18n("swade-hud.UI.Soakbonus_b8f7a18e3a"), value: this.actor.system.attributes.vigor.soakBonus ?? 0 }],
      });
      case "macro": return fromUuidSync(data.macroUuid)?.execute({ actor: this.actor, token: this.token });
      case "edit-macro": return fromUuidSync(data.macroUuid)?.sheet.render({ force: true });
      case "remove-macro": return this.saveProfile({ ...this.profile, macros: (this.profile.macros ?? []).filter((uuid) => uuid !== data.macroUuid) });
    }
  }
  async onChange(event) {
    if (this.isNativeHotbarEvent(event)) return;
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !this.owned || field.type !== "number") return;
    const value = Math.max(0, field.valueAsNumber);
    if (!Number.isFinite(value)) return;
    if (field.dataset.path) await this.actor.update({ [field.dataset.path]: value });
    if (field.dataset.itemProperty) await this.actor.items.get(field.dataset.itemId)?.update({ [field.dataset.itemProperty]: value });
    if (field.dataset.pool) await updatePool(this.actor, field.dataset.pool, value);
    this.schedule();
  }
  onContext(event) {
    if (this.isNativeHotbarEvent(event)) return;
    if (event.target.closest('[data-action="shortcut-page"]')) {
      event.preventDefault(); event.stopPropagation();
      return this.changeShortcutPage(-1);
    }
    if (!this.owned) return;
    if (event.target.closest('[data-action="extra"][data-extra="hold"]')) {
      event.preventDefault();
      event.stopPropagation();
      return runExtra(this.actor, this.token?.document, "hold", {after: true}).catch(error => this.report(error));
    }
    if (event.target.closest(".effect-row")) return; // Handled by the native context menu.
    const itemRow = event.target.closest(ITEM_CONTEXT_TARGET);
    if (itemRow && this.sidebar?.contains(itemRow)) {
      const skillModifier = itemRow.dataset.modifier === "skill"
        && (event.shiftKey || event.target.closest(".attribute-name"));
      if (!skillModifier) return; // Let the native item menu handle the row.
      event.stopImmediatePropagation();
      this.closeSidebarContextMenu();
    }
    if (event.target.closest('[data-action="scale"]')) {
      event.preventDefault();
      const result = event.shiftKey ? showSizeReference() : this.changeScale(-1);
      Promise.resolve(result).catch((error) => this.report(error));
      return;
    }
    const resource = event.target.closest('[data-action="resource-adjust"]');
    if (resource?.dataset.key === "wounds" && event.shiftKey) {
      event.preventDefault();
      Promise.resolve(recoverShaken(this.actor)).catch((error) => this.report(error));
      return;
    }
    if (resource && !event.shiftKey) {
      event.preventDefault();
      this.adjustCounter(resource.dataset.key, resource.dataset.pool, -1).catch((error) => this.report(error));
      return;
    }
    const slot = event.target.closest(".shortcut");
    if (slot) {
      event.preventDefault();
      const index = Number(slot.dataset.slot);
      const shortcut = this.shortcuts()[index];
      if (event.shiftKey) { this.setShortcut(index, null).catch((error) => this.report(error)); return; }
      if (shortcut?.type === "attribute") return this.openModifier({ kind: "attribute", key: shortcut.key });
      const info = this.resolveShortcut(shortcut);
      if (info?.doc?.type === "skill") return this.openModifier({ kind: "skill", itemId: info.doc.id });
      if (info?.doc?.documentName === "Item") this.showDescription(info.doc);
      return;
    }
    const target = event.target.closest("[data-modifier],[data-action=attribute],[data-action=skill],[data-action=running]");
    if (!target) return;
    event.preventDefault();
    const data = target.dataset;
    this.openModifier({
      kind: data.modifier ?? (data.action === "running" ? "pace" : data.action),
      key: data.attribute, itemId: data.itemId ?? target.closest("[data-item-id]")?.dataset.itemId,
      pool: data.pool ?? target.closest("[data-pool]")?.dataset.pool,
    });
  }
  openModifier(spec) {
    return showModifierDialog(this.actor, this.token?.document, spec).catch((error) => this.report(error));
  }
  async adjustCounter(key, poolName, delta) {
    if (!this.owned) return;
    if (key === "powerPoints") {
      const pool = this.actor.system.powerPoints?.[poolName];
      if (pool) return updatePool(this.actor, poolName, pool.value + delta);
    } else return adjustResource(this.actor, key, delta);
  }
  async useShortcut(index, event) {
    this.hideTooltip();
    const shortcut = this.shortcuts()[index];
    if (!shortcut) return;
    if (shortcut.type === "attribute") return rollAttribute(this.actor, shortcut.key);
    const doc = fromUuidSync(shortcut.uuid);
    if (doc?.documentName === "Macro") return doc.execute({ actor: this.actor, token: this.token });
    if (!doc || doc.parent?.uuid !== this.actor.uuid) return;
    const usable = doc.type === "consumable";
    if (usable && !game.modules.get("swade-better-usables")?.api?.getShortcutControls) return doc.consume();
    const skill = doc.type === "skill";
    const actions = skill || usable ? [] : itemShortcutActions(this.actor, doc);
    if (!skill && !usable && !actionKind(doc) && hasSwadeToolsItemDialog(doc) && (["weapon", "power"].includes(doc.type) || actions.length)) {
      this.closeDescription();
      if (doc.type === "weapon" && attackOptions(this.actor).some(option => attackOptionState(this.actor, option.id))) {
        return useItem(this.actor, doc, "formula", event);
      }
      return openSwadeToolsItemDialog(this.actor, doc, { castCard: doc.type === "power" });
    }
    if (usable || skill || doc.type === "weapon" || doc.type === "power" || actions.length > 1) {
      if (this.description?.shortcutItemUuid === doc.uuid && this.description.element?.isConnected) {
        this.closeDescription();
        return;
      }
      return this.showDescription(doc, { actions: true,
        anchor: () => this.element?.querySelector('[data-slot="' + index + '"]') });
    }
    if (actions.length === 1) return useItem(this.actor, doc, actions[0].key, event);
    return doc.show();
  }
  runExtra(key, actor = this.actor, token = actor === this.actor ? this.token?.document : actor?.token) {
    return runExtra(actor, token, key);
  }
  changeScale(delta) {
    const actor = this.actor, token = this.token?.document;
    return this.queueScaleUpdate(() => adjustScale(actor, token, delta));
  }
  async editScale() {
    const actor = this.actor, token = this.token?.document;
    await this.scaleUpdate?.catch(() => {});
    return showSizeDialog(actor, (size, timing) => this.queueScaleUpdate(() => applySizeChange(actor, token, size, timing)));
  }
  queueScaleUpdate(update) {
    this.scaleUpdate = (this.scaleUpdate ?? Promise.resolve()).catch(() => {}).then(async () => {
      await update();
      this.schedule();
    });
    return this.scaleUpdate;
  }
  async saveProfile(profile) {
    const { expandedSkills, ...data } = profile;
    await game.user.update({ [`flags.${MODULE_ID}.profiles.${this.profileKey}`]: data });
    this.schedule();
  }
  async toggleAppearance(key) {
    await game.user.setFlag(MODULE_ID, "appearance", { ...this.appearance, [key]: !this.appearance[key] });
    this.schedule();
  }
  async savePage(page) {
    const pages = [...(this.profile.pages ?? [])];
    pages[this.page] = page;
    return this.saveProfile({ ...this.profile, pages });
  }
  async setShortcut(index, shortcut) {
    const page = [...this.shortcuts()];
    page[index] = shortcut;
    return this.savePage(page);
  }
  onDragStart(event) {
    if (this.isNativeHotbarEvent(event)) return;
    const source = event.target.closest("[draggable=true]");
    if (!source || !this.owned) return;
    let data;
    if (source.dataset.slot !== undefined) data = { ...this.shortcuts()[Number(source.dataset.slot)], swadeHudSlot: Number(source.dataset.slot), swadeHudPage: this.page };
    else if (source.dataset.dragType === "attribute") data = { type: "attribute", key: source.dataset.attribute };
    else {
      const item = this.actor.items.get(source.dataset.itemId);
      if (item) data = { type: "Item", uuid: item.uuid };
    }
    if (!data) return;
    event.dataTransfer.setData("text/plain", JSON.stringify(data));
    // Give the browser a small image instead of rasterizing an entire item row.
    const info = this.resolveShortcut(data);
    const image = node("div", "swade-hud-drag-image");
    if (info?.img) image.style.backgroundImage = "url(" + JSON.stringify(info.img) + ")";
    else image.append(icon(info?.icon ?? "fa-dice"));
    document.body.append(image);
    event.dataTransfer.setDragImage(image, 24, 24);
    requestAnimationFrame(() => image.remove());
    this.element?.classList.add("drag-active");
    this.hideTooltip();
  }
  async onDrop(event) {
    if (this.isNativeHotbarEvent(event)) return;
    const target = event.target.closest("[data-slot],[data-panel=shortcut-bin],.no-macro");
    if (!target || !this.owned) return;
    event.preventDefault();
    event.stopPropagation();
    this.element?.classList.remove("drag-active");
    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
    if (target.dataset.panel === "shortcut-bin" && data.swadeHudSlot !== undefined) {
      return this.setShortcut(Number(data.swadeHudSlot), null);
    }
    const doc = data.uuid ? await fromUuid(data.uuid) : null;
    if (target.classList.contains("no-macro")) {
      if (doc?.documentName === "Macro") return this.saveProfile({
        ...this.profile, macros: [...new Set([...(this.profile.macros ?? []), doc.uuid])],
      });
      return;
    }
    if (target.dataset.slot === undefined) return;
    const shortcut = data.type === "attribute" && ATTRIBUTES.some(([key]) => key === data.key)
      ? { type: "attribute", key: data.key }
      : doc?.documentName === "Macro" ? { type: "Macro", uuid: doc.uuid }
        : doc?.documentName === "Item" && doc.parent?.uuid === this.actor.uuid ? { type: "Item", uuid: doc.uuid } : null;
    if (!shortcut) return;
    const page = [...this.shortcuts()];
    const index = Number(target.dataset.slot);
    if (data.swadeHudSlot !== undefined && data.swadeHudPage === this.page) page[Number(data.swadeHudSlot)] = page[index] ?? null;
    page[index] = shortcut;
    return this.savePage(page);
  }
  onKey(event) {
    const application = event.target.closest(".application,dialog");
    if (application && application !== this.sidebar) return;
    if (event.key === "Escape") { this.closeDescription(); this.closeSidebar(); return; }
    if (!this.sidebar || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    if (event.target.closest("input,textarea,[contenteditable=true]")) return;
    const filter = this.sidebar.querySelector('[data-panel="filter"]');
    filter.classList.add("visible");
    const field = filter.querySelector("input");
    field.focus();
  }
  async showDescription(item, options = {}) {
    if (!item) return;
    return this.openDescription(() => createItemPopup(this.actor, item, options));
  }
  async showEffectDescription(row) {
    if (!this.owned || !this.sidebar?.contains(row)) return;
    const actor = this.actor;
    const effect = row.dataset.effectUuid ? this.effectForRow(row) : await statusEffectDocument(actor, row.dataset.status);
    if (!effect || actor !== this.actor) return;
    this.effectPanels.hideTooltip();
    return this.openDescription(() => this.effectPanels.createDescription(actor, effect, row.dataset.status));
  }
  async openDescription(createPopup) {
    this.closeDescription();
    const popup = createPopup();
    this.description = popup;
    await popup.render({ force: true });
    if (this.description !== popup) { popup.close({ animate: false }); return; }
    if (popup.shortcutItemUuid) raiseHudPanel(popup.element);
    popup.positionAtShortcut?.();
  }
  closeDescription() { this.description?.close({ animate: false }); this.description = null; }
  showTooltip(slot, info) {
    this.hideTooltip();
    const tooltip = node("div", "swade-hud-element");
    tooltip.id = "swade-hud-shortcut-tooltip";
    const content = node("div", "content");
    const heading = node("div", "header");
    const image = node("div", "image");
    image.style.backgroundImage = "url(" + JSON.stringify(info.img) + ")";
    const title = node("div", "title", info.name);
    styleTier(info.doc, {icon: image, name: title});
    heading.append(image, title,
      node("div", "subtitle", info.doc ? localize("TYPES.Item." + info.doc.type, info.doc.type || "Macro") : sbsI18n("swade-hud.UI.Attribute_1d289028b7")));
    content.append(heading);
    if (info.count !== null && info.count !== undefined) content.append(node("div", "details left", "Available: " + info.count));
    if (info.cost !== null && info.cost !== undefined) content.append(node("div", "details right", info.cost + " PP"));
    tooltip.append(content);
    document.body.append(tooltip);
    const rect = slot.getBoundingClientRect();
    tooltip.style.left = Math.max(0, Math.min(rect.left, innerWidth - tooltip.offsetWidth)) + "px";
    tooltip.style.top = Math.max(0, rect.top - tooltip.offsetHeight - 10) + "px";
    this.tooltip = tooltip;
  }
  hideTooltip() { this.tooltip?.remove(); this.tooltip = null; }
  report(error) {
    console.error("SWADE HUD", error);
    ui.notifications.error("SWADE HUD: " + error.message);
  }
}
