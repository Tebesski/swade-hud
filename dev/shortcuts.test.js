import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { itemShortcutActions } from "../scripts/item-actions.js";
import { actorSize, adjustScale, setActorSize, tokenFootprint } from "../scripts/scale.js";

globalThis.game = { i18n: { localize: (key) => key === "SWADE.AttrAgi" ? "Agility" : key } };

describe("configured shortcut actions", () => {
  const actor = { items: [{ id:"notice-id", name:"Notice", type:"skill", system:{swid:"notice"} }] };
  for (const type of ["action", "gear", "edge", "hindrance", "ability"]) {
    it("finds an additional-only action on " + type, () => {
      const item = { type, name:"Ability", system:{actions:{additional:{scan:{name:"Scan", type:"trait", override:"notice-id"}}}} };
      assert.deepEqual(itemShortcutActions(actor,item), [{key:"scan",label:"Scan (Notice)",icon:"fa-play"}]);
    });
  }
  it("includes base and additional actions with effective traits", () => {
    const item = { name:"Lookout", system:{actions:{trait:"notice", additional:{
      evade:{name:"Evade",type:"trait",override:"agility"},
      search:{name:"Search",type:"trait"},
      effect:{name:"Apply",type:"macro"},
    }}} };
    assert.deepEqual(itemShortcutActions(actor,item).map(({key,label})=>[key,label]),[
      ["formula","Lookout (Notice)"],["evade","Evade (Agility)"],["search","Search (Notice)"],["effect","Apply"],
    ]);
  });
  it("does not invent actions for a passive item", () => {
    assert.deepEqual(itemShortcutActions(actor,{system:{actions:{trait:"",additional:{}}}}),[]);
    assert.deepEqual(itemShortcutActions(actor,{system:{}}),[]);
  });
});

describe("actor scale and grid footprints", () => {
  it("sets an entered size directly, retaining active-effect contributions", async()=>{
    const changes=[];
    const actor={type:"npc",isOwner:true,system:{stats:{size:2}},_source:{system:{stats:{size:0}}},update:async(data)=>changes.push(data)};
    const token={isOwner:true,update:async(data)=>changes.push(data)};
    await setActorSize(actor,token,12);
    assert.deepEqual(changes,[{"system.stats.size":10},{width:5,height:5}]);
  });
  it("accepts negative entered sizes and rejects fractional or non-finite values", async()=>{
    const changes=[];
    const actor={type:"character",isOwner:true,system:{stats:{size:2}},update:async(data)=>changes.push(data)};
    const token={update:async(data)=>changes.push(data)};
    for(const value of [NaN,Infinity,2.5]) await setActorSize(actor,token,value);
    assert.equal(changes.length,0);
    await setActorSize(actor,token,-2);
    assert.deepEqual(changes,[{"system.stats.size":-2},{width:.8,height:.8}]);
  });
  it("uses every requested boundary, including values beyond the reference table", () => {
    for (const [size,footprint] of [[-10,.5],[-4,.5],[-3,.5],[-2,.8],[-1,1],[0,1],[1,1],
      [2,2],[5,2],[6,3],[8,3],[9,4],[11,4],[12,5],[13,6],[20,6],[30,6]]) {
      assert.equal(tokenFootprint(size),footprint,"Size "+size);
    }
  });
  it("updates Size and the actual token footprint", async () => {
    const changes=[];
    const actor={type:"character",isOwner:true,system:{stats:{size:1}},update:async(data)=>changes.push(data)};
    const token={isOwner:true,update:async(data)=>changes.push(data)};
    await adjustScale(actor,token,1);
    assert.deepEqual(changes,[{"system.stats.size":2},{width:2,height:2}]);
  });
  it("preserves active-effect size contributions and handles vehicle storage", async () => {
    const changes=[];
    const actor={type:"vehicle",isOwner:true,system:{size:6},_source:{system:{size:4}},update:async(data)=>changes.push(data)};
    const token={update:async(data)=>changes.push(data)};
    assert.equal(actorSize(actor),6);
    await adjustScale(actor,token,-1);
    assert.deepEqual(changes,[{"system.size":3},{width:2,height:2}]);
  });
  it("does not change unowned actors, unowned tokens, groups, or invalid deltas", async () => {
    const update=async()=>assert.fail("Unexpected update");
    const actor={type:"character",isOwner:true,system:{stats:{size:0}},update};
    await adjustScale({...actor,isOwner:false},{update},1);
    await adjustScale(actor,{isOwner:false,update},1);
    await adjustScale({...actor,type:"group"},{update},1);
    await adjustScale(actor,{update},NaN);
    await adjustScale(null,null,1);
  });
});
