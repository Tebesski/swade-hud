import { MODULE_ID, SWADE_TOOLS_SETTING, SWADE_TOOLS_GLOBAL_SETTING } from "./swade.js";
import { TARGETED_DAMAGE_SOAK_SETTING } from "./targeted-damage.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, SWADE_TOOLS_SETTING, {
    name: "SWADEHUD.settings.disableSwadeToolsDialogs.name",
    hint: "SWADEHUD.settings.disableSwadeToolsDialogs.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });
  game.settings.register(MODULE_ID, SWADE_TOOLS_GLOBAL_SETTING, {
    name: "SWADEHUD.settings.disableSwadeToolsDialogsGlobally.name",
    hint: "SWADEHUD.settings.disableSwadeToolsDialogsGlobally.hint",
    scope: "client", config: true, type: Boolean, default: false, requiresReload: false,
  });
  for (const key of ["tokenDistance", "damageEstimate", "successRates", "chatRollRange"]) {
    game.settings.register(MODULE_ID, key, {
      name: "SWADEHUD.settings." + key + ".name",
      hint: "SWADEHUD.settings." + key + ".hint",
      scope: "client", config: true, type: Boolean, default: true, requiresReload: false,
      onChange: () => game.modules.get(MODULE_ID)?.api?.refreshFeatures?.(),
    });
  }
  game.settings.register(MODULE_ID, TARGETED_DAMAGE_SOAK_SETTING, {
    name: "SWADEHUD.settings.fixTargetedDamageSoak.name",
    hint: "SWADEHUD.settings.fixTargetedDamageSoak.hint",
    scope: "client", config: true, type: Boolean, default: true, requiresReload: false,
  });
}

export async function migrateSettings() {
  const storage = game.settings.storage?.get("client");
  if (!storage || storage.getItem(MODULE_ID + "." + SWADE_TOOLS_SETTING) !== null) return;
  // Preserve the previous dialog choice when changing from an opt-in setting
  // to an opt-out setting. An explicitly saved new preference always wins.
  const legacy = storage.getItem(MODULE_ID + ".useSwadeToolsDialogs");
  if (legacy === "true" || legacy === "false") {
    await game.settings.set(MODULE_ID, SWADE_TOOLS_SETTING, legacy === "false");
  }
}
