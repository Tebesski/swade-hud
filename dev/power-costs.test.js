import test from "node:test";
import assert from "node:assert/strict";
import {powerCostPresentation, powerPoolUsesNoPP} from "../scripts/powers.js";
test("power costs reflect per-entry No PP, world rules, and explicit overrides", () => {
  let world = false;
  let active = true;
  globalThis.game = {settings: {get: () => world}, modules: {get: () => ({active})}};
  const actor = {getFlag: () => ({science: {arcane: "Science", noPowerPoints: true}, faith: {arcane: "Faith", noPowerPoints: false}})};
  const power = arcane => ({type: "power", actor, system: {arcane, pp: 3}});
  assert.equal(powerCostPresentation(power("Science")).text, "-2");
  assert.equal(powerCostPresentation(power("Faith")).text, "3 PP");
  world = true;
  assert.equal(powerPoolUsesNoPP(actor, "general"), true);
  assert.equal(powerCostPresentation(power("Faith")).text, "3 PP");
  active = false;
  assert.equal(powerCostPresentation(power("Faith")).text, "-2");
  assert.equal(powerCostPresentation({...power("Faith"), system: {pp: 2}}).text, "-1");
});
