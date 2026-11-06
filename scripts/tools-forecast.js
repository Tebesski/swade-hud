const pending = [];
const contexts = new WeakMap();
let classes;
export function withToolsForecast(context, invoke) {
  pending.push({ ...context, expires: Date.now() + 15000 });
  if (pending.length > 20) pending.shift();
  return invoke();
}
export function toolsForecastContext(app, root) {
  if (!game.modules.get("swade-tools")?.active) return null;
  if (contexts.has(app)) return contexts.get(app);
  const title = app.title ?? app.data?.title ?? "";
  const match = pending.findIndex((context) => context.expires > Date.now() && [context.item?.name,
    context.skill?.name, context.attribute && game.i18n.localize({ agility: "SWADE.AttrAgi", smarts: "SWADE.AttrSma", spirit: "SWADE.AttrSpr", strength: "SWADE.AttrStr", vigor: "SWADE.AttrVig" }[context.attribute])].includes(title));
  let context = match >= 0 ? pending.splice(match, 1)[0] : null;
  if (!context) {
    const actor = game.modules.get("swade-hud")?.api?.actor;
    const item = actor?.items?.find((item) => item.name === title);
    const attribute = ["agility", "smarts", "spirit", "strength", "vigor"].find((key) => game.i18n.localize({ agility: "SWADE.AttrAgi", smarts: "SWADE.AttrSma", spirit: "SWADE.AttrSpr", strength: "SWADE.AttrStr", vigor: "SWADE.AttrVig" }[key]) === title);
    if (actor?.isOwner && (item || attribute)) context = item?.type === "skill" ? { actor, skill: item } : { actor, item, attribute };
  }
  if (context && (root.querySelector(".swadetools-itemfulldata,.swadetools-dialog-item"))) contexts.set(app, context);
  return context;
}
async function toolsClasses() {
  return classes ??= import("/modules/swade-tools/scripts/gb.js").then(() => Promise.all([
    import("/modules/swade-tools/scripts/class/CharRoll.js"),
    import("/modules/swade-tools/scripts/class/ItemRoll.js"),
    import("/modules/swade-tools/scripts/gb.js"),
    import("/modules/swade-tools/scripts/class/Char.js"),
  ])).then(([char, item, gb, actor]) => ({ CharRoll: char.default, ItemRoll: item.default, Char: actor.default, gb }));
}
export async function toolsTargetDefense(actor, kind) {
  const { Char, gb } = await toolsClasses();
  const char = new Char(actor), modifiers = [];
  const edge = (name, value, ability = false) => {
    if (ability ? char.hasAbilitySetting(name) : char.hasEdgeSetting(name)) modifiers.push({ label: gb.settingKeyName(name), value });
  };
  if (kind === "ranged") {
    edge("Dodge", -2);
    if (gb.setting("autoCover")) {
      const shield = [...actor.items].filter((item) => item.system.equipStatus === 3 && Number(item.system.cover) < 0)
        .sort((a, b) => Number(a.system.cover) - Number(b.system.cover))[0];
      if (shield) modifiers.push({ label: shield.name, value: Number(shield.system.cover) });
    }
  }
  edge("Combat Acrobat", -1);
  edge("Rifts Uncanny Reflexes", -2, true);
  return modifiers;
}
export async function toolsForecast(context, root, damage = false, actionId) {
  const { CharRoll, ItemRoll, gb } = await toolsClasses();
  let { actor, item, skill, attribute } = context;
  if (actor.type === "vehicle") actor = gb.getDriver(actor);
  if (!actor?.isOwner) return null;
  const value = (id) => root.querySelector("#" + id)?.value ?? "";
  const checked = (id) => root.querySelector("#" + id)?.checked;
  const modifications = [];
  const chosen = item?.system.actions?.additional?.[actionId];
  if (chosen && !["trait", "damage"].includes(chosen.type)) return null;
  // Only these read-only modifier collectors are used. Never call Tools' roll,
  // resource, macro, status, targeting, or form-processing methods for a preview.
  const collector = { actor, item: item ?? false, data: item?.system?.actions, flagUpdate: { usecalled: value("calledshots") },
    addModifier: (value) => { if (value !== undefined && value !== null && value !== "") modifications.push(String(value)); }, addFlavor() {} };
  CharRoll.prototype.baseModifiers.call(collector, damage);
  collector.addModifier(value("mod") || 0);
  collector.addModifier(value("multiaction") || 0);
  collector.addModifier(({ Light: -2, Medium: -4, Heavy: -6, Total: -8 })[value("cover")] || 0);
  collector.addModifier(({ Dim: -2, Dark: -4, Pitch: -6 })[value("illumination")] || 0);
  if (damage) {
    if (!item?.system?.damage && !value("actiondmg")) return null;
    ItemRoll.prototype.addDmgMod.call(collector);
    const action = chosen?.type === "damage" ? chosen : item.system.actions?.additional?.[value("actiondmg")];
    let formula = String(action?.override || item.system.damage || "0");
    if (action) collector.addModifier(action.modifier);
    formula = CharRoll.prototype.changeStr.call(collector, formula);
    const desperate = Number(value("desperate")) || 0;
    collector.addModifier(desperate === 1 ? 2 : -desperate);
    if (checked("raise")) formula += "+1d" + (item.system.bonusDamageDie || 6);
    return { formula: gb.explodeAllDice(formula) + modifications.map((value) => "+(" + gb.explodeAllDice(value) + ")").join(""), damage: true, actor, label: action?.name ? "Damage · " + action.name : "" };
  }
  if (item) {
    if (item.system.innate) return null;
    ItemRoll.prototype.addSkillMod.call(collector);
    const name = chosen?.type === "trait" && chosen.override ? chosen.override : item.system.actions?.trait;
    attribute = gb.findAttr(name);
    skill = actor.items.find((entry) => entry.type === "skill" && entry.name === name);
    if (chosen?.type === "trait") collector.addModifier(chosen.modifier);
  }
  let trait = attribute ? actor.system.attributes?.[attribute] : skill?.system;
  if (!trait) { trait = { die: { sides: 4, modifier: -2 }, "wild-die": { sides: 6 } }; }
  for (const effect of trait.effects ?? []) collector.addModifier(effect.value);
  collector.addModifier(trait.die.modifier);
  const linked = attribute || trait.attribute;
  for (const effect of actor.system.stats.globalMods[linked] ?? []) collector.addModifier(effect.value);
  for (const effect of actor.system.stats.globalMods.trait ?? []) collector.addModifier(effect.value);
  if (linked === "agility") CharRoll.prototype.agilityMods.call(collector);
  if (item?.type === "weapon" && item.system.actions?.trait === gb.setting("shootingSkill")) {
    collector.addModifier(-Math.max(0, (gb.getMinStr(item) - gb.getStrForMinStr(actor)) / 2));
  }
  const desperate = Number(value("desperate")) || 0;
  collector.addModifier(desperate === 1 ? 2 : desperate);
  const wild = actor.isWildcard || checked("grouproll");
  const base = "1d" + trait.die.sides + "x";
  const rof = chosen?.type === "trait" ? Number(chosen.dice) || 1 : actionId === "rapidFire" ? (Number(item?.system.rof) || 1) + 1 : actionId === "frenzy" ? 2 : 1;
  const dice = Array.from({ length: Math.min(rof, 8) }, () => base);
  if (wild) dice.push("1dw" + (checked("grouproll") ? 6 : trait["wild-die"]?.sides || 6));
  const formula = "{" + dice.join(",") + "}kh" + (rof > 1 ? rof : "")
    + modifications.map((value) => "+(" + gb.explodeAllDice(value) + ")").join("");
  return { formula, actor, item, skill, attribute, trait: true, extra: !wild, bestShot: rof > 1, label: rof > 1 ? "Best shot · RoF " + rof : chosen?.type === "trait" ? chosen.name : actor.name };
}
