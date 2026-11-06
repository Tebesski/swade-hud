import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { attackKind, nativeAttackSnapshot, targetedForecasts } from "../scripts/target-forecast.js";
import { rollStatistics } from "../scripts/roll-statistics.js";
import { formatRollNumber } from "../scripts/roll-insights.js";
let installedRules;
try { installedRules = await import("../../swade-better-effects/scripts/rules.mjs"); }
catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
describe("targeted attack forecasts", () => {
  let actor, item, target, forecast;
  beforeEach(() => {
    globalThis.game = { user: { isGM: true, targets: new Set() }, modules: new Map(), i18n: { localize: (key) => key }, settings: { get: () => "Fighting" } };
    actor = { uuid: "Actor.pc", items: [], system: {} };
    item = { type: "weapon", system: { isMelee: true, isRanged: false, actions: { trait: "Fighting" } } };
    target = { id: "foe", name: "Defender", document: { uuid: "Scene.test.Token.foe" }, actor: { system: { stats: { parry: { value: 8 }, globalMods: {} } } } };
    forecast = { actor, item, formula: "{1d8x,1dw6}kh", trait: true };
    game.user.targets.add(target);
  });
  it("uses prepared Parry for melee, including shield/effect contributions", async () => {
    const [result] = await targetedForecasts(forecast);
    assert.equal(result.target, 8); assert.equal(result.defense, "Parry"); assert.equal(result.formula, forecast.formula);
    const odds = rollStatistics(result.formula, { trait: true, target: result.target });
    assert.ok(odds.outcomes[2] < rollStatistics(forecast.formula, { trait: true, target: 4 }).outcomes[2]);
  });
  it("uses TN4 with prepared general/ranged defenses and excludes melee effects", async () => {
    item.system.isMelee = false; item.system.isRanged = true;
    target.actor.system.stats.globalMods = { targetAttack: [{ label: "Deflection", value: -2 }], targetAttackRanged: [{ label: "Dodge", value: -2 }], targetAttackMelee: [{ label: "Melee", value: -4 }] };
    const [result] = await targetedForecasts(forecast);
    assert.equal(result.target, 8); assert.match(result.defenseDetails, /Deflection −?\-?2/); assert.doesNotMatch(result.defenseDetails, /Melee/);
  });
  it("does not apply a prepared native penalty twice and keeps ignored modifiers off", async () => {
    const mod = { label: "Ward", value: -2 };
    target.actor.system.stats.globalMods.targetAttack = [mod];
    const app = { ctx: { actor, item, mods: [mod], roll: {} } };
    const snapshot = nativeAttackSnapshot(app);
    const [result] = await targetedForecasts({ ...forecast, formula: forecast.formula + "-2" }, snapshot);
    assert.equal(result.target, 10); assert.ok(result.formula.endsWith("+(2)"));
    mod.ignore = true;
    const [ignored] = await targetedForecasts(forecast, snapshot);
    assert.equal(ignored.target, 8); assert.equal(ignored.formula, forecast.formula);
  });
  it("updates for a different defender while removing the old formula's penalty", async () => {
    const mod = { label: "Old ward", value: -2 };
    target.actor.system.stats.globalMods.targetAttack = [mod];
    const snapshot = nativeAttackSnapshot({ ctx: { actor, item, mods: [mod], roll: {} } });
    const other = { ...target, id: "other", actor: { system: { stats: { parry: { value: 5 }, globalMods: { targetAttack: [{ label: "New ward", value: -1 }] } } } } };
    const [result] = await targetedForecasts({ ...forecast, formula: forecast.formula + "-2" }, snapshot, [other]);
    assert.equal(result.target, 6); assert.ok(result.formula.endsWith("+(2)"));
  });
  it("combines Tools named-edge defenses, counting equivalent native edges once", async () => {
    game.modules.set("swade-tools", { active: true });
    item.system.isMelee = false; item.system.isRanged = true;
    target.actor.system.stats.globalMods.targetAttackRanged = [{ label: "Dodge", value: -2 }];
    const [result] = await targetedForecasts(forecast, null, [target], async () => [{ label: "Dodge", value: -2 }, { label: "Combat Acrobat", value: -1 }]);
    assert.equal(result.target, 7);
  });
  it("counts Vulnerable once with native signed-string modifiers and in Tools previews", async () => {
    item.system.isMelee = false; item.system.isRanged = true;
    target.actor.statuses = new Set(["vulnerable"]);
    const mod = { label: "SWADE.TargetVulnerable", value: "+2" };
    const snapshot = nativeAttackSnapshot({ ctx: { actor, item, mods: [mod], roll: {} } });
    const [native] = await targetedForecasts({ ...forecast, formula: forecast.formula + "+2" }, snapshot);
    assert.equal(native.target, 2); assert.ok(native.formula.endsWith("+(-2)"));
    assert.equal((await targetedForecasts(forecast))[0].target, 2);
  });
  it("uses Better Effects conditional rules and removes their native pre-roll contribution once", async () => {
    const own = { label: "Favored enemy", value: 1 }, defense = { label: "Conditional ward", value: -2 };
    const api = { normalizeFlags: (flags) => [...new Set(flags.filter(Boolean))], getFlags: (doc) => doc?.tags ?? [], collectRules: () => [],
      traitAdjustment: (context, _target, options) => {
        assert.ok(context.roll.includes("attack"));
        return { applied: options?.includeDefender === false ? [own] : [own, defense], value: options?.includeDefender === false ? 1 : -1 };
      } };
    game.modules.set("swade-better-effects", { active: true, api });
    const snapshot = nativeAttackSnapshot({ ctx: { actor, item, mods: [own, defense], roll: { options: { "swade-better-effects": { roll: ["attack", "melee"] } } } } });
    const [result] = await targetedForecasts({ ...forecast, formula: forecast.formula + "+1-2" }, snapshot);
    assert.equal(result.target, 10); assert.ok(result.formula.endsWith("+(2)"));
    const tools = (await targetedForecasts(forecast, null))[0];
    assert.equal(tools.target, 10); assert.ok(tools.formula.endsWith("+(1)"));
  });
  it("keeps ordinary skill/cast previews unchanged and never discloses hidden targets", async () => {
    assert.deepEqual(await targetedForecasts({ ...forecast, item: null }), [{ ...forecast, item: null }]);
    target.document.hidden = true; game.user.isGM = false;
    assert.deepEqual(await targetedForecasts(forecast), [forecast]);
    game.user.targets.clear(); assert.deepEqual(await targetedForecasts(forecast), [forecast]);
    assert.equal(attackKind({ type: "power", system: { damage: "2d6", templates: { cone: true } } }), null);
  });
  it("provides independent estimates for each selected defender", async () => {
    const other = { ...target, id: "second", document: { uuid: "Token.second" }, actor: { system: { stats: { parry: { value: 4 } } } } };
    const results = await targetedForecasts(forecast, null, [target, other]);
    assert.deepEqual(results.map((result) => result.target), [8, 4]); assert.notEqual(results[0].targetKey, results[1].targetKey);
  });
  it("conceals enemy defense details from players while preserving the real odds", async () => {
    target.actor.system.stats.globalMods.targetAttack = [{ label: "Secret ward", value: -2 }];
    const [gm] = await targetedForecasts(forecast);
    assert.equal(gm.revealDefense, true); assert.match(gm.defenseDetails, /Secret ward/);
    game.user.isGM = false;
    const [player] = await targetedForecasts(forecast);
    assert.equal(player.revealDefense, false); assert.equal(player.defense, undefined); assert.equal(player.defenseDetails, undefined);
    assert.equal(player.target, gm.target); assert.equal(player.formula, gm.formula);
    assert.deepEqual(rollStatistics(player.formula, { trait: true, target: player.target }).outcomes,
      rollStatistics(gm.formula, { trait: true, target: gm.target }).outcomes);
    target.actor.isOwner = true;
    assert.equal((await targetedForecasts(forecast))[0].revealDefense, true);
  });
  it("resolves installed Better Effects predicates against ranged and melee flags", { skip: !installedRules }, async () => {
    const rule = { selector: "target-roll:targetAttackRanged", label: "Conditional Dodge", value: -2, type: "add",
      predicate: { op: "flag", source: "actor", flag: "dodge" }, ownerFlags: ["dodge"] };
    const api = { normalizeFlags: installedRules.normalizeFlags, getFlags: (doc) => doc?.tags ?? [], collectRules: () => [],
      traitAdjustment: (context, token, options) => installedRules.resolveTrait({ context: { ...context, target: token.actor.tags ?? [] },
        attackerRules: context.attackerRules, defenderRules: options?.includeDefender === false ? [] : [rule] }) };
    game.modules.set("swade-better-effects", { active: true, api });
    item.system.isMelee = false; item.system.isRanged = true;
    assert.equal((await targetedForecasts(forecast))[0].target, 6);
    item.system.isMelee = true; item.system.isRanged = false;
    assert.equal((await targetedForecasts(forecast))[0].target, 8);
    rule.ownerFlags = []; item.system.isMelee = false; item.system.isRanged = true;
    assert.equal((await targetedForecasts(forecast))[0].target, 4);
  });
  it("floors displayed estimates, including negative numbers and exact integer means", () => {
    assert.equal(formatRollNumber(3.9), "3"); assert.equal(formatRollNumber(-3.1), "-4");
    assert.equal(formatRollNumber(rollStatistics("2d6").average), "7"); assert.equal(formatRollNumber(Infinity), "∞");
  });
});
