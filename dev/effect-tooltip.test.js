import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { EffectPanels, effectListTooltipPosition } from "../scripts/effects.js";

describe("Effects list tooltip placement", () => {
  const panel = { left: 100, right: 700 }, row = { top: 200, height: 40 }, tooltip = { width: 200, height: 100 };
  it("anchors each column's tooltip to that section's right edge and the row's center", () => {
    assert.deepEqual(effectListTooltipPosition({ left: 100, right: 400 }, { ...row, left: 110, right: 390 }, tooltip, 1280, 720), { left: 408, top: 170 });
    assert.deepEqual(effectListTooltipPosition({ left: 404, right: 704 }, { ...row, left: 410, right: 694 }, tooltip, 1280, 720), { left: 712, top: 170 });
  });
  it("centers using the actual wrapped row and tooltip heights", () => {
    assert.deepEqual(effectListTooltipPosition(panel, { top: 240, height: 80 }, { width: 250, height: 200 }, 1280, 720), { left: 708, top: 180 });
  });
  it("falls back to the left of the panel when the right side has no space", () => {
    assert.deepEqual(effectListTooltipPosition({ left: 650, right: 1250 }, row, tooltip, 1280, 720), { left: 442, top: 170 });
  });
  it("keeps long descriptions inside the top and bottom viewport edges", () => {
    assert.equal(effectListTooltipPosition(panel, { top: 2, height: 20 }, tooltip, 1280, 720).top, 5);
    assert.equal(effectListTooltipPosition(panel, { top: 680, height: 40 }, tooltip, 1280, 720).top, 615);
  });
});

describe("Effects list hover delay", () => {
  let panels, actor, row, panel, shown;
  beforeEach(() => {
    shown = [];
    actor = { isOwner: true, allApplicableEffects: () => [{ uuid: "Effect.test", id: "test", name: "Test", type: "base" }] };
    row = { isConnected: true, dataset: { effectUuid: "Effect.test" } };
    panel = { isConnected: true };
    panels = new EffectPanels((error) => { throw error; });
    panels.showTooltip = async (...args) => shown.push(args);
  });
  it("waits 400ms before showing the effect description", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    panels.scheduleListTooltip(actor, row, panel);
    context.mock.timers.tick(399); assert.equal(shown.length, 0);
    context.mock.timers.tick(1); assert.equal(shown.length, 1);
    assert.equal(shown[0][2], row); assert.equal(shown[0][3], "list"); assert.equal(shown[0][4], panel);
  });
  it("cancels a hover that ends before the delay", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    panels.scheduleListTooltip(actor, row, panel); context.mock.timers.tick(200);
    panels.leaveListTooltip(row); context.mock.timers.tick(400); assert.equal(shown.length, 0);
  });
  it("restarts the delay for a different effect row", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const other = { ...row };
    panels.scheduleListTooltip(actor, row, panel); context.mock.timers.tick(300);
    panels.scheduleListTooltip(actor, other, panel); context.mock.timers.tick(399); assert.equal(shown.length, 0);
    context.mock.timers.tick(1); assert.equal(shown.length, 1); assert.equal(shown[0][2], other);
  });
  it("cancels pending tooltips when the panel closes", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    panels.scheduleListTooltip(actor, row, panel); panels.hideListTooltip();
    context.mock.timers.tick(400); assert.equal(shown.length, 0);
  });
  for (const change of [() => { actor.isOwner = false; }, () => { row.isConnected = false; }, () => { panel.isConnected = false; }])
    it("does not display descriptions after ownership or the hovered DOM changes", (context) => {
      context.mock.timers.enable({ apis: ["setTimeout"] });
      panels.scheduleListTooltip(actor, row, panel); change(); context.mock.timers.tick(400); assert.equal(shown.length, 0);
    });
  it("discards an inactive system description that finishes loading after hover-out", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let release;
    const loaded = new Promise((resolve) => { release = resolve; });
    globalThis.CONFIG = { statusEffects: { prone: { id: "prone", name: "Prone" } }, ActiveEffect: { documentClass: { fromStatusEffect: () => loaded } } };
    row.dataset = { status: "prone" };
    panels.scheduleListTooltip(actor, row, panel); context.mock.timers.tick(400);
    panels.leaveListTooltip(row); release({ name: "Prone" });
    await new Promise(setImmediate); assert.equal(shown.length, 0);
  });
});
