import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  applySizeChange, initializePrototypeSize, onActorSizeChange, onSizeEffectChange, preparePrototypeSizeUpdate,
} from "../scripts/scale.js";

describe("permanent Size synchronization", () => {
  const makeActor = () => ({
    uuid: "Actor.test", type: "npc", isOwner: true,
    system: { stats: { size: 0 } }, _source: { system: { stats: { size: 0 } } },
    prototypeToken: { width: 1, height: 1 }, getDependentTokens: () => [],
  });

  it("saves the prototype footprint along with a Size edit on an unplaced actor", async () => {
    const actor = makeActor();
    const update = { system: { stats: { size: 6 } }, prototypeToken: { name: "Giant" } };
    preparePrototypeSizeUpdate(actor, update);
    assert.deepEqual(update.prototypeToken, { name: "Giant", width: 3, height: 3 });

    actor.update = async (changes) => {
      preparePrototypeSizeUpdate(actor, changes);
      Object.assign(actor.prototypeToken, changes.prototypeToken);
    };
    await applySizeChange(actor, null, -2);
    assert.deepEqual(actor.prototypeToken, { width: 0.8, height: 0.8 });
  });

  it("sizes new actors and leaves standalone prototype edits alone", () => {
    const actor = makeActor();
    actor.type = "vehicle";
    actor._source.system = { size: 12 };
    actor.updateSource = ({ prototypeToken }) => Object.assign(actor.prototypeToken, prototypeToken);
    initializePrototypeSize(actor);
    assert.deepEqual(actor.prototypeToken, { width: 5, height: 5 });
    const update = { system: { size: 12 }, prototypeToken: { width: 4 } };
    preparePrototypeSizeUpdate(actor, update);
    assert.deepEqual(update.prototypeToken, { width: 4 });
  });

  it("resizes linked scene documents and keeps timed footprints specific to their token", async () => {
    globalThis.game = { user: { id: "owner" } };
    const actor = makeActor();
    const makeToken = (uuid) => ({
      uuid, actor, isOwner: true, width: 1, height: 1,
      async update(changes) { Object.assign(this, changes); },
    });
    const local = makeToken("Scene.active.Token.test");
    const remote = makeToken("Scene.inactive.Token.test");
    actor.system.stats.size = 9;
    actor.effects = [{ active: true, flags: { "swade-hud": { sizeChange: { tokenUuid: local.uuid } } } }];
    actor.getDependentTokens = (options) => {
      assert.deepEqual(options, { linked: true, concreteOnly: true });
      return [local, remote];
    };
    await onActorSizeChange(actor, { system: { stats: { size: 3 } } }, {}, "another-user");
    assert.deepEqual([local.width, remote.width], [1, 1]);
    await onActorSizeChange(actor, { system: { stats: { size: 3 } } }, {}, "owner");
    assert.deepEqual([local.width, remote.width], [4, 2]);
  });

  it("resizes a synthetic actor's own token without writing a prototype", async () => {
    globalThis.game = { user: { id: "owner" } };
    const actor = makeActor();
    actor.isToken = true;
    actor.system.stats.size = -3;
    actor.token = { uuid: "Scene.inactive.Token.test", actor, isOwner: true, width: 1, height: 1,
      async update(changes) { Object.assign(this, changes); } };
    const changes = { system: { stats: { size: -3 } } };
    preparePrototypeSizeUpdate(actor, changes);
    assert.equal(changes.prototypeToken, undefined);
    await onActorSizeChange(actor, changes, {}, "owner");
    assert.deepEqual([actor.token.width, actor.token.height], [0.5, 0.5]);
  });

  it("finishes at the newest footprint when two edits overlap", async () => {
    globalThis.game = { user: { id: "owner" } };
    const actor = makeActor();
    const firstStarted = Promise.withResolvers();
    const firstCanFinish = Promise.withResolvers();
    const token = { uuid: "Scene.inactive.Token.test", actor, isOwner: true, width: 1, height: 1,
      async update(changes) {
        if (changes.width === 2) {
          firstStarted.resolve();
          await firstCanFinish.promise;
        }
        Object.assign(this, changes);
      } };
    actor.getDependentTokens = () => [token];
    const first = onActorSizeChange(actor, { "system.stats.size": 2 }, {}, "owner");
    await firstStarted.promise;
    const second = onActorSizeChange(actor, { "system.stats.size": 0 }, {}, "owner");
    firstCanFinish.resolve();
    await Promise.all([first, second]);
    assert.deepEqual([token.width, token.height], [1, 1]);
  });
});

describe("optional timed size changes",()=>{
  let actor,token,created,updates;
  beforeEach(()=>{
    created=[];updates=[];
    globalThis.game={user:{id:"owner"}};
    actor={uuid:"Actor.test",type:"character",isOwner:true,system:{stats:{size:0}},_source:{system:{stats:{size:0}}},
      prototypeToken:{width:1,height:1},
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
      assert.deepEqual(actor.prototypeToken,{width:1,height:1});
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
