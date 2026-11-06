import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { wrapToolsDialogClasses } from "../scripts/tools-dialogs.js";
import { SWADE_TOOLS_GLOBAL_SETTING, hasSwadeToolsItemDialog } from "../scripts/swade.js";
import { decorateToolsChatMessage } from "../scripts/tools-chat.js";

describe("global SWADE Tools dialog override", () => {
  let disabled, calls, actor, weapon, SystemRoll, ItemDialog;
  beforeEach(() => {
    disabled = false; calls = [];
    const record = (kind, ...args) => { calls.push({ kind, args }); return kind; };
    weapon = { id: "spear", type: "weapon", system: { actions: { trait: "Fighting" }, damage: "2d6" } };
    const skill = { id: "fight", name: "Fighting", type: "skill", system: {} };
    const items = [weapon, skill]; items.get = (id) => items.find((item) => item.id === id);
    actor = { id: "actor", uuid: "Actor.actor", isOwner: true, items, system: {},
      rollAttribute: (...args) => record("native attribute", ...args),
      rollSkill: (...args) => record("native skill", ...args),
      rollRunningDie: () => record("native running") };
    SystemRoll = class {
      constructor(actor) { this.actor = actor; this.modifiers = []; }
      rollAtt(...args) { return record("tools attribute", this, ...args); }
      rollSkill(...args) { return record("tools skill", this, ...args); }
      rollRun(...args) { return record("tools running", this, ...args); }
      rollDamage(...args) { return record("tools damage", this, ...args); }
      otherAutomation() { return "unchanged"; }
    };
    ItemDialog = class {
      constructor(actor, item) { this.actor = actor; this.item = item; }
      showDialog(...args) { return record("tools item", this, ...args); }
    };
    const hooks = new Map(); let next = 0;
    globalThis.Hooks = {
      on: (name, callback) => { const id = ++next; hooks.set(id, { name, callback }); return id; },
      off: (_name, id) => hooks.delete(id),
      call: (name, ...args) => { for (const hook of hooks.values()) if (hook.name === name) hook.callback(...args); },
    };
    globalThis.game = {
      modules: new Map([["swade-tools", { active: true }]]),
      user: { id: "user", targets: new Set() }, i18n: { localize: key => key },
      settings: { get: (namespace, key) => namespace === "swade-hud" && key === SWADE_TOOLS_GLOBAL_SETTING && disabled },
      swade: { itemChatCardHelper: { handleAction: (...args) => record("native item", ...args) } },
      swadetools: { item: () => assert.fail("Global override must take priority over HUD preference") },
    };
    wrapToolsDialogClasses(SystemRoll, ItemDialog);
  });
  it("preserves original Tools methods, arguments and return values while off", () => {
    const roll = new SystemRoll(actor), item = new ItemDialog(actor, weapon);
    assert.equal(roll.rollAtt("spirit"), "tools attribute");
    assert.equal(roll.rollSkill("fight"), "tools skill");
    assert.equal(roll.rollRun(), "tools running");
    assert.equal(roll.rollDamage("spear"), "tools damage");
    assert.equal(item.showDialog("argument"), "tools item");
    assert.equal(calls[0].args[0], roll); assert.equal(calls[0].args[1], "spirit");
    assert.equal(calls[4].args[1], "argument");
  });
  it("routes shared sheet, API and macro trait entry points to native dialogs", async () => {
    disabled = true; const roll = new SystemRoll(actor);
    await roll.rollAtt("agility"); await roll.rollSkill("fight"); await roll.rollRun();
    assert.deepEqual(calls.map(call => call.kind), ["native attribute", "native skill", "native running"]);
    assert.equal(calls[0].args[0], "agility"); assert.equal(calls[1].args[0], "fight");
    assert.equal(roll.otherAutomation(), "unchanged");
  });
  it("uses native item attack and damage helpers once and overrides the HUD preference", async () => {
    disabled = true;
    assert.equal(hasSwadeToolsItemDialog(weapon), false);
    await new ItemDialog(actor, weapon).showDialog();
    await new SystemRoll(actor).rollDamage(weapon.id);
    assert.deepEqual(calls.map(call => call.args[2]), ["formula", "damage"]);
    assert.ok(calls.every(call => call.kind === "native item"));
  });
  it("resolves named skills and missing skills to native unskilled attempts", async () => {
    disabled = true; const roll = new SystemRoll(actor);
    await roll.rollSkill("Fighting"); await roll.rollSkill("Missing");
    assert.equal(calls[0].args[0], "fight"); assert.equal(calls[1].args[0], null);
  });
  it("retains supplied modifiers and capped vehicle handling penalties", async () => {
    disabled = true; const roll = new SystemRoll(actor);
    roll.modifiers = [{ reason: "Maneuver", mod: 2 }];
    roll.vehicle = { system: { wounds: { value: 6 } } };
    await roll.rollSkill("fight");
    assert.deepEqual(calls[0].args[1].additionalMods, [{ label: "Maneuver", value: 2 }, { label: "Handling", value: -4 }]);
    assert.deepEqual(roll.modifiers, [{ reason: "Maneuver", mod: 2 }]);
  });
  it("keeps a vehicle's native crew and item context", async () => {
    disabled = true;
    const vehicle = { id: "vehicle", type: "vehicle", isOwner: true, system: { getCrewMemberForWeapon: () => actor } };
    const item = new ItemDialog(actor, weapon); item.vehicle = vehicle;
    await item.showDialog();
    assert.equal(calls[0].args[0], weapon); assert.equal(calls[0].args[1], actor);
  });
  it("opens damage for damage-only items", async () => {
    disabled = true; weapon.system.actions.trait = "";
    await new ItemDialog(actor, weapon).showDialog();
    assert.equal(calls[0].args[2], "damage");
  });
  it("takes effect immediately and installing twice never nests wrappers", async () => {
    const roll = new SystemRoll(actor);
    wrapToolsDialogClasses(SystemRoll, ItemDialog);
    await roll.rollAtt("vigor"); disabled = true; await roll.rollAtt("vigor");
    disabled = false; await roll.rollAtt("vigor");
    assert.deepEqual(calls.map(call => call.kind), ["tools attribute", "native attribute", "tools attribute"]);
  });
  it("requires ownership for every redirected roll", async () => {
    disabled = true; actor.isOwner = false;
    const roll = new SystemRoll(actor);
    await roll.rollAtt("spirit"); await roll.rollSkill("fight"); await roll.rollRun();
    await roll.rollDamage("spear"); await new ItemDialog(actor, weapon).showDialog();
    assert.equal(calls.length, 0);
  });
  it("waits for native confirmation and preserves Tools chat metadata", async () => {
    disabled = true; let confirm;
    actor.rollAttribute = async (attribute, options) => {
      const roll = { terms: [{ options: {} }] };
      Hooks.call("swadePreRollAttribute", actor, attribute, roll, [], options);
      await new Promise(resolve => { confirm = resolve; });
      const chat = { rolls: [structuredClone(roll)], updateSource: data => { chat.tools = data["flags.swade-tools"]; } };
      decorateToolsChatMessage(chat, {}, {}, game.user.id);
      return chat;
    };
    const pending = new SystemRoll(actor).rollAtt("spirit");
    assert.equal(calls.length, 0); confirm();
    const chat = await pending;
    assert.equal(chat.tools.rolltype, "attribute"); assert.equal(chat.tools.attribute, "spirit");
    assert.equal(chat.tools.useactor, actor.id);
  });
  it("never rolls again after cancellation or a native error", async () => {
    disabled = true; actor.rollAttribute = async () => null;
    const roll = new SystemRoll(actor);
    assert.equal(await roll.rollAtt("spirit"), null);
    actor.rollAttribute = async () => { throw Error("Native failure"); };
    await assert.rejects(roll.rollAtt("spirit"), /Native failure/);
    assert.equal(calls.length, 0);
  });
});
