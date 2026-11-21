import {t as sbsI18n} from "./i18n.mjs";
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
      content.title = sbsI18n("swade-hud.UI.Rightclickforatemporarymodifier_1588f1c6e2");
    }
    stats.append(content);
  };
  const formula = (value) => String(value ?? "").replace(/@str\b/g, "Strength")
    .replace(/@agi\b/g, "Agility").replace(/@sma\b/g, "Smarts").replace(/@spr\b/g, "Spirit").replace(/@vig\b/g, "Vigor");
  if (system.quantity !== undefined) stat("Quantity", system.quantity);
  if (system.weight !== undefined) {
    const units = game.settings.get("swade", "weightUnit") === "imperial" ? "lb" : "kg";
    stat("Weight", system.weight + " " + units + (system.quantity > 1 ? " each" : ""));
    if (system.quantity > 1) stat(sbsI18n("swade-hud.UI.Totalweight_08bc1d15a6"), Math.round(system.quantity * system.weight * 100) / 100 + " " + units);
  }
  stat("Cost", system.price ?? system.cost);
  if (system.equipStatus !== undefined) stat("Equipment", [sbsI18n("swade-hud.UI.Stored_91da962689"), sbsI18n("swade-hud.UI.Carried_4014b8870c"), sbsI18n("swade-hud.UI.Offhand_5d154d9c57"), sbsI18n("swade-hud.UI.Equipped_c4dc8a3877"), sbsI18n("swade-hud.UI.Mainhand_bd73f463f8"), sbsI18n("swade-hud.UI.Twohands_d322b2c78f")][system.equipStatus]);
  if (system.damage) stat("Damage", formula(system.damage));
  if (system.range) stat("Range", formula(system.range));
  if (item.type === "weapon") {
    stat("AP", system.ap);
    stat(sbsI18n("swade-hud.UI.RateofFire_b85769f4ac"), system.rof);
    if (system.shots) stat("Ammunition", (system.currentShots ?? 0) + " / " + system.shots);
    if (system.parry) stat(sbsI18n("swade-hud.UI.Parrybonus_086f2163c3"), signed(system.parry));
    if (system.isHeavyWeapon) stat(sbsI18n("swade-hud.UI.Heavyweapon_1ffdc887d1"), sbsI18n("swade-hud.UI.Yes_85a39ab345"));
  }
  if (item.type === "shield") { stat(sbsI18n("swade-hud.UI.Parrybonus_086f2163c3"), signed(system.parry ?? 0)); stat("Cover", system.cover); }
  if (item.type === "armor") {
    stat(sbsI18n("swade-hud.UI.Armourbonus_9ea07e1b9d"), signed(system.armor ?? 0));
    if (system.toughness) stat(sbsI18n("swade-hud.UI.Toughnessbonus_02c40cbad4"), signed(system.toughness));
    stat("Locations", Object.entries(system.locations ?? {}).filter(([,enabled])=>enabled).map(([key])=>key[0].toUpperCase()+key.slice(1)).join(", "));
    if (system.isNaturalArmor) stat(sbsI18n("swade-hud.UI.Naturalarmour_e42f68ed29"), sbsI18n("swade-hud.UI.Yes_85a39ab345"));
    if (system.isHeavyArmor) stat(sbsI18n("swade-hud.UI.Heavyarmour_d26228e2d8"), sbsI18n("swade-hud.UI.Yes_85a39ab345"));
    if (system.energy?.enabled) stat("Energy", system.energy.value + " / " + system.energy.max);
  }
  stat(sbsI18n("swade-hud.UI.MinimumStrength_fdcf509e7e"), system.minStr);
  if (item.type === "power") {
    const presentation = powerCostPresentation(item, actor);
    stat(presentation.noPP ? sbsI18n("swade-hud.UI.Castingpenalty_c173daf9e1") : sbsI18n("swade-hud.UI.PowerPoints_844847817f"), presentation.noPP ? presentation.text : presentation.cost);
    stat("Rank", system.rank);
    stat("Duration", system.duration);
    stat("Trapping", system.trapping);
    stat(sbsI18n("swade-hud.UI.ArcaneBackground_26f6c5b6cc"), system.arcane);
    stat("Templates", powerTemplates(item).map((template)=>template.title).join(", "));
  }
  if (item.type === "skill") stat("Trait", dieLabel(system.die, item.modifier), { modifier:"skill" });
  const traitName = system.actions?.trait;
  const traitAttribute = ATTRIBUTES.find(([key,label]) => traitName
    && [key,localize(label,key)].some((name)=>name.toLowerCase()===String(traitName).toLowerCase()));
  const traitSkill = actor.items.find((entry)=>entry.type==="skill" && traitName
    && [entry.id,entry.name,entry.system.swid].some((name)=>name && name.toLowerCase()===String(traitName).toLowerCase()));
  stat(sbsI18n("swade-hud.UI.Traitused_0578fe1a13"), traitName, traitAttribute ? {modifier:"attribute",attribute:traitAttribute[0]}
    : traitSkill ? {modifier:"skill",itemId:traitSkill.id} : {});
  if (system.actions?.traitMod) stat(sbsI18n("swade-hud.UI.Traitmodifier_ff87ba5302"), signed(system.actions.traitMod));
  if (system.actions?.dmgMod) stat(sbsI18n("swade-hud.UI.Damagemodifier_bc0d310cd9"), signed(system.actions.dmgMod));
  for (const extra of Object.values(system.additionalStats ?? {})) {
    stat(extra.label ?? sbsI18n("swade-hud.UI.Additionalstat_34b8dd77ae"), extra.max !== undefined ? extra.value + " / " + extra.max : extra.value);
  }
  if (stats.children.length) summary.append(stats);
  const traitModifiers = item.traitModifiers ?? [];
  if (traitModifiers.length) {
    summary.append(node("h3", "", sbsI18n("swade-hud.UI.Currenttraitmodifiers_c117f058c4")));
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
    summary.append(node("h3", "", sbsI18n("swade-hud.UI.Notes_8a7525b149")));
    const notes = node("div", "item-notes");
    notes.innerHTML = await enrich(system.notes);
    summary.append(notes);
  }
  const effects = Array.from(item.effects ?? []);
  if (effects.length) {
    summary.append(node("h3", "", sbsI18n("swade-hud.UI.EffectsModifiers_10a850f1ed")));
    for (const effect of effects) {
      const section = node("section", "item-effect-summary");
      section.append(node("h4", "", effect.name));
      const state = effect.disabled || effect.active === false ? sbsI18n("swade-hud.UI.Disabled_75081b593d") : effect.isSuppressed ? sbsI18n("swade-hud.UI.Inactive_ac7c949f12") : sbsI18n("swade-hud.UI.Active_9234069589");
      const details = [state, effect.transfer ? sbsI18n("swade-hud.UI.Transferredtoactor_c1943ada12") : effect.type === "modifier" ? sbsI18n("swade-hud.UI.Modifiesthisitem_5c883819e3") : sbsI18n("swade-hud.UI.Itemeffect_27434c01fd"),
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
    summary.append(node("h3", "", sbsI18n("swade-hud.UI.Actions_ff8059dc67")));
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
