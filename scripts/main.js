import { SwadeHUD } from "./hud.js";
import { MODULE_ID, useItem } from "./swade.js";
import { initializePrototypeSize, onActorSizeChange, onSizeEffectChange, preparePrototypeSizeUpdate } from "./scale.js";
import { registerSettings, migrateSettings } from "./settings.js";
import { bennyPool } from "./bennies.js";
import { decorateToolsChatMessage } from "./tools-chat.js";
import { DistanceOverlay } from "./distance.js";
import { RollInsights } from "./roll-insights.js";
import { installToolsDialogOverride } from "./tools-dialogs.js";
import { decoratePowerCastMessage, renderPowerCastCard, trackPowerCastDialog } from "./power-chat.js";
import { patchTargetedDamageDialog } from "./targeted-damage.js";

const hud = new SwadeHUD();
const distance = new DistanceOverlay(() => hud.resolveToken(), () => game.settings.get(MODULE_ID, "tokenDistance"));
const insights = new RollInsights();
insights.start();
hud.refreshFeatures = () => { distance.refresh(); insights.refresh(); };
Hooks.on("hoverToken", (token, hovered) => distance.hover(token, hovered));
Hooks.on("canvasTearDown", () => distance.reset());
Hooks.on("preCreateChatMessage", decorateToolsChatMessage);
Hooks.on("preCreateChatMessage", decoratePowerCastMessage);
Hooks.on("renderChatMessageHTML", (message, html) => {
  renderPowerCastCard(message, html, useItem).catch((error) => console.error("SWADE HUD | Power cast card", error));
});
Hooks.on("renderApplicationV2", (app, html) => {
  trackPowerCastDialog(app);
  patchTargetedDamageDialog(app, html);
});
const syncSizeEffect = (effect, userId) => onSizeEffectChange(effect, userId).catch((error) => hud.report(error));
Hooks.on("preCreateActor", initializePrototypeSize);
Hooks.on("preUpdateActor", preparePrototypeSizeUpdate);
Hooks.on("updateActor", (actor, changes, options, userId) => {
  onActorSizeChange(actor, changes, options, userId).catch((error) => hud.report(error));
});
Hooks.on("createActiveEffect", (effect, _options, userId) => syncSizeEffect(effect, userId));
Hooks.on("updateActiveEffect", (effect, _changed, _options, userId) => syncSizeEffect(effect, userId));
Hooks.on("deleteActiveEffect", (effect, _options, userId) => syncSizeEffect(effect, userId));
Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = hud;
});
Hooks.once("ready", async () => {
  await migrateSettings().catch((error) => hud.report(error));
  installToolsDialogOverride().catch((error) => hud.report(error));
  hud.render();
});
Hooks.on("updateSetting", setting => {
  if ((setting.key ?? setting._source?.key) === "swade.noPowerPoints") hud.schedule();
});
Hooks.on("controlToken", (token, controlled) => {
  if (controlled) hud.rememberToken(token);
  hud.schedule();
});
for (const hook of ["canvasReady", "renderHotbar", "createToken", "deleteToken", "updateToken",
  "updateWorldTime", "updateCombat", "deleteCombat"]) Hooks.on(hook, () => hud.schedule());
Hooks.on("canvasTearDown", () => { hud.forgetToken(); hud.hide(); });
for (const hook of ["updateActor", "deleteActor",
  "createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, (document, changed) => {
    const actor = document.documentName === "Actor" ? document
      : document.actor ?? document.parent?.actor ?? document.parent;
    if (actor?.uuid === hud.actor?.uuid || actor?.uuid === hud.effectPanels.actor?.uuid || changed?.ownership) hud.schedule();
  });
}
Hooks.on("updateUser", (user, changed) => {
  if (user.id === game.user.id && (changed.flags?.[MODULE_ID] || Object.hasOwn(changed, "character"))) hud.schedule();
  if (bennyPool(hud.actor).owner?.id === user.id
    && (changed.flags?.swade || Object.hasOwn(changed, "flags.swade.bennies"))) hud.schedule();
});
window.addEventListener("resize", () => {
  hud.positionSidebar();
  hud.description?.positionAtShortcut?.();
  hud.effectPanels.positionTooltip();
});
