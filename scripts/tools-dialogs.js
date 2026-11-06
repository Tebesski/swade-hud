import { rollAttribute, rollSkill, useItem, localize, swadeToolsDialogsDisabled } from "./swade.js";
import { installToolsPowerCast } from "./power-chat.js";
import { importSwadeTools } from "./tools-imports.js";

const wrapped = new WeakMap();

// SheetControl, Tools macros, its public API and Token Action HUD all call
// these shared classes. Keep the original methods for clients that opt out;
// no Tools combat hooks, chat controls or installed source files are changed.
export function wrapToolsDialogClasses(SystemRoll, ItemDialog) {
  const wrap = (prototype, method, native) => {
    if (typeof prototype?.[method] !== "function") return;
    const methods = wrapped.get(prototype) ?? new Set();
    if (methods.has(method)) return;
    const original = prototype[method];
    prototype[method] = function (...args) {
      return swadeToolsDialogsDisabled() ? native.apply(this, args) : original.apply(this, args);
    };
    methods.add(method); wrapped.set(prototype, methods);
  };
  const options = (instance) => {
    const additionalMods = (instance.modifiers ?? []).map(({ reason, mod }) => ({ label: reason, value: mod }));
    if (instance.vehicle) {
      const value = Math.max(-4, -Number(instance.vehicle.system.wounds?.value || 0));
      if (value) additionalMods.push({ label: localize("SWADE.Handling", "Handling"), value });
    }
    return { additionalMods };
  };
  wrap(SystemRoll?.prototype, "rollAtt", function (attribute) {
    return rollAttribute(this.actor, attribute, options(this));
  });
  wrap(SystemRoll?.prototype, "rollSkill", function (id) {
    const skill = this.actor?.items.find((item) => item.type === "skill" && (item.id === id || item.name === id));
    return rollSkill(this.actor, skill?.id ?? null, options(this));
  });
  wrap(SystemRoll?.prototype, "rollRun", function () {
    return this.actor?.isOwner ? this.actor.rollRunningDie?.() : undefined;
  });
  wrap(SystemRoll?.prototype, "rollDamage", function (id) {
    return useItem(this.actor, this.actor?.items.get(id), "damage");
  });
  wrap(ItemDialog?.prototype, "showDialog", function () {
    const actor = this.vehicle || this.actor;
    const item = this.item;
    const hasTrait = String(item?.system.actions?.trait ?? "").trim();
    // Damage-only items still open the standard damage dialog; ordinary
    // weapons/powers use the same native attack/casting workflow as the HUD.
    const action = !hasTrait && item?.system.damage ? "damage" : "formula";
    return useItem(actor, item, action);
  });
  installToolsPowerCast(ItemDialog);
}

export async function installToolsDialogOverride() {
  if (!game.modules?.get("swade-tools")?.active) return;
  const [{ default: SystemRoll }, { default: ItemDialog }] = await importSwadeTools("scripts/class/SystemRoll.js", "scripts/class/ItemDialog.js");
  wrapToolsDialogClasses(SystemRoll, ItemDialog);
}
