import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { MODULE_ID, SWADE_TOOLS_SETTING, SWADE_TOOLS_GLOBAL_SETTING, rollAttribute, rollSkill, rollRunning, useItem, hasSwadeToolsItemDialog, openSwadeToolsItemDialog } from "../scripts/swade.js";
import { registerSettings, migrateSettings } from "../scripts/settings.js";

describe("optional SWADE Tools roll integration", () => {
  let calls, actor, weapon, power, action, modules;
  const named = (provider, method) => (...args) => { calls.push({ provider, method, args }); };
  const toolsCalls = () => calls.filter((call) => call.provider === "tools");
  const nativeCalls = () => calls.filter((call) => call.provider === "native");
  beforeEach(() => {
    calls = [];
    weapon = { id:"weapon", type:"weapon", system:{actions:{additional:{
      throwing:{type:"trait"}, alternate:{type:"damage"}, macro:{type:"macro"}, resist:{type:"resist"},
    }}} };
    power = { id:"power", type:"power", system:{pp:3,ppModifiers:{cost:3},actions:{additional:{effectMacro:{type:"macro"}}}} };
    action = { id:"ability", type:"action", system:{actions:{trait:"Intimidation"}} };
    const items = [weapon,power,action,{id:"skill",type:"skill",system:{swid:"athletics"}},
      {id:"unskilled",type:"skill",system:{swid:"unskilled-attempt"}}];
    items.get = (id) => items.find((item)=>item.id===id);
    actor = { id:"actor", type:"character", isOwner:true, items, system:{},
      rollAttribute:named("native","attribute"), rollSkill:named("native","skill"),
      rollRunningDie:named("native","run") };
    modules = new Map([["swade-tools",{active:true}]]);
    globalThis.game = { modules, swadetools:Object.fromEntries(["attribute","skill","run","item"].map((method)=>[method,named("tools",method)])),
      settings:{get:()=>false}, i18n:{localize:(key)=>key},
      swade:{itemChatCardHelper:{handleAction:named("native","item")}} };
  });

  it("keeps Tools dialogs off and the four optional insights on by default",()=>{
    const registrations=[];
    game.settings.register=(...args)=>registrations.push(args);
    registerSettings();
    assert.equal(registrations.length,7);
    const [namespace,key,config]=registrations[0];
    assert.equal(namespace,MODULE_ID);assert.equal(key,SWADE_TOOLS_SETTING);
    assert.equal(config.default,true);assert.equal(config.config,true);
    assert.equal(config.scope,"client");assert.equal(config.type,Boolean);
    assert.equal(config.requiresReload,false);
    const [,globalKey,globalConfig]=registrations[1];
    assert.equal(globalKey,SWADE_TOOLS_GLOBAL_SETTING);assert.equal(globalConfig.default,false);
    assert.equal(globalConfig.scope,"client");assert.equal(globalConfig.requiresReload,false);
    for(const [namespace,key,setting] of registrations.slice(2)) {
      assert.equal(namespace,MODULE_ID);assert.ok(["tokenDistance","damageEstimate","successRates","chatRollRange","fixTargetedDamageSoak"].includes(key));
      assert.equal(setting.default,true);assert.equal(setting.config,true);assert.equal(setting.scope,"client");assert.equal(setting.requiresReload,false);
    }
  });
  it("uses native rolls and blocks item dialogs when the HUD disable setting is on",async()=>{
    game.settings.get=(namespace,key)=>namespace===MODULE_ID && key===SWADE_TOOLS_SETTING;
    game.swade.swadetoolsAttack=()=>assert.fail("Setting is disabled");
    await rollAttribute(actor,"agility");await rollSkill(actor,"skill");await rollRunning(actor);
    await useItem(actor,weapon);await useItem(actor,power);
    await openSwadeToolsItemDialog(actor,action);
    assert.equal(hasSwadeToolsItemDialog(weapon),false);
    assert.equal(hasSwadeToolsItemDialog(action),false);
    assert.equal(toolsCalls().length,0);
    assert.deepEqual(nativeCalls().map((call)=>call.method),["attribute","skill","run","item","item"]);
  });
  it("treats a missing setting value as disabled",async()=>{
    game.settings.get=()=>undefined;
    await rollAttribute(actor,"smarts");await useItem(actor,weapon);
    assert.equal(toolsCalls().length,0);assert.equal(nativeCalls().length,2);
  });
  it("applies setting changes on the next roll without a reload",async()=>{
    let disabled=false;
    game.settings.get=(namespace,key)=>namespace===MODULE_ID && key===SWADE_TOOLS_SETTING && disabled;
    await rollAttribute(actor,"agility");
    disabled=true;await rollAttribute(actor,"agility");
    disabled=false;await rollAttribute(actor,"agility");
    assert.equal(toolsCalls().length,2);assert.equal(nativeCalls().length,1);
  });

  for (const [name, run, args] of [
    ["attribute", ()=>rollAttribute(actor,"agility"), ()=>[actor,"agility"]],
    ["skill", ()=>rollSkill(actor,"skill"), ()=>[actor,"skill"]],
    ["run", ()=>rollRunning(actor), ()=>[actor]],
  ]) {
    it("delegates "+name+" to the active Tools API exactly once", async () => {
      await run();
      assert.deepEqual(toolsCalls(),[{provider:"tools",method:name,args:args()}]);
      assert.equal(nativeCalls().length,0);
    });
  }
  for (const itemName of ["weapon","power"]) {
    for (const roll of ["formula","damage"]) {
      it("opens the Tools item dialog for "+itemName+" "+roll, async () => {
        const item = itemName==="weapon" ? weapon : power;
        await useItem(actor,item,roll);
        assert.deepEqual(toolsCalls(),[{provider:"tools",method:"item",args:[actor,item.id]}]);
        assert.equal(nativeCalls().length,0);
      });
    }
  }
  it("opens the Tools item dialog for throwing and additional damage actions", async () => {
    await useItem(actor,weapon,"throwing");
    await useItem(actor,weapon,"alternate");
    assert.equal(toolsCalls().length,2);
    assert.ok(toolsCalls().every((call)=>call.method==="item" && call.args[0]===actor && call.args[1]===weapon.id));
    assert.equal(nativeCalls().length,0);
  });
  it("does not run vanilla rolls when a Tools dialog returns undefined or null", async () => {
    game.swadetools.item=()=>undefined;
    game.swadetools.attribute=()=>null;
    await useItem(actor,power);
    await rollAttribute(actor,"smarts");
    assert.equal(nativeCalls().length,0);
  });
  it("does not duplicate a roll after Tools rejects", async () => {
    game.swadetools.item=async()=>{throw new Error("Tools failed");};
    await assert.rejects(useItem(actor,weapon),/Tools failed/);
    assert.equal(nativeCalls().length,0);
  });
  it("keeps macros, resistance actions, and reload on the native action path", async () => {
    for (const key of ["macro","resist","reload"]) await useItem(actor,weapon,key);
    await useItem(actor,power,"effectMacro");
    assert.equal(toolsCalls().length,0);
    assert.deepEqual(nativeCalls().map((call)=>call.args[2]),["macro","resist","reload","effectMacro"]);
  });
  it("does not turn unsupported item types into Tools chat cards", async () => {
    await useItem(actor,action);
    assert.equal(toolsCalls().length,0);
    assert.equal(nativeCalls()[0].args[0],action);
  });
  it("opens Tools native item dialogs for configured abilities through its system entry point",async()=>{
    game.swade.swadetoolsAttack=named("tools","itemDialog");
    assert.equal(hasSwadeToolsItemDialog(action),true);
    await openSwadeToolsItemDialog(actor,action);
    assert.deepEqual(toolsCalls(),[{provider:"tools",method:"itemDialog",args:[actor,action,true]}]);
    assert.equal(nativeCalls().length,0);
  });
  it("keeps its public weapon/power API preferred over the extended entry point",async()=>{
    game.swade.swadetoolsAttack=()=>assert.fail("Public item API is available");
    await openSwadeToolsItemDialog(actor,power);
    assert.deepEqual(toolsCalls()[0].args,[actor,power.id]);
  });
  it("does not open a Tools shortcut dialog when disabled or unowned",async()=>{
    game.swade.swadetoolsAttack=()=>assert.fail("Unexpected dialog");
    actor.isOwner=false;await openSwadeToolsItemDialog(actor,action);
    actor.isOwner=true;modules.clear();await openSwadeToolsItemDialog(actor,action);
    assert.equal(hasSwadeToolsItemDialog(action),false);
    assert.equal(calls.length,0);
  });
  it("passes vehicles to Tools without swapping away their item collection", async () => {
    actor.type="vehicle";
    actor.system.operator={id:"driver"};
    await useItem(actor,weapon);
    assert.equal(toolsCalls()[0].args[0],actor);
    assert.equal(toolsCalls()[0].args[1],weapon.id);
    assert.equal(nativeCalls().length,0);
  });
  it("uses the owned unskilled item when Tools is available", async () => {
    await rollSkill(actor,null);
    assert.equal(toolsCalls()[0].args[1],"unskilled");
  });
  it("preserves native unskilled attempts when no unskilled item exists", async () => {
    actor.items.splice(actor.items.findIndex((item)=>item.id==="unskilled"),1);
    await rollSkill(actor,null);
    assert.equal(toolsCalls().length,0);
    assert.equal(nativeCalls()[0].args[0],null);
  });
  it("falls back when Tools is disabled even if its API remains present", async () => {
    modules.get("swade-tools").active=false;
    await rollAttribute(actor,"spirit"); await rollSkill(actor,"skill");
    await rollRunning(actor); await useItem(actor,power);
    assert.equal(toolsCalls().length,0);
    assert.deepEqual(nativeCalls().map((call)=>call.method),["attribute","skill","run","item"]);
  });
  it("falls back when Tools is not installed", async () => {
    modules.clear();
    await useItem(actor,weapon);
    assert.equal(nativeCalls().length,1);
    assert.equal(toolsCalls().length,0);
  });
  it("falls back before the Tools API is ready", async () => {
    delete game.swadetools;
    await rollAttribute(actor,"vigor"); await rollSkill(actor,"skill");
    await rollRunning(actor); await useItem(actor,weapon);
    assert.equal(nativeCalls().length,4);
  });
  it("falls back separately for missing API methods", async () => {
    game.swadetools={};
    await rollAttribute(actor,"vigor"); await rollSkill(actor,"skill");
    await rollRunning(actor); await useItem(actor,weapon);
    assert.equal(nativeCalls().length,4);
  });
  it("preserves special native roll options rather than discarding bonuses", async () => {
    const options={additionalMods:[{label:"Soak bonus",value:2}]};
    await rollAttribute(actor,"vigor",options);
    await rollSkill(actor,"skill",options);
    assert.equal(toolsCalls().length,0);
    assert.ok(nativeCalls().every((call)=>call.args[1]===options));
  });
  it("leaves No Power Points modifiers to Tools without also invoking vanilla", async () => {
    game.settings.get=(namespace)=>namespace!==MODULE_ID;
    await useItem(actor,power);
    assert.equal(toolsCalls().length,1);
    assert.equal(nativeCalls().length,0);
  });
  it("retains No Power Points handling and vehicle crew in vanilla fallback", async () => {
    modules.clear();
    game.settings.get=()=>true;
    await useItem(actor,power);
    assert.equal(nativeCalls()[0].args[3].additionalMods[0].value,-2);
    const gunner={id:"gunner"};
    actor.type="vehicle"; actor.system.getCrewMemberForWeapon=()=>gunner;
    await useItem(actor,weapon);
    assert.equal(nativeCalls()[1].args[1],gunner);
  });
  it("never delegates rolls for an unowned actor", async () => {
    actor.isOwner=false;
    await rollAttribute(actor,"agility"); await rollSkill(actor,"skill");
    await rollRunning(actor); await useItem(actor,weapon);
    assert.equal(calls.length,0);
  });
});

