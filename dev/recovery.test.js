import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { recoverShaken } from "../scripts/swade.js";

describe("Shaken recovery", () => {
  let actor, calls;
  beforeEach(() => {
    calls=[];
    globalThis.game={modules:new Map(),i18n:{localize:(key)=>key}};
    actor={type:"character",isOwner:true,statuses:new Set(["shaken"]),effects:[],
      system:{wounds:{value:2},attributes:{spirit:{unShakeBonus:2}}},
      rollAttribute:async(key,options)=>{calls.push(["roll",key,options]);return {successes:1};},
      toggleActiveEffect:async(...args)=>{calls.push(["status",...args]);actor.statuses.delete("shaken");},
    };
  });
  it("rolls Spirit with the native recovery bonus and explicitly removes Shaken on success",async()=>{
    await recoverShaken(actor);
    assert.equal(calls[0][1],"spirit");
    assert.equal(calls[0][2].additionalMods[0].value,2);
    assert.deepEqual(calls[1],["status","shaken",{active:false}]);
    assert.equal(actor.system.wounds.value,2);
  });
  for (const [name,result] of [["failure",{successes:0,total:8}],["critical failure",{successes:-1,total:8}],["cancelled roll",null]]) {
    it("keeps Shaken after a "+name,async()=>{
      actor.rollAttribute=async()=>result;
      await recoverShaken(actor);
      assert.equal(calls.length,0);
      assert.ok(actor.statuses.has("shaken"));
    });
  }
  it("coalesces repeat clicks while a recovery roll is pending",async()=>{
    let finish;
    actor.rollAttribute=()=>{calls.push(["roll"]);return new Promise((resolve)=>{finish=resolve;});};
    const first=recoverShaken(actor),second=recoverShaken(actor);
    assert.equal(first,second);
    assert.equal(calls.length,1);
    finish({successes:2});await first;
    assert.equal(calls.filter(([kind])=>kind==="status").length,1);
  });
  it("keeps recovery result and Unshake bonus when Tools is active",async()=>{
    game.modules.set("swade-tools",{active:true});
    game.settings={get:()=>true};
    game.swadetools={attribute:()=>assert.fail("Tools discards the result and recovery options")};
    await recoverShaken(actor);
    assert.equal(calls[0][2].additionalMods[0].value,2);
    assert.equal(calls[1][0],"status");
  });
  it("does not roll for unshaken, unowned, or non-creature actors",async()=>{
    actor.statuses.clear();await recoverShaken(actor);
    actor.statuses.add("shaken");actor.isOwner=false;await recoverShaken(actor);
    actor.isOwner=true;actor.type="vehicle";await recoverShaken(actor);
    assert.equal(calls.length,0);
  });
  it("does not change status when ownership is revoked during the roll",async()=>{
    actor.rollAttribute=async()=>{actor.isOwner=false;return {successes:1};};
    await recoverShaken(actor);
    assert.equal(calls.length,0);
  });
  it("allows a new attempt after a roll error without changing status",async()=>{
    actor.rollAttribute=async()=>{throw new Error("roll failed");};
    await assert.rejects(recoverShaken(actor),/roll failed/);
    actor.rollAttribute=async()=>({successes:1});
    await recoverShaken(actor);
    assert.deepEqual(calls,[["status","shaken",{active:false}]]);
  });
});
