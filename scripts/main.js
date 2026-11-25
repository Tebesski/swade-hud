import {t as sbsI18n} from "./i18n.mjs";
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
import { decorateWeaponMessage, renderWeaponMessage } from "./attack-options.js";
import { adjustChaseAttackModifiers, registerTestQuery, renderTestRaiseNote } from "./basic-actions.js";
import { registerMountedStatus } from "./effects.js";
import { consumeSupport, installToolsSupport, markSupportRoll, registerSupportQuery } from "./support.js";
import { renderGrappleCard } from "./grapple-chat.js";
import { installToolsRunning } from "./running.js";

const hud = new SwadeHUD();
let advancedTargeting = false;
const distance = new DistanceOverlay(() => hud.resolveToken(), () => !advancedTargeting && game.settings.get(MODULE_ID, "tokenDistance"));
Hooks.on("sbsAdvancedTargeting", active => {
  advancedTargeting = active;
  distance.refresh();
});
const insights = new RollInsights();
insights.start();
hud.refreshFeatures = () => { distance.refresh(); insights.refresh(); };
Hooks.on("hoverToken", (token, hovered) => distance.hover(token, hovered));
Hooks.on("canvasTearDown", () => distance.reset());
Hooks.on("preCreateChatMessage", decorateToolsChatMessage);
Hooks.on("preCreateChatMessage", decoratePowerCastMessage);
Hooks.on("preCreateChatMessage", decorateWeaponMessage);
Hooks.on("swadeCalculateDefaultAttackMods", adjustChaseAttackModifiers);
Hooks.on("swadePreRollAttribute", (actor, attribute, roll) => markSupportRoll(actor, "attribute", attribute, roll));
Hooks.on("swadePreRollSkill", (actor, skill, roll) => markSupportRoll(actor, "skill", skill.id, roll));
Hooks.on("createChatMessage", (message, _options, userId) => consumeSupport(message, userId).catch(error => hud.report(error)));
Hooks.on("renderChatMessageHTML", (message, html) => {
  renderGrappleCard(message, html).catch(error => hud.report(error));
  renderTestRaiseNote(message, html);
  renderWeaponMessage(message, html, useItem);
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
  registerSupportQuery();
  registerTestQuery();
  game.modules.get(MODULE_ID).api = hud;
});
Hooks.once("setup", registerMountedStatus);
Hooks.once("ready", async () => {
  await migrateSettings().catch((error) => hud.report(error));
  installToolsDialogOverride().catch((error) => hud.report(error));
  installToolsSupport().catch((error) => hud.report(error));
  installToolsRunning().catch((error) => hud.report(error));
  hud.render();
});
Hooks.on("updateSetting", setting => {
  if ((setting.key ?? setting._source?.key) === "swade.noPowerPoints") hud.schedule();
});
Hooks.on("controlToken", (token, controlled) => {
  if (controlled) hud.rememberToken(token);
  hud.schedule();
});
for (const hook of [sbsI18n("swade-hud.UI.canvasReady_e014fae8cf"), sbsI18n("swade-hud.UI.renderHotbar_432801825d"), sbsI18n("swade-hud.UI.createToken_eb21103a1f"), sbsI18n("swade-hud.UI.deleteToken_816f3e587e"), sbsI18n("swade-hud.UI.updateToken_0a526b9437"),
  sbsI18n("swade-hud.UI.updateWorldTime_35272cec51"), sbsI18n("swade-hud.UI.updateCombat_b113e210aa"), sbsI18n("swade-hud.UI.deleteCombat_d0b7e5bed9"), sbsI18n("swade-hud.UI.updateCombatant_37669944be"), sbsI18n("swade-hud.UI.deleteCombatant_13413e86f0")]) Hooks.on(hook, () => hud.schedule());
Hooks.on("canvasTearDown", () => { hud.forgetToken(); hud.hide(); });
for (const hook of [sbsI18n("swade-hud.UI.updateActor_688e2852e2"), sbsI18n("swade-hud.UI.deleteActor_703cc9c936"),
  sbsI18n("swade-hud.UI.createItem_2be87307d5"), sbsI18n("swade-hud.UI.updateItem_fc765ef48a"), sbsI18n("swade-hud.UI.deleteItem_0259ed622a"), sbsI18n("swade-hud.UI.createActiveEffect_4607bdbb60"), sbsI18n("swade-hud.UI.updateActiveEffect_5ddfac034c"), sbsI18n("swade-hud.UI.deleteActiveEffect_1194b28b56")]) {
  Hooks.on(hook, (document, changed) => {
    const actor = document.documentName === "Actor" ? document
      : document.actor ?? document.parent?.actor ?? document.parent;
    const item = document.documentName === "ActiveEffect" && document.parent?.documentName === "Item" ? document.parent : null;
    const shortcut = item && hud.actor && hud.shortcuts().some(entry => entry?.uuid === item.uuid);
    if (actor?.uuid === hud.actor?.uuid || actor?.uuid === hud.effectPanels.actor?.uuid || changed?.ownership || shortcut) hud.schedule();
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
