import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { withToolsChatCard, decorateToolsChatMessage } from "../scripts/tools-chat.js";

describe("native SWADE dialogs with Tools chat automation",()=>{
  let listeners,actor,item,sequence;
  beforeEach(()=>{
    listeners=new Map();let nextId=0;sequence=[];
    globalThis.Hooks={
      on:(name,callback)=>{const id=++nextId;listeners.set(id,{name,callback});return id;},
      off:(_name,id)=>listeners.delete(id),
      call:(name,...args)=>{for(const entry of [...listeners.values()])if(entry.name===name)entry.callback(...args);},
    };
    actor={id:"actor",uuid:"Actor.actor",isToken:true,token:{id:"token"}};
    item={id:"weapon",uuid:actor.uuid+".Item.weapon"};
    globalThis.game={modules:new Map([["swade-tools",{active:true}]]),user:{id:"user",targets:new Set([{id:"target"}])}};
  });
  function message(roll){
    const result={rolls:[structuredClone(roll)],flags:{other:{retained:true}},updateSource(data){this.tools=data["flags.swade-tools"];}};
    decorateToolsChatMessage(result,{}, {},"user");return result;
  }
  for(const [kind,hook] of [["skill","swadePreRollSkill"],["damage","swadeRollDamage"]]){
    it("keeps the standard "+kind+" dialog before one automated chat card",async()=>{
      const mods=[];let confirm;
      const pending=withToolsChatCard({actor,item,action:kind==="damage"?"damage":"formula",mods},async()=>{
        const roll={terms:[{options:{}}]};
        Hooks.call(hook,actor,kind==="damage"?item:{name:"Shooting"},roll,mods,{additionalMods:mods});
        sequence.push("standard dialog");
        await new Promise((resolve)=>{confirm=resolve;});
        sequence.push("confirmed");return message(roll);
      });
      assert.deepEqual(sequence,["standard dialog"]);
      confirm();const chat=await pending;
      assert.deepEqual(sequence,["standard dialog","confirmed"]);
      assert.equal(chat.tools.itemroll,"weapon");assert.equal(chat.tools.rolltype,kind);
      assert.equal(chat.tools.usetoken,"token");assert.equal(chat.tools.usetarget,"target");
      assert.equal(chat.flags.other.retained,true);assert.equal(listeners.size,0);
    });
  }
  it("removes temporary handlers after cancelling the native dialog",async()=>{
    const result=await withToolsChatCard({actor,mods:[]},async()=>null);
    assert.equal(result,null);assert.equal(listeners.size,0);
  });
  it("never marks unrelated rolls or concurrent dialogs with different modifier arrays",async()=>{
    const modsA=[],modsB=[];
    const a={terms:[{options:{}}]},b={terms:[{options:{}}]},unrelated={terms:[{options:{}}]};
    await withToolsChatCard({actor,item,action:"formula",mods:modsA},()=>withToolsChatCard({actor,item,action:"alternate",mods:modsB},async()=>{
      Hooks.call("swadePreRollSkill",actor,{name:"Shooting"},a,[],{additionalMods:modsA});
      Hooks.call("swadePreRollSkill",actor,{name:"Fighting"},b,[],{additionalMods:modsB});
      Hooks.call("swadePreRollSkill",actor,{name:"Notice"},unrelated,[],{additionalMods:[]});
      assert.equal(message(a).tools.useaction,"formula");assert.equal(message(b).tools.useaction,"alternate");
      assert.equal(message(unrelated).tools,undefined);
    }));
    assert.equal(listeners.size,0);
  });
  it("uses final targets and keeps vehicle context for crew-operated weapons",async()=>{
    const mods=[];const vehicle={id:"vehicle",type:"vehicle",isToken:true,token:{id:"vehicle-token"}};
    await withToolsChatCard({actor,owner:vehicle,item,action:"damage",mods},async()=>{
      const roll={terms:[{options:{}}]};Hooks.call("swadeRollDamage",vehicle,item,roll,[],{additionalMods:mods});
      game.user.targets=new Set([{id:"new-target"}]);
      const chat=message(roll);
      assert.equal(chat.tools.usevehicle,"vehicle");assert.equal(chat.tools.usevehicletoken,"vehicle-token");
      assert.equal(chat.tools.usetarget,"new-target");
    });
  });
  it("cleans up after errors and never substitutes another roll",async()=>{
    await assert.rejects(withToolsChatCard({actor,mods:[]},async()=>{throw new Error("cancelled by error");}),/cancelled by error/);
    assert.equal(listeners.size,0);
  });
  it("does not decorate messages while Tools is inactive",async()=>{
    game.modules.get("swade-tools").active=false;
    await withToolsChatCard({actor,mods:[]},async()=>assert.equal(listeners.size,0));
  });
});
