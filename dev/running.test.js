import assert from "node:assert/strict";
import {beforeEach, it} from "node:test";
import {rollRunning} from "../scripts/swade.js";

let actor, effects;
beforeEach(() => {
  effects = [];
  globalThis.game = {modules: new Map(), i18n: {localize: key => key}};
  globalThis.CONFIG = {ActiveEffect: {documentClass: {getEffectStart: () => ({time: 0})}}};
  actor = {isOwner: true, effects, rollRunningDie: async () => ({total: 9}),
    createEmbeddedDocuments: async (_type, entries) => {
      for (const data of entries) effects.push({...data, update: async changes => Object.assign(effects[0], changes)});
    }};
});
it("applies the running Trait penalty after a confirmed HUD Run roll", async () => {
  await rollRunning(actor);
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0].system.changes, [
    {key: "system.stats.globalMods.trait", type: "add", value: -2, phase: "initial"},
  ]);
  assert.equal(effects[0].duration.units, "rounds");
  assert.equal(effects[0].duration.value, 1);
  assert.equal(effects[0].duration.expiry, "turnEnd");
});
it("refreshes running without stacking penalties, including concurrent rolls", async () => {
  await Promise.all([rollRunning(actor), rollRunning(actor)]);
  assert.equal(effects.length, 1);
});
it("does not apply running when cancelled or when the actor is unowned", async () => {
  actor.rollRunningDie = async () => null;
  await rollRunning(actor);
  actor.isOwner = false;
  await rollRunning(actor);
  assert.equal(effects.length, 0);
});
