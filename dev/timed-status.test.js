import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { applyTimedStatus } from "../scripts/effects.js";

describe("timed system statuses", () => {
  let actor, definition, calls, start, gate;
  beforeEach(() => {
    calls = [];
    start = { time: 120, combat: "combat", combatant: "combatant", initiative: 6, round: 3, turn: 1 };
    definition = { id: "distracted", _id: "distracted000000", name: "SWADE.Distracted", img: "status.svg", statuses: ["additional"],
      duration: { value: 0, units: "rounds", expiry: "turnEndPrompt" }, system: { changes: [{ key: "system.stats.globalMods.trait", type: "add", value: -2 }], removeEffect: false },
      flags: { swade: { related: { vulnerable: {} } } } };
    globalThis.CONFIG = { statusEffects: [definition], ActiveEffect: { documentClass: { getEffectStart: () => structuredClone(start) } } };
    globalThis.foundry = { utils: { deepClone: structuredClone } };
    actor = { uuid: "Actor.test", isOwner: true, effects: [], allApplicableEffects() { return this.effects; },
      async toggleActiveEffect(data, options) {
        calls.push({ data, options });
        if (gate) await gate;
        const effect = { ...data, id: data._id, uuid: "Actor.test.ActiveEffect." + data._id, parent: actor, active: true,
          statuses: new Set([data.id, ...(data.statuses ?? [])]),
          async update(changed) { calls.push({ update: changed }); Object.assign(this, changed); this.active = !this.disabled && !this.duration.expired; } };
        this.effects.push(effect);
      } };
    gate = undefined;
  });
  for (const units of ["rounds", "minutes", "hours"]) it("applies the canonical status for a number of " + units, async () => {
    const original = structuredClone(definition);
    const result = await applyTimedStatus(actor, "distracted", 4, units);
    assert.deepEqual(calls[0].options, { active: true });
    assert.deepEqual(result.duration, { value: 4, units, expiry: "turnEnd", expired: false });
    assert.deepEqual(result.start, start); assert.equal(result.system.removeEffect, true);
    assert.deepEqual(result.system.changes, original.system.changes); assert.deepEqual(result.flags, original.flags);
    assert.equal(result.transfer, false); assert.equal(result.disabled, false);
    assert.deepEqual(definition, original);
  });
  it("refreshes an existing status and restarts its native clock without toggling it off", async () => {
    const effect = await applyTimedStatus(actor, "distracted", 2, "rounds");
    start.time = 180; start.round = 4; calls.length = 0;
    const result = await applyTimedStatus(actor, "distracted", 5, "minutes");
    assert.equal(result, effect); assert.equal(actor.effects.length, 1); assert.equal(calls.length, 1);
    assert.equal(result.duration.value, 5); assert.equal(result.start.time, 180);
    assert.equal(calls[0].update["system.removeEffect"], true);
  });
  it("reenables a disabled or expired status", async () => {
    const effect = await applyTimedStatus(actor, "distracted", 1, "rounds");
    effect.disabled = true; effect.active = false; effect.duration.expired = true;
    await applyTimedStatus(actor, "distracted", 1, "hours");
    assert.equal(effect.disabled, false); assert.equal(effect.active, true); assert.equal(effect.duration.expired, false);
  });
  it("supports native status maps", async () => {
    CONFIG.statusEffects = { distracted: definition };
    assert.ok(await applyTimedStatus(actor, "distracted", 3, "rounds"));
  });
  it("rejects invalid timing before creating or changing an effect", async () => {
    for (const [value, units] of [[0, "rounds"], [-1, "hours"], [1.5, "minutes"], [NaN, "rounds"], [Infinity, "rounds"], [1, "days"]])
      await assert.rejects(applyTimedStatus(actor, "distracted", value, units), /positive whole-number/);
    assert.equal(calls.length, 0);
  });
  it("does not time arbitrary actor effects or act without ownership", async () => {
    assert.equal(await applyTimedStatus(actor, "Actor.effect", 1, "rounds"), undefined);
    actor.isOwner = false;
    assert.equal(await applyTimedStatus(actor, "distracted", 1, "rounds"), undefined);
    assert.equal(calls.length, 0);
  });
  it("does not retime a different effect that grants several statuses", async () => {
    const other = { id: "other", statuses: new Set(["distracted", "additional", "other"]), duration: { value: null },
      update: async () => { throw Error("Unrelated status effect must not change"); } };
    actor.effects.push(other);
    const result = await applyTimedStatus(actor, "distracted", 2, "rounds");
    assert.notEqual(result, other); assert.equal(actor.effects.length, 2); assert.equal(other.duration.value, null);
  });
  it("coalesces concurrent applications of the same status", async () => {
    let release; gate = new Promise((resolve) => { release = resolve; });
    const first = applyTimedStatus(actor, "distracted", 2, "rounds");
    const second = applyTimedStatus(actor, "distracted", 2, "rounds");
    assert.equal(calls.length, 1); release();
    const result = await Promise.all([first, second]);
    assert.equal(result[0], result[1]); assert.equal(actor.effects.length, 1);
  });
});
