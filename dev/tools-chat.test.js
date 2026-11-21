import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { existsSync } from "node:fs";
import { withToolsChatCard, decorateToolsChatMessage, guardToolsAttackTargets } from "../scripts/tools-chat.js";
import { grappleOutcome } from "../scripts/grapple-chat.js";

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
    game.i18n = {localize: value => value};
  });
  function message(roll){
    const result={rolls:[structuredClone(roll)],flags:{other:{retained:true}},updateSource(data){
      if (data["flags.swade-tools"]) this.tools=data["flags.swade-tools"];
      if (data["flags.swade-hud.grapple"]) this.grapple=data["flags.swade-hud.grapple"];
      if (data["flags.swade-hud.nativeAttack"]) this.nativeAttack=data["flags.swade-hud.nativeAttack"];
    }};
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
  it("routes Grapple's opposed roll to Grab and preserves Crush as damage", async () => {
    const grapple = {id: "grapple", type: "action", system: {swid: "grapple"}};
    const targetUuid = "Scene.scene.Token.target";
    game.user.targets = new Set([{id: "target", document: {uuid: targetUuid}}]);
    for (const tools of [true, false]) {
      game.modules.get("swade-tools").active = tools;
      const mods = [];
      await withToolsChatCard({actor, item: grapple, action: "formula", mods}, async () => {
        const roll = {terms: [{options: {}}]};
        Hooks.call("swadePreRollSkill", actor, {name: "Athletics"}, roll, mods, {additionalMods: mods});
        const chat = message(roll);
        assert.deepEqual(chat.grapple, {targetUuid});
        assert.equal(chat.tools?.itemroll, undefined);
      });
    }
    game.modules.get("swade-tools").active = true;
    const mods = [];
    await withToolsChatCard({actor, item: grapple, action: "crush", mods}, async () => {
      const roll = {terms: [{options: {}}]};
      Hooks.call("swadeRollDamage", actor, grapple, roll, mods, {additionalMods: mods});
      const chat = message(roll);
      assert.equal(chat.grapple, undefined);
      assert.equal(chat.tools.itemroll, grapple.id);
      assert.equal(chat.tools.rolltype, "damage");
    });
  });
  it("uses the opposed Athletics result to select Entangled or Bound", () => {
    const grab = {total: 9};
    assert.equal(grappleOutcome(grab, {total: 9}, new Set()), null);
    assert.equal(grappleOutcome(grab, {total: 7}, new Set()), "entangled");
    assert.equal(grappleOutcome(grab, {total: 5}, new Set()), "bound");
    assert.equal(grappleOutcome(grab, {total: 7}, new Set(["entangled"])), "bound");
  });
  it("only builds Tools attack controls with a usable follow-up damage formula", () => {
    class RollControl {
      chat = {flags: {"swade-tools": {itemroll: "item"}}};
      getItemOwner() { return {items: new Map([["item", this.item]])}; }
      attackTarget(target) { return target; }
    }
    guardToolsAttackTargets(RollControl);
    const card = new RollControl();
    for (const type of ["action", "ability", "power", "gear", "weapon"]) {
      card.item = {type, system: {damage: " "}};
      assert.equal(card.attackTarget("target"), undefined);
    }
    card.item = {type: "weapon", system: {damage: "2d6"}};
    assert.equal(card.attackTarget("target"), "target");
    card.chat.flags["swade-tools"].damageaction = "missing";
    assert.equal(card.attackTarget("target"), undefined);
    card.item = {type: "action", system: {actions: {additional: {crush: {type: "damage", override: "@str"}}}}};
    card.chat.flags["swade-tools"].damageaction = "crush";
    assert.equal(card.attackTarget("target"), "target");
  });
  for (const disabled of [false, true]) it("counts native range/cover/scale bonuses once with modifiers " + (disabled ? "disabled" : "enabled"), async () => {
    const mods = [], defaults = [{label: "Range", value: -4}, {label: "Cover", value: -2},
      {label: "Scale", value: 2}, {label: "Vulnerable", value: 2}];
    const reference = {id: "reference", actor: {system: {stats: {parry: {value: 7}}}}};
    const near = {id: "near", actor: {system: {stats: {parry: {value: 5}}}}};
    game.user.targets = new Set([reference, near]);
    game.swade = {util: {getDefaultAttackModifiers: () => ({additionalMods: [], bestNonStackingMods: {}})}};
    let chat;
    await withToolsChatCard({actor, item, action: "formula", mods}, async () => {
      Hooks.call("swadeCalculateDefaultAttackMods", null, reference, {}, item, true, false, defaults, {});
      const roll = {terms: [{options: {}}]};
      Hooks.call("swadePreRollSkill", actor, {name: "Athletics"}, roll, defaults, {additionalMods: mods});
      // These flags are changed on confirmation, after the pre-roll hook.
      if (disabled) for (const mod of defaults) mod.ignore = true;
      chat = message(roll);
    });
    assert.equal(chat.nativeAttack.targets.reference.targetNumber, 4);
    assert.equal(chat.nativeAttack.targets.near.targetNumber, disabled ? 4 : 2);
    assert.equal(listeners.size, 0);
    // A frozen card remains valid after its temporary roll context is released.
    assert.equal(chat.nativeAttack.version, 1);
  });
  it("native melee attacks use each defender's Parry without adding its modifier twice", async () => {
    const mods = [], target = {id: "target", actor: {system: {stats: {parry: {value: 7, modifier: 2}}}}};
    game.user.targets = new Set([target]);
    game.swade = {util: {getDefaultAttackModifiers: () => ({additionalMods: []})}};
    await withToolsChatCard({actor, item, action: "formula", mods}, async () => {
      Hooks.call("swadeCalculateDefaultAttackMods", null, target, {}, item, false, true, [], {});
      const roll = {terms: [{options: {}}]};
      Hooks.call("swadePreRollSkill", actor, {name: "Fighting"}, roll, [], {additionalMods: mods});
      assert.equal(message(roll).nativeAttack.targets.target.targetNumber, 7);
    });
  });
  it("Tools reports 9 - 4 as a hit and preserves clickable damage and raises", {
    skip: !existsSync(new URL("../../swade-tools/scripts/class/RollControl.js", import.meta.url)),
  }, async () => {
    const {default: RollControl} = await import("../../swade-tools/scripts/class/RollControl.js");
    const target = {id: "target", name: "Defender", actor: {}};
    const weapon = {type: "weapon", system: {damage: "2d6", range: "3/6/12"}};
    const chat = {rolls: [{total: 5}], flags: {"swade-tools": {itemroll: "weapon"},
      "swade-hud": {nativeAttack: {version: 1, targets: {target: {targetNumber: 4}}}}}};
    const control = new RollControl(chat, null, null);
    control.getItemOwner = () => ({items: new Map([["weapon", weapon]])});
    for (const [total, outcome] of [[5, "hit"], [3, "miss"], [8, "raise"]]) {
      control.attackTarget(target, total, 1);
      assert.match(control.targetPrint.at(-1).print, new RegExp("swadetools-term-" + outcome));
      if (outcome !== "miss") assert.match(control.targetPrint.at(-1).print, /swadetools-rolldamage/);
    }
    assert.equal(typeof control.targetFunction, "function");
  });
});
