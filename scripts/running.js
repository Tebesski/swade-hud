import { importSwadeTools } from "./tools-imports.js";

const updates = new WeakMap();
export function applyRunningPenalty(actor) {
  if (!actor?.isOwner) return;
  const operation = (updates.get(actor) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!actor.isOwner) return;
    const data = {
      disabled: false,
      duration: {value: 1, units: "rounds", expiry: "turnEnd", expired: false},
      start: CONFIG.ActiveEffect.documentClass.getEffectStart(),
    };
    const existing = actor.effects.find(effect => effect.flags?.["swade-hud"]?.running);
    if (existing) return existing.update(data);
    return actor.createEmbeddedDocuments("ActiveEffect", [{
      ...data, name: game.i18n.localize("SWADE.Running"), type: "base",
      img: "icons/svg/wingfoot.svg", showIcon: 2,
      description: "<p>Running imposes −2 on Trait rolls until the end of this turn.</p>",
      system: {changes: [{key: "system.stats.globalMods.trait", type: "add", value: -2, phase: "initial"}], removeEffect: true},
      flags: {"swade-hud": {running: true}},
    }]);
  });
  updates.set(actor, operation);
  return operation.finally(() => { if (updates.get(actor) === operation) updates.delete(actor); });
}

const patched = new WeakSet();
export async function installToolsRunning() {
  if (!game.modules.get("swade-tools")?.active) return;
  const [{default: CharRoll}] = await importSwadeTools("scripts/class/CharRoll.js");
  if (patched.has(CharRoll.prototype)) return;
  patched.add(CharRoll.prototype);
  const original = CharRoll.prototype.rollRun;
  CharRoll.prototype.rollRun = async function (...args) {
    const result = await original.apply(this, args);
    if (Number.isFinite(this.roll?.total)) await applyRunningPenalty(this.actor);
    return result;
  };
}
