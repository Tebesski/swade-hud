import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { bennyPool } from "../scripts/bennies.js";
import { adjustResource } from "../scripts/swade.js";

describe("actor and GM Benny pools",()=>{
  let actor,gm;
  beforeEach(()=>{
    actor={id:"npc",type:"npc",isOwner:true,system:{wildcard:true,bennies:{value:2}},
      getBenny:async()=>{actor.system.bennies.value++;},spendBenny:async()=>{if(actor.system.bennies.value>0)actor.system.bennies.value--;}};
    gm={id:"gm",isGM:true,bennies:5,getBenny:async()=>{gm.bennies++;},spendBenny:async()=>{if(gm.bennies>0)gm.bennies--;}};
    globalThis.game={user:gm,users:[gm]};
  });
  it("uses cards and the NPC's pool while the Wild Card has Bennies",async()=>{
    assert.equal(bennyPool(actor).icon,"fa-cards");assert.equal(bennyPool(actor).value,2);
    await adjustResource(actor,"bennies",1);assert.equal(actor.system.bennies.value,3);assert.equal(gm.bennies,5);
  });
  it("switches to GM Bennies after the NPC spends its last Benny",async()=>{
    actor.system.bennies.value=1;await adjustResource(actor,"bennies",-1);
    const pool=bennyPool(actor);assert.equal(pool.value,5);assert.equal(pool.icon,"fa-circle-g");assert.equal(pool.owner,gm);
    await adjustResource(actor,"bennies",-1);assert.equal(gm.bennies,4);assert.equal(actor.system.bennies.value,0);
    await adjustResource(actor,"bennies",1);assert.equal(gm.bennies,5);assert.equal(actor.system.bennies.value,0);
  });
  it("uses the GM pool for an Extra without Bennies",()=>{
    actor.system.wildcard=false;delete actor.system.bennies;
    assert.equal(bennyPool(actor).owner,gm);assert.equal(bennyPool(actor).icon,"fa-circle-g");
  });
  it("keeps characters on their own pool at zero",async()=>{
    actor.type="character";actor.system.bennies.value=0;
    assert.equal(bennyPool(actor).icon,"fa-circle-b");await adjustResource(actor,"bennies",1);
    assert.equal(actor.system.bennies.value,1);assert.equal(gm.bennies,5);
  });
  it("shows another GM's pool read-only for a player",async()=>{
    game.user={id:"player",isGM:false};actor.system.bennies.value=0;
    const pool=bennyPool(actor);assert.equal(pool.value,5);assert.equal(pool.editable,false);
    await adjustResource(actor,"bennies",1);await adjustResource(actor,"bennies",-1);assert.equal(gm.bennies,5);
  });
  it("handles a depleted GM pool without creating NPC Bennies",async()=>{
    actor.system.bennies.value=0;gm.bennies=0;
    await adjustResource(actor,"bennies",-1);assert.equal(gm.bennies,0);
    await adjustResource(actor,"bennies",1);assert.equal(gm.bennies,1);assert.equal(actor.system.bennies.value,0);
  });
});
