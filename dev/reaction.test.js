import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { reactionEffect, toggleReactionEffect } from "../scripts/effects.js";

describe("Reaction used toggle", () => {
  let actor, start, created, deleted, gate;
  beforeEach(() => {
    created = []; deleted = []; gate = undefined;
    start = { time: 120, combat: "combat", combatant: "combatant", initiative: 6, round: 3, turn: 1 };
    globalThis.CONFIG = { ActiveEffect: { documentClass: { getEffectStart: () => structuredClone(start) } } };
    actor = { uuid: "Actor.test", isOwner: true, effects: [], async createEmbeddedDocuments(type, data) {
      created.push({ type, data });
      if (gate) await gate;
      return data.map(entry => {
        const effect = { ...entry, async delete() { deleted.push(this); actor.effects.splice(actor.effects.indexOf(this), 1); } };
        actor.effects.push(effect); return effect;
      });
    } };
  });
  it("creates one native timed effect with an arrow icon and automatic removal", async () => {
    await toggleReactionEffect(actor);
    const effect = reactionEffect(actor);
    assert.equal(created[0].type, "ActiveEffect"); assert.equal(actor.effects.length, 1);
    assert.equal(effect.name, "Reaction used"); assert.equal(effect.img, "icons/svg/direction.svg");
    assert.equal(effect.type, "base"); assert.equal(effect.origin, actor.uuid);
    assert.deepEqual(effect.duration, { value: 1, units: "rounds", expiry: "turnEnd", expired: false });
    assert.deepEqual(effect.start, start); assert.equal(effect.system.removeEffect, true);
    assert.deepEqual(effect.system.changes, []); assert.equal(effect.transfer, false);
  });
  it("removes the marker on the next click", async () => {
    await toggleReactionEffect(actor); await toggleReactionEffect(actor);
    assert.equal(reactionEffect(actor), undefined); assert.equal(created.length, 1); assert.equal(deleted.length, 1);
  });
  it("starts a fresh duration after native expiry removes the effect", async () => {
    await toggleReactionEffect(actor); await reactionEffect(actor).delete();
    start.time = 180; start.round = 4;
    await toggleReactionEffect(actor);
    assert.equal(actor.effects.length, 1); assert.equal(reactionEffect(actor).start.time, 180);
  });
  it("does not remove unrelated effects with the same name", async () => {
    const unrelated = { name: "Reaction used" }; actor.effects.push(unrelated);
    await toggleReactionEffect(actor); await toggleReactionEffect(actor);
    assert.deepEqual(actor.effects, [unrelated]);
  });
  it("serializes rapid clicks while creation is pending", async () => {
    let release; gate = new Promise(resolve => { release = resolve; });
    const first = toggleReactionEffect(actor), second = toggleReactionEffect(actor);
    release(); await Promise.all([first, second]);
    assert.equal(created.length, 1); assert.equal(deleted.length, 1); assert.equal(actor.effects.length, 0);
  });
  it("requires ownership and checks it again before a queued operation", async () => {
    actor.isOwner = false; await toggleReactionEffect(actor); assert.equal(reactionEffect(actor), undefined);
    actor.isOwner = true; const pending = toggleReactionEffect(actor); actor.isOwner = false;
    await pending; assert.equal(created.length, 0);
  });
});
