import {t as sbsI18n} from "./i18n.mjs";
const TEMPLATES = [
  { key: "small", preset: "sbt", get label() { return sbsI18n("swade-hud.UI.SBT_ebc227c70c"); }, get title() { return sbsI18n("swade-hud.UI.SmallBlastTemplate_38f7f81780"); } },
  { key: "medium", preset: "mbt", get label() { return sbsI18n("swade-hud.UI.MBT_47459e6881"); }, get title() { return sbsI18n("swade-hud.UI.MediumBlastTemplate_ac768697a2"); } },
  { key: "large", preset: "lbt", get label() { return sbsI18n("swade-hud.UI.LBT_3f592f5540"); }, get title() { return sbsI18n("swade-hud.UI.LargeBlastTemplate_489e11ac15"); } },
  { key: "scone", preset: "swscone", get label() { return sbsI18n("swade-hud.UI.SCone_da83adcdcd"); }, get title() { return sbsI18n("swade-hud.UI.SmallConeTemplate_b56c576620"); } },
  { key: "cone", preset: "swcone", get label() { return sbsI18n("swade-hud.UI.Cone_3b5ebcbf43"); }, get title() { return sbsI18n("swade-hud.UI.ConeTemplate_25c64e974f"); } },
  { key: "stream", preset: "stream", get label() { return sbsI18n("swade-hud.UI.Stream_1eec3071dd"); }, get title() { return sbsI18n("swade-hud.UI.StreamTemplate_b8c7d81785"); } },
];
function betterTemplates() {
  const module = globalThis.game?.modules?.get?.("swade-better-templates");
  return module?.active ? module.api : undefined;
}
export function powerPoolUsesNoPP(actor, arcane = sbsI18n("swade-hud.UI.general_0feae16d55")) {
  const worldRule = Boolean(game.settings.get("swade", "noPowerPoints"));
  const powers = game.modules?.get?.("swade-better-powers");
  const setting = game.modules?.get?.("swade-better-setting");
  if (!powers?.active && !(setting?.active && setting.api?.openPowers)) return worldRule;
  const entries = Object.values(powers?.api?.readPowerFlag?.(actor, "spellcastingEntries")
    ?? actor?.flags?.["swade-better-powers"]?.spellcastingEntries
    ?? actor?.flags?.["swade-better-setting"]?.spellcastingEntries
    ?? (setting?.active ? actor?.getFlag?.("swade-better-setting", "spellcastingEntries") : undefined) ?? {});
  const entry = entries.find(entry => String(entry.arcane).trim().toLowerCase() === String(arcane || "general").trim().toLowerCase());
  return entry?.noPowerPoints ?? worldRule;
}
export function powerUsesNoPP(item, actor = item.actor ?? item.parent) {
  const api = game.modules?.get?.("swade-better-powers")?.api;
  if (api?.usesNoPowerPoints && item.actor === actor) return api.usesNoPowerPoints(item);
  return powerPoolUsesNoPP(actor, item.system.arcane || "general");
}
export function powerCostPresentation(item, actor) {
  const cost = Math.max(0, Number(item.system.ppModifiers?.cost ?? item.system.pp) || 0);
  const noPP = powerUsesNoPP(item, actor);
  return {cost, noPP, text: noPP ? String(-Math.ceil(cost / 2)) : `${cost} PP`, title: noPP ? sbsI18n("swade-hud.UI.NoPowerPointscastingpenalty_4279deb48f") : sbsI18n("swade-hud.UI.PowerPointcost_f86ba667c7")};
}
export function powerTemplates(item) {
  const range = String(item.system.range ?? "").toLowerCase();
  const selected = TEMPLATES.filter((template) => item.system.templates?.[template.key]);
  const rings = betterTemplates()?.getRingTemplates?.(item) ?? [];
  selected.push(...rings.map(({key, preset, label}) => ({key, preset, label, title: label})));
  if (selected.length) return selected;
  return TEMPLATES.filter((template) => {
    switch (template.key) {
      case "small": return /\b(smt|sbt)\b|small (blast|burst|template)/.test(range);
      case "medium": return /\bmbt\b|medium (blast|burst|template)/.test(range);
      case "large": return /\blbt\b|large (blast|burst|template)/.test(range);
      case "scone": return /small cone/.test(range);
      case "cone": return /cone/.test(range) && !/small cone/.test(range);
      case "stream": return /stream/.test(range);
    }
  });
}
export function placePowerTemplate(preset, item, castContext) {
  const api = betterTemplates();
  const ring = api?.getRingTemplates?.(item)?.find(template => template.preset === preset);
  const shape = TEMPLATES.find(template => template.preset === preset);
  const configured = castContext && (api?.readCastAutomation?.(item) ?? api?.readAutomation?.(item))?.shapes?.includes(shape?.key);
  if (ring || configured) return api.placeTemplate(item, ring?.key ?? shape.key, { castContext });
  return game.swade.util.createRegionFromPreset(preset, item);
}
export const isTemplateRange = (range) => /\b(smt|sbt|mbt|lbt|cone|stream|ring)\b|blast template|burst template/i.test(String(range));
export const isBoostLowerTrait = (item) => item.type === "power"
  && /boost.*lower.*trait/i.test(String(item.system.swid || item.name).replaceAll("-", " "));
