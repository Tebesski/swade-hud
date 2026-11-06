import { ATTRIBUTES, localize, dieLabel } from "./swade.js";
import { changeLabel, effectDuration } from "./effects.js";
import { powerTemplates, isBoostLowerTrait, powerCostPresentation } from "./powers.js";

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = String(text);
  return el;
}
const signed = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? "+" + value : String(value);
function changeValue(change) {
  switch (change.type) {
    case "override": return "set to " + change.value;
    case "multiply": return "×" + change.value;
    case "subtract": return "−" + change.value;
    case "upgrade": return "minimum " + change.value;
    case "downgrade": return "maximum " + change.value;
    default: return signed(change.value);
  }
}
export async function renderItemSummary(actor, item, { includeActions = true } = {}) {
  const summary = node("div", "item-summary item");
  summary.dataset.itemId = item.id;
  const system = item.system;
  const stats = node("dl", "item-vital-stats");
  const stat = (label, value, options = {}) => {
    if (value === undefined || value === null || value === "") return;
    stats.append(node("dt", "", label));
    const content = node("dd", "", value);
    if (options.modifier) {
      content.dataset.modifier = options.modifier;
      content.dataset.itemId = options.itemId ?? item.id;
      if (options.attribute) content.dataset.attribute = options.attribute;
      content.title = "Right-click for a temporary modifier";
    }
    stats.append(content);
  };
  const formula = (value) => String(value ?? "").replace(/@str\b/g, "Strength")
    .replace(/@agi\b/g, "Agility").replace(/@sma\b/g, "Smarts").replace(/@spr\b/g, "Spirit").replace(/@vig\b/g, "Vigor");
  if (system.quantity !== undefined) stat("Quantity", system.quantity);
  if (system.weight !== undefined) {
    const units = game.settings.get("swade", "weightUnit") === "imperial" ? "lb" : "kg";
    stat("Weight", system.weight + " " + units + (system.quantity > 1 ? " each" : ""));
    if (system.quantity > 1) stat("Total weight", Math.round(system.quantity * system.weight * 100) / 100 + " " + units);
  }
  stat("Cost", system.price ?? system.cost);
  if (system.equipStatus !== undefined) stat("Equipment", ["Stored", "Carried", "Off hand", "Equipped", "Main hand", "Two hands"][system.equipStatus]);
  if (system.damage) stat("Damage", formula(system.damage));
  if (system.range) stat("Range", formula(system.range));
  if (item.type === "weapon") {
    stat("AP", system.ap);
    stat("Rate of Fire", system.rof);
    if (system.shots) stat("Ammunition", (system.currentShots ?? 0) + " / " + system.shots);
    if (system.parry) stat("Parry bonus", signed(system.parry));
    if (system.isHeavyWeapon) stat("Heavy weapon", "Yes");
  }
  if (item.type === "shield") { stat("Parry bonus", signed(system.parry ?? 0)); stat("Cover", system.cover); }
  if (item.type === "armor") {
    stat("Armour bonus", signed(system.armor ?? 0));
    if (system.toughness) stat("Toughness bonus", signed(system.toughness));
    stat("Locations", Object.entries(system.locations ?? {}).filter(([,enabled])=>enabled).map(([key])=>key[0].toUpperCase()+key.slice(1)).join(", "));
    if (system.isNaturalArmor) stat("Natural armour", "Yes");
    if (system.isHeavyArmor) stat("Heavy armour", "Yes");
    if (system.energy?.enabled) stat("Energy", system.energy.value + " / " + system.energy.max);
  }
  stat("Minimum Strength", system.minStr);
  if (item.type === "power") {
    const presentation = powerCostPresentation(item, actor);
    stat(presentation.noPP ? "Casting penalty" : "Power Points", presentation.noPP ? presentation.text : presentation.cost);
    stat("Rank", system.rank);
    stat("Duration", system.duration);
    stat("Trapping", system.trapping);
    stat("Arcane Background", system.arcane);
    stat("Templates", powerTemplates(item).map((template)=>template.title).join(", "));
  }
  if (item.type === "skill") stat("Trait", dieLabel(system.die, item.modifier), { modifier:"skill" });
  const traitName = system.actions?.trait;
  const traitAttribute = ATTRIBUTES.find(([key,label]) => traitName
    && [key,localize(label,key)].some((name)=>name.toLowerCase()===String(traitName).toLowerCase()));
  const traitSkill = actor.items.find((entry)=>entry.type==="skill" && traitName
    && [entry.id,entry.name,entry.system.swid].some((name)=>name && name.toLowerCase()===String(traitName).toLowerCase()));
  stat("Trait used", traitName, traitAttribute ? {modifier:"attribute",attribute:traitAttribute[0]}
    : traitSkill ? {modifier:"skill",itemId:traitSkill.id} : {});
  if (system.actions?.traitMod) stat("Trait modifier", signed(system.actions.traitMod));
  if (system.actions?.dmgMod) stat("Damage modifier", signed(system.actions.dmgMod));
  for (const extra of Object.values(system.additionalStats ?? {})) {
    stat(extra.label ?? "Additional stat", extra.max !== undefined ? extra.value + " / " + extra.max : extra.value);
  }
  if (stats.children.length) summary.append(stats);
  const traitModifiers = item.traitModifiers ?? [];
  if (traitModifiers.length) {
    summary.append(node("h3", "", "Current trait modifiers"));
    const list = node("ul");
    for (const modifier of traitModifiers) list.append(node("li", "", localize(modifier.label) + ": "
      + signed(modifier.value) + (modifier.ignore ? " (optional)" : "")));
    summary.append(list);
  }
  const enrich = (html, relativeTo = item) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html || "", {
    relativeTo, rollData: item.getRollData(), secrets: actor.isOwner,
  });
  const description = node("div", "description");
  description.innerHTML = await enrich(system.description);
  summary.append(description);
  if (system.notes && system.notes !== system.description) {
    summary.append(node("h3", "", "Notes"));
    const notes = node("div", "item-notes");
    notes.innerHTML = await enrich(system.notes);
    summary.append(notes);
  }
  const effects = Array.from(item.effects ?? []);
  if (effects.length) {
    summary.append(node("h3", "", "Effects & Modifiers"));
    for (const effect of effects) {
      const section = node("section", "item-effect-summary");
      section.append(node("h4", "", effect.name));
      const state = effect.disabled || effect.active === false ? "Disabled" : effect.isSuppressed ? "Inactive" : "Active";
      const details = [state, effect.transfer ? "Transferred to actor" : effect.type === "modifier" ? "Modifies this item" : "Item effect",
        effectDuration(effect).label];
      if (effect.type === "modifier" && effect.system?.level) details.push("Level " + effect.system.level);
      section.append(node("p", "effect-state", details.join(" · ")));
      const list = node("ul", "effect-modifier-list");
      for (const change of effect.changes ?? effect.system?.changes ?? []) {
        list.append(node("li", "", changeLabel(change, actor) + ": " + changeValue(change)));
      }
      if (effect.system?.cost !== undefined && effect.system.cost !== null) {
        list.append(node("li", "", "Power Point cost: " + signed(effect.system.cost)));
      }
      if (list.children.length) section.append(list);
      if (effect.description) {
        const text = node("div", "description");
        text.innerHTML = await enrich(effect.description, effect);
        section.append(text);
      }
      summary.append(section);
    }
  }
  const actions = Object.values(system.actions?.additional ?? {}).filter((action)=>!(isBoostLowerTrait(item)
    && (action.type === "resist" || /^resist$/i.test(action.name ?? ""))));
  if (includeActions && actions.length) {
    summary.append(node("h3", "", "Actions"));
    const list = node("ul");
    for (const action of actions) {
      const info = [action.name, action.override ? formula(action.override) : "",
        action.modifier ? "modifier " + signed(action.modifier) : "", action.resourcesUsed ? "resources " + action.resourcesUsed : ""].filter(Boolean);
      list.append(node("li", "", info.join(" · ")));
    }
    summary.append(list);
  }
  return summary;
}
