import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { applySizeChange, onSizeEffectChange } from "../scripts/scale.js";

describe("optional timed size changes",()=>{
  let actor,token,created,updates;
  beforeEach(()=>{
    created=[];updates=[];
    globalThis.game={user:{id:"owner"}};
    actor={uuid:"Actor.test",type:"character",isOwner:true,system:{stats:{size:0}},_source:{system:{stats:{size:0}}},
      update:async(data)=>{updates.push(data);actor.system.stats.size=data["system.stats.size"];},
      createEmbeddedDocuments:async(type,data)=>{
        assert.equal(type,"ActiveEffect");
        const effects=data.map((entry)=>({...entry,actor,parent:actor}));
        created.push(...effects);
        actor.system.stats.size+=data[0].system.changes[0].value;
        return effects;
      },
    };
    token={uuid:"Scene.test.Token.test",actor,isOwner:true,width:1,height:1,
      update:async(data)=>{updates.push(data);Object.assign(token,data);}};
    globalThis.fromUuid=async(uuid)=>uuid===token.uuid ? token : null;
  });
  for(const units of ["rounds","minutes","hours"]){
    it("creates a native "+units+" effect without changing the actor's base size",async()=>{
      await applySizeChange(actor,token,9,{duration:3,units});
      assert.equal(actor._source.system.stats.size,0);
      assert.equal(actor.system.stats.size,9);
      assert.equal(created.length,1);
      assert.deepEqual(created[0].duration,{value:3,units,expiry:"turnEnd"});
      assert.equal(created[0].system.removeEffect,true);
      assert.deepEqual(created[0].system.changes,[{key:"system.stats.size",type:"add",value:9,phase:"initial"}]);
      assert.equal(created[0].flags["swade-hud"].sizeChange.tokenUuid,token.uuid);
      assert.deepEqual(updates,[{width:4,height:4}]);
    });
  }
  it("restores the token footprint after native expiry, removal, or disabling",async()=>{
    await applySizeChange(actor,token,-2,{duration:1,units:"rounds"});
    assert.equal(token.width,.8);
    actor.system.stats.size=0; // Native preparation after the effect stops applying.
    await onSizeEffectChange(created[0],"owner");
    assert.equal(token.width,1);assert.equal(token.height,1);
    assert.equal(actor._source.system.stats.size,0);
  });
  it("uses the current effective size when another size change remains",async()=>{
    await applySizeChange(actor,token,12,{duration:2,units:"minutes"});
    actor.system.stats.size=6;
    await onSizeEffectChange(created[0],"owner");
    assert.equal(token.width,3);
  });
  it("retains permanent behavior when the duration is omitted",async()=>{
    await applySizeChange(actor,token,2);
    assert.equal(created.length,0);
    assert.deepEqual(updates,[{"system.stats.size":2},{width:2,height:2}]);
  });
  it("rejects invalid durations before creating effects",async()=>{
    for(const duration of [0,-1,NaN,2.5]){
      await assert.rejects(applySizeChange(actor,token,2,{duration,units:"rounds"}),/duration/);
    }
    await assert.rejects(applySizeChange(actor,token,2,{duration:1,units:"days"}),/duration/);
    assert.equal(created.length,0);assert.equal(updates.length,0);
  });
  it("does not synchronize on other clients or touch unowned or unrelated tokens",async()=>{
    await applySizeChange(actor,token,9,{duration:2,units:"hours"});
    actor.system.stats.size=0;updates.length=0;
    await onSizeEffectChange(created[0],"another-user");
    token.isOwner=false;await onSizeEffectChange(created[0],"owner");
    token.isOwner=true;token.actor={...actor,uuid:"Actor.other"};await onSizeEffectChange(created[0],"owner");
    assert.equal(updates.length,0);
  });
  it("ignores a deleted target token",async()=>{
    await applySizeChange(actor,token,9,{duration:2,units:"hours"});
    globalThis.fromUuid=async()=>null;updates.length=0;
    await onSizeEffectChange(created[0],"owner");
    assert.equal(updates.length,0);
  });
  it("supports the vehicle Size field",async()=>{
    actor.type="vehicle";actor.system={size:2};
    actor.createEmbeddedDocuments=async(_type,[effect])=>{created.push(effect);actor.system.size=6;return [effect];};
    await applySizeChange(actor,token,6,{duration:1,units:"hours"});
    assert.equal(created[0].system.changes[0].key,"system.size");
    assert.equal(created[0].system.changes[0].value,4);
    assert.equal(token.width,3);
  });
});
