import assert from "node:assert/strict";
import { beforeEach, it, describe } from "node:test";
import { tokenDistance, tokensAdjacent, visibleDistanceSegments, DistanceOverlay } from "../scripts/distance.js";
describe("token distance",()=>{
  let source,target,canvas;
  beforeEach(()=>{
    globalThis.game={user:{isGM:false}};
    source={actor:{isOwner:true},center:{x:50,y:50},visible:true};
    target={center:{x:350,y:450},visible:true,document:{hidden:false}};
    canvas={ready:true,scene:{grid:{units:"ft."}},grid:{measurePath:(path)=>{assert.deepEqual(path,[source.center,target.center]);return{distance:30};}}};
  });
  it("uses the scene grid's center-to-center distance and units",()=>assert.deepEqual(tokenDistance(source,target,canvas),{start:source.center,end:target.center,distance:30,units:"ft."}));
  it("never draws from unowned tokens or to self",()=>{source.actor.isOwner=false;assert.equal(tokenDistance(source,target,canvas),null);source.actor.isOwner=true;assert.equal(tokenDistance(source,source,canvas),null);});
  it("does not disclose invisible or hidden targets",()=>{target.document.hidden=true;assert.equal(tokenDistance(source,target,canvas),null);game.user.isGM=true;assert.ok(tokenDistance(source,target,canvas));target.isVisible=false;assert.equal(tokenDistance(source,target,canvas),null);});
  it("handles torn-down canvases and invalid grid results",()=>{canvas.ready=false;assert.equal(tokenDistance(source,target,canvas),null);canvas.ready=true;canvas.grid.measurePath=()=>({distance:NaN});assert.equal(tokenDistance(source,target,canvas),null);});
});
describe("distance geometry and hover lifecycle", () => {
  const grid = { size: 100 };
  const token = (x, y, w = 100, h = w) => ({ x, y, w, h, center: { x: x + w / 2, y: y + h / 2 }, document: {} });
  it("hides adjacent, diagonal and overlapping footprints while preserving a full empty-cell gap", () => {
    assert.equal(tokensAdjacent(token(0, 0), token(100, 0), grid), true);
    assert.equal(tokensAdjacent(token(0, 0), token(100, 100), grid), true);
    assert.equal(tokensAdjacent(token(0, 0), token(0, 0), grid), true);
    assert.equal(tokensAdjacent(token(0, 0), token(200, 0), grid), false);
    assert.equal(tokensAdjacent(token(0, 0, 200), token(200, 0), grid), true);
    assert.equal(tokensAdjacent(token(0, 0, 200), token(300, 0), grid), false);
    assert.equal(tokensAdjacent(token(25, 25, 50), token(110, 10, 80), grid), true);
  });
  it("respects native square diagonal rules and hex adjacency", () => {
    assert.equal(tokensAdjacent(token(0, 0), token(100, 100), { ...grid, testAdjacency: (a, b) => Math.abs(a.i - b.i) + Math.abs(a.j - b.j) === 1 }), false);
    const a = token(0, 0), b = token(100, 0);
    a.document.getOccupiedGridSpaceOffsets = () => [{ i: 1, j: 1 }];
    b.document.getOccupiedGridSpaceOffsets = () => [{ i: 2, j: 1 }];
    assert.equal(tokensAdjacent(a, b, { ...grid, getAdjacentOffsets: () => [{ i: 2, j: 1 }] }), true);
    assert.equal(tokensAdjacent(a, b, { ...grid, getAdjacentOffsets: () => [{ i: 3, j: 1 }] }), false);
  });
  it("uses touching footprints on gridless scenes", () => {
    assert.equal(tokensAdjacent(token(0, 0), token(100, 0), { isGridless: true }), true);
    assert.equal(tokensAdjacent(token(0, 0), token(101, 0), { isGridless: true }), false);
  });
  it("clips only the two endpoint footprints, leaving intervening tokens beneath the line", () => {
    const a = token(0, 0), b = token(400, 0);
    const segments = visibleDistanceSegments(a.center, b.center, [a, b], grid);
    assert.deepEqual(segments, [[0.125, 0.875]]);
    assert.ok(segments[0][0] < 0.5 && segments[0][1] > 0.5);
  });
  it("uses actual mesh alpha at endpoints, including transparent cutouts and enlarged/rotated art", () => {
    const a = token(0, 0), b = token(400, 0);
    a.mesh = { canvasBounds: { x: -20, y: -20, width: 200, height: 200 }, containsCanvasPoint: ({ x }, alpha) => { assert.equal(alpha, 0.1); return x < 70 || x > 100 && x < 130; } };
    const segments = visibleDistanceSegments(a.center, b.center, [a, b], grid, 2);
    assert.equal(segments.length, 2);
    for (const [actual, expected] of [[segments[0][0], 0.05], [segments[0][1], 0.125], [segments[1][0], 0.2], [segments[1][1], 0.875]]) assert.ok(Math.abs(actual - expected) < 0.00001);
  });
  it("waits 0.3 seconds, cancels hover-out, and restarts the delay for a different token", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const overlay = new DistanceOverlay(() => null, () => true);
    let renders = 0; overlay.refresh = () => { renders++; };
    const a = token(0, 0), b = token(400, 0);
    overlay.hover(a, true); context.mock.timers.tick(299); assert.equal(renders, 0);
    context.mock.timers.tick(1); assert.equal(renders, 1); assert.equal(overlay.ready, true);
    overlay.hover(b, true); context.mock.timers.tick(100); overlay.hover(b, false); context.mock.timers.tick(300); assert.equal(renders, 1);
    overlay.hover(a, true); context.mock.timers.tick(200); overlay.hover(b, true); context.mock.timers.tick(299); assert.equal(renders, 1);
    context.mock.timers.tick(1); assert.equal(renders, 2);
    overlay.hover(a, true); overlay.reset(); context.mock.timers.tick(300); assert.equal(renders, 2);
  });
});