describe("HUD dialog preference migration", () => {
  for (const [name, legacy, current, expected] of [
    ["fresh client keeps the new enabled default", null, null, undefined],
    ["old opt-in false becomes disable true", "false", null, true],
    ["old opt-in true becomes disable false", "true", null, false],
    ["saved disable true remains untouched", "true", "true", undefined],
    ["saved disable false remains untouched", "false", "false", undefined],
    ["invalid legacy data is ignored", "invalid", null, undefined],
  ]) it(name, async () => {
    const writes=[];
    const storage={getItem:key=>key.endsWith(".useSwadeToolsDialogs")?legacy:current};
    globalThis.game={settings:{storage:new Map([["client",storage]]),
      set:async(...args)=>{writes.push(args);}}};
    await migrateSettings();
    assert.deepEqual(writes,expected===undefined?[]:[[MODULE_ID,SWADE_TOOLS_SETTING,expected]]);
  });
  it("migrates only once and preserves later changes",async()=>{
    const stored=new Map([[MODULE_ID+".useSwadeToolsDialogs","false"]]);
    const writes=[];
    globalThis.game={settings:{storage:new Map([["client",{getItem:key=>stored.get(key)??null}]]),
      set:async(namespace,key,value)=>{writes.push(value);stored.set(namespace+"."+key,JSON.stringify(value));}}};
    await migrateSettings();
    await game.settings.set(MODULE_ID,SWADE_TOOLS_SETTING,false);
    await migrateSettings();
    assert.deepEqual(writes,[true,false]);
  });
});
