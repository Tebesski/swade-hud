import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { isUnskilledAttempt, registerTestQuery, rollCommonSkillAction } from "../scripts/basic-actions.js";
import { registerSupportQuery } from "../scripts/support.js";

const player = {id: "player", active: true, isGM: false};
const gm = {id: "gm", active: true, isGM: true};
const skill = {id: "athletics", type: "skill", name: "Athletics", system: {attribute: "agility"}};
const source = {
  uuid: "Actor.source", isOwner: true, items: new Map([[skill.id, skill]]),
  testUserPermission: user => user === player || user === gm,
};
const defender = {
  uuid: "Actor.defender", get isOwner() { return game.user === gm; },
  testUserPermission: user => user === gm,
  system: {attributes: {agility: {}, vigor: {}}},
  items: [skill],
};
const target = {id: "target", uuid: "Scene.scene.Token.target", documentName: "Token", name: "Target", actor: defender};
const trait = (total, id, successes = 1) => ({total, messageId: id, successes, rollType: "trait"});

let calls, messages;
function message(id, author, roll) {
  const flags = new Map();
  const doc = {
    id, uuid: "ChatMessage." + id, author, speaker: {}, rolls: [roll],
    getFlag: (_scope, key) => flags.get(key),
    setFlag: async (_scope, key, value) => flags.set(key, value),
  };
  messages.set(id, doc);
  return doc;
}

beforeEach(() => {
  calls = [];
  messages = new Map();
  const users = Object.assign([player, gm], {activeGM: gm});
  globalThis.game = {
    user: player, users, messages, modules: new Map(),
    i18n: {localize: key => ({"SWADE.AttrAgi": "Agility", "SWADE.AttrVig": "Vigor"})[key] ?? key},
  };
  player.targets = new Set([{document: target}]);
  globalThis.CONFIG = {queries: {}};
  globalThis.CONST = {TOKEN_DISPOSITIONS: {FRIENDLY: 1}};
  globalThis.canvas = {tokens: {placeables: [{...target, document: {...target, disposition: 1}}]}};
  globalThis.ui = {notifications: {warn: reason => assert.fail(reason), info: () => {}}};
  globalThis.ChatMessage = {getSpeakerActor: () => source};
  globalThis.foundry = {
    utils: {escapeHTML: String, fromUuid: async uuid => uuid === target.uuid ? target : messages.get(uuid.split(".")[1])},
    applications: {api: {DialogV2: {}}},
  };
  gm.query = async (query, data) => {
    const user = game.user;
    calls.push([query, user.id]);
    game.user = gm;
    try { return await CONFIG.queries[query](data, {user}); }
    finally { game.user = user; }
  };
  source.rollSkill = async (id, options) => {
    calls.push(["skill", id, options.effectFlags]);
    const roll = trait(8, "sourceRoll", 2);
    message("sourceRoll", player, roll);
    return roll;
  };
  defender.effects = [];
  defender.statuses = new Set();
  defender.rollAttribute = async (attribute) => {
    calls.push(["resist", attribute, game.user.id]);
    const roll = trait(4, "resistance");
    message("resistance", gm, roll);
    return roll;
  };
  defender.toggleActiveEffect = async (status, {active}) => {
    assert.equal(active, true);
    defender.statuses.add(status);
  };
  defender.createEmbeddedDocuments = async (type, effects) => {
    assert.equal(game.user, gm);
    assert.equal(type, "ActiveEffect");
    defender.effects.push(...effects);
  };
  registerTestQuery();
  registerSupportQuery();
});

it("lets a player choose the Test condition and asks the GM to resist for an unowned target", async () => {
  foundry.applications.api.DialogV2.wait = async config => {
    assert.equal(game.user, player);
    assert.deepEqual(config.buttons.map(button => button.label), ["Distracted", "Vulnerable"]);
    return "vulnerable";
  };
  await rollCommonSkillAction(source, skill, "test");
  assert.deepEqual(calls, [["skill", skill.id, ["test"]], ["swade-hud.resolveTest", player.id], ["resist", "agility", gm.id]]);
  assert.ok(defender.statuses.has("vulnerable"));
  assert.equal(messages.get("resistance").getFlag("", "testRaise"), true);
  assert.equal(messages.get("sourceRoll").getFlag("", "testResolved"), true);
});

it("cancels a Test before sending a resistance request", async () => {
  foundry.applications.api.DialogV2.wait = async () => null;
  await rollCommonSkillAction(source, skill, "test");
  assert.deepEqual(calls, [["skill", skill.id, ["test"]]]);
  assert.equal(defender.statuses.size, 0);
});

for (const total of [3, 0, -2]) {
  it("resolves an opposed Test with an initiating total of " + total, async () => {
    source.rollSkill = async () => {
      const roll = trait(total, "lowTest", 0);
      message("lowTest", player, roll);
      return roll;
    };
    defender.rollAttribute = async () => {
      const roll = trait(total - 1, "lowResistance", 0);
      message("lowResistance", gm, roll);
      return roll;
    };
    let prompted = false;
    foundry.applications.api.DialogV2.wait = async () => {
      prompted = true;
      assert.equal(game.user, player);
      return "distracted";
    };
    await rollCommonSkillAction(source, skill, "test");
    assert.ok(prompted);
    assert.ok(defender.statuses.has("distracted"));
    assert.equal(messages.get("lowTest").getFlag("", "testResolved"), true);
  });
}

it("lets a player choose an ally and trait before rolling Support, then applies the effect as GM", async () => {
  player.targets.clear();
  const titles = [];
  foundry.applications.api.DialogV2.prompt = async config => {
    assert.equal(game.user, player);
    titles.push(config.window.title);
    assert.equal(calls.length, 0);
    if (titles.length === 1) return target.id;
    assert.match(config.content, /optgroup label="Attributes"/);
    assert.match(config.content, /optgroup label="Skills"/);
    return "attribute:vigor";
  };
  await rollCommonSkillAction(source, skill, "support");
  assert.deepEqual(titles, ["Support", "Support · Target"]);
  assert.deepEqual(calls, [["skill", skill.id, ["support"]], ["swade-hud.applySupport", player.id]]);
  assert.deepEqual(defender.effects[0].system.changes, [
    {key: "system.attributes.vigor.die.modifier", type: "add", value: 2, phase: "initial"},
  ]);
});

it("recognizes the Unskilled Attempt by SWID and by the legacy item name", () => {
  assert.ok(isUnskilledAttempt({name: "Custom name", system: {swid: "unskilled-attempt"}}));
  assert.ok(isUnskilledAttempt({name: "Unskilled Attempt", system: {}}));
  assert.equal(isUnskilledAttempt(skill), false);
});
