import { powerTemplates, placePowerTemplate, isBoostLowerTrait, powerCostPresentation } from "./powers.js";
import { ATTRIBUTES, localize, useItem } from "./swade.js";

// Include the base trait action as well as the item's configured alternatives.
export function itemShortcutActions(actor, item) {
  const actions = item.system.actions;
  if (!actions) return [];
  const traitLabel = (name) => {
    const value = String(name ?? "").trim();
    const attribute = ATTRIBUTES.find(([key, label]) => [key, localize(label, key)]
      .some((candidate) => candidate.toLowerCase() === value.toLowerCase()));
    if (attribute) return localize(attribute[1], attribute[0]);
    return actor.items.find((entry) => entry.type === "skill"
      && [entry.id, entry.name, entry.system.swid].some((candidate) => candidate
        && candidate.toLowerCase() === value.toLowerCase()))?.name ?? value;
  };
  const result = [];
  if (String(actions.trait ?? "").trim()) {
    result.push({ key: "formula", label: item.name + " (" + traitLabel(actions.trait) + ")", icon: "fa-dice" });
  }
  for (const [key, action] of Object.entries(actions.additional ?? {})) {
    if (!action || !["trait", "resist", "damage", "macro"].includes(action.type)) continue;
    const trait = ["trait", "resist"].includes(action.type) ? traitLabel(action.override || actions.trait) : "";
    result.push({ key, label: (action.name || key) + (trait ? " (" + trait + ")" : ""),
      icon: action.type === "damage" ? "fa-burst" : "fa-play" });
  }
  return result;
}

// Retain PF2e HUD's item-summary button group; use SWADE's configured actions.
export function renderItemActions(actor, item, refresh, { compact = false } = {}) {
  const group = document.createElement("div");
  group.className = "button-group shortcut-actions";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", item.name + " actions");
  let destination = group;
  const row = (name) => {
    if (!compact) return;
    destination = document.createElement("div");
    destination.className = "action-row " + name;
    group.append(destination);
  };
  const system = item.system;
  const reloadLabel = Number(system.shots) > 0 && system.currentShots != null && system.currentShots !== "" && Number.isFinite(Number(system.currentShots))
    ? "Reload (" + system.currentShots + " / " + system.shots + ")" : "Reload";
  const extra = Object.entries(system.actions?.additional ?? {}).filter(([,action]) =>
    !(isBoostLowerTrait(item) && (action.type === "resist" || /^resist$/i.test(action.name ?? ""))));
  const throwing = item.type === "weapon" ? extra.find(([,action]) =>
    action.type === "trait" && /throw/i.test(action.name ?? "")) : null;
  const damage = String(system.damage ?? "").replace(/@str\b/g, "Strength");
  const button = (label, glyph, action, { title, preset } = {}) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "blue";
    el.dataset.popupAction = action;
    if (preset) el.dataset.preset = preset;
    if (title) el.title = title;
    const icon = document.createElement("i");
    icon.className = "fa-solid " + glyph;
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = label;
    el.append(icon, text);
    destination.append(el);
    return el;
  };
  if (item.type === "weapon") {
    row("attack-actions");
    button("Attack", "fa-sword", "formula");
    if (compact && system.hasReloadButton) button(reloadLabel, "fa-rotate", "reload");
    if (damage && !compact) button("Damage: " + damage, "fa-burst", "damage");
    if (throwing) {
      button("Throw" + (system.range ? " (" + system.range + ")" : ""), "fa-bullseye", throwing[0],
        { title: throwing[1].name + (system.range ? " · Range " + system.range : "") });
    } else if (/\bathletics\b/i.test(system.actions?.trait ?? "") && system.range) {
      button("Throw (" + system.range + ")", "fa-bullseye", "formula", { title: "Range " + system.range });
    }
    if (!compact && system.hasReloadButton) button(reloadLabel, "fa-rotate", "reload");
  } else if (item.type === "power") {
    row("cast-actions");
    button((compact ? "Cast (" : "Cast power (") + powerCostPresentation(item, actor).text + ")", "fa-wand-magic-sparkles", "formula");
    if (damage) button("Damage: " + damage, "fa-burst", "damage");
    const templates = powerTemplates(item);
    if (templates.length) row("template-actions");
    for (const template of templates) {
      button((compact ? "" : "Place ") + template.label, "fa-ruler-combined", "template", { title: template.title, preset: template.preset });
    }
  } else {
    row("additional-actions");
    for (const action of itemShortcutActions(actor, item)) button(action.label, action.icon, action.key);
  }
  if (["weapon", "power"].includes(item.type)) {
    if (extra.some(([key]) => key !== throwing?.[0])) row("additional-actions");
    for (const [key,action] of extra) {
      if (key === throwing?.[0]) continue;
      button(action.name || key, action.type === "damage" ? "fa-burst" : "fa-play", key);
    }
    if (compact && item.type === "weapon" && damage) {
      row("damage-actions");
      button("Damage: " + damage, "fa-burst", "damage");
    }
  }
  group.addEventListener("click", async (event) => {
    const target = event.target.closest("button[data-popup-action]");
    if (!target || target.disabled || !actor.isOwner || item.parent?.uuid !== actor.uuid) return;
    event.preventDefault();
    event.stopPropagation();
    target.disabled = true;
    try {
      if (target.dataset.preset) await placePowerTemplate(target.dataset.preset, item);
      else await useItem(actor, item, target.dataset.popupAction, event, { castCard: true });
      await refresh();
    } catch (error) {
      console.error("SWADE HUD", error);
      ui.notifications.error("SWADE HUD: " + (error.message ?? error));
    } finally { target.disabled = false; }
  });
  return group;
}
