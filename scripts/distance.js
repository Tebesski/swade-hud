function bounds(token, grid) {
  const width = token.w ?? (token.document?.width ?? 1) * (grid.sizeX ?? grid.size ?? 0);
  const height = token.h ?? (token.document?.height ?? 1) * (grid.sizeY ?? grid.size ?? 0);
  return { x: token.x ?? token.center.x - width / 2, y: token.y ?? token.center.y - height / 2, width, height };
}
export function tokensAdjacent(source, target, grid = {}) {
  const a = bounds(source, grid), b = bounds(target, grid);
  const gapX = Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0);
  const gapY = Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0);
  if (grid.isGridless) return gapX < 0.01 && gapY < 0.01;
  const sizeX = grid.sizeX ?? grid.size, sizeY = grid.sizeY ?? grid.size;
  if (!(sizeX > 0 && sizeY > 0) || gapX > sizeX || gapY > sizeY) return false;
  const occupied = (token, rect) => {
    const native = token.document?.getOccupiedGridSpaceOffsets?.({ x: rect.x, y: rect.y });
    if (native?.length) return native;
    const [i0, j0, i1, j1] = grid.getOffsetRange?.(rect) ?? [Math.floor(rect.y / sizeY), Math.floor(rect.x / sizeX), Math.ceil((rect.y + rect.height) / sizeY), Math.ceil((rect.x + rect.width) / sizeX)];
    const cells = [];
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) cells.push({ i, j });
    return cells;
  };
  const cells = new Set(occupied(target, b).map(({ i, j }) => i + "," + j));
  return occupied(source, a).some((cell) => {
    if (cells.has(cell.i + "," + cell.j)) return true;
    const neighbors = grid.getAdjacentOffsets?.(cell) ?? [-1, 0, 1].flatMap((di) => [-1, 0, 1].map((dj) => ({ i: cell.i + di, j: cell.j + dj })))
      .filter((other) => !grid.testAdjacency || grid.testAdjacency(cell, other));
    return neighbors.some(({ i, j }) => cells.has(i + "," + j));
  });
}
export function tokenDistance(source, target, canvas) {
  if (!source?.actor?.isOwner || !target || source === target || !canvas?.ready) return null;
  if (source.destroyed || target.destroyed) return null;
  if (target.visible === false || target.isVisible === false || (target.document?.hidden && !game.user.isGM)) return null;
  if (source.visible === false || source.isVisible === false) return null;
  const start = source.center, end = target.center;
  if (![start?.x, start?.y, end?.x, end?.y].every(Number.isFinite) || tokensAdjacent(source, target, canvas.grid)) return null;
  const measured = canvas.grid?.measurePath?.([start, end]);
  if (!Number.isFinite(measured?.distance)) return null;
  return { start, end, distance: measured.distance, units: canvas.scene?.grid?.units ?? "" };
}
function intersection(start, end, rect) {
  let lo = 0, hi = 1;
  for (const [origin, delta, min, max] of [[start.x, end.x - start.x, rect.x, rect.x + rect.width], [start.y, end.y - start.y, rect.y, rect.y + rect.height]]) {
    if (!delta) { if (origin < min || origin > max) return null; continue; }
    const a = (min - origin) / delta, b = (max - origin) / delta;
    lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    if (lo > hi) return null;
  }
  return [lo, hi];
}
// Hide the line only under the opaque art of its two endpoints. Other tokens
// remain below this overlay. Foundry's mesh hit test respects texture alpha,
// token rotation and texture scaling without moving or duplicating any token.
export function visibleDistanceSegments(start, end, endpoints, grid, zoom = 1) {
  const hidden = [], length = Math.hypot(end.x - start.x, end.y - start.y);
  for (const token of endpoints) {
    const mesh = token.mesh, rect = mesh?.canvasBounds ?? bounds(token, grid);
    const range = intersection(start, end, rect);
    if (!range) continue;
    if (!mesh?.containsCanvasPoint) { hidden.push(range); continue; }
    const at = (t) => mesh.containsCanvasPoint({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }, 0.1);
    const steps = Math.max(1, Math.min(2048, Math.ceil((range[1] - range[0]) * length * zoom * 2)));
    let previous = range[0], opaque = at(previous), begin = opaque ? previous : null;
    for (let i = 1; i <= steps; i++) {
      const t = range[0] + (range[1] - range[0]) * i / steps, next = at(t);
      if (next !== opaque) {
        let lo = previous, hi = t;
        for (let n = 0; n < 8; n++) { const mid = (lo + hi) / 2; if (at(mid) === opaque) lo = mid; else hi = mid; }
        const edge = (lo + hi) / 2;
        if (next) begin = edge; else { hidden.push([begin, edge]); begin = null; }
      }
      previous = t; opaque = next;
    }
    if (begin !== null) hidden.push([begin, range[1]]);
  }
  hidden.sort((a, b) => a[0] - b[0]);
  const visible = []; let cursor = 0;
  for (const [lo, hi] of hidden) { if (lo > cursor) visible.push([cursor, lo]); cursor = Math.max(cursor, hi); }
  if (cursor < 1) visible.push([cursor, 1]);
  return visible;
}

export class DistanceOverlay {
  target = null;
  container = null;
  ticker = null;
  ready = false;
  constructor(source, enabled) { this.source = source; this.enabled = enabled; this.tick = this.refresh.bind(this); }
  hover(token, hovered) {
    if (hovered && this.target === token) return;
    if (!hovered && this.target !== token) return;
    clearTimeout(this.delay);
    this.clear(); this.ready = false;
    this.target = hovered ? token : null;
    if (hovered) this.delay = setTimeout(() => { this.ready = true; this.refresh(); }, 300);
  }
  watch(ticker) {
    if (this.ticker === ticker) return;
    this.ticker?.remove(this.tick); this.ticker = ticker;
    this.ticker?.add(this.tick);
  }
  refresh() {
    const canvas = globalThis.canvas, source = this.source();
    const active = this.enabled() && this.ready && this.target && source?.actor?.isOwner && canvas?.ready && !this.target.destroyed;
    this.watch(active ? canvas.app?.ticker : null);
    const info = active ? tokenDistance(source, this.target, canvas) : null;
    if (!info || !globalThis.PIXI || !canvas.stage) { this.clear(true); return; }
    if (!this.container) {
      this.container = new PIXI.Container(); this.container.eventMode = "none";
      this.line = this.container.addChild(new PIXI.Graphics());
      this.background = this.container.addChild(new PIXI.Graphics());
      const style = { fontFamily: "Signika, sans-serif", fontSize: 14, fill: 0xf0eee6, fontWeight: "bold" };
      this.label = this.container.addChild(Number(PIXI.VERSION?.split(".")[0]) >= 8 ? new PIXI.Text({ text: "", style }) : new PIXI.Text("", style));
      this.label.anchor.set(0.5); canvas.stage.addChild(this.container);
    }
    const scale = Math.max(0.01, canvas.stage.scale?.x ?? 1);
    const key = [info.start.x, info.start.y, info.end.x, info.end.y, scale, ...[source, this.target].flatMap((token) => {
      const mesh = token.mesh, rect = mesh?.canvasBounds ?? bounds(token, canvas.grid), transform = mesh?.canvasTransform;
      return [rect.x, rect.y, rect.width, rect.height, transform?.a, transform?.b, transform?.c, transform?.d, transform?.tx, transform?.ty, mesh?.texture?._updateID];
    })].join(",");
    if (key !== this.geometryKey) {
      this.geometryKey = key;
      this.segments = visibleDistanceSegments(info.start, info.end, [source, this.target], canvas.grid, scale);
      this.line.clear();
      for (const [width, color, alpha] of [[3.5, 0x111111, 0.4], [2, 0xb0c849, 0.75]]) for (const [start, end] of this.segments) {
        const steps = 16;
        for (let i = 0; i < steps; i++) {
          const a = start + (end - start) * i / steps, b = start + (end - start) * (i + 1) / steps;
          const opacity = alpha * (0.65 + 0.35 * Math.abs(a + b - 1));
          const x1 = info.start.x + (info.end.x - info.start.x) * a, y1 = info.start.y + (info.end.y - info.start.y) * a;
          const x2 = info.start.x + (info.end.x - info.start.x) * b, y2 = info.start.y + (info.end.y - info.start.y) * b;
          if (this.line.stroke) this.line.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: width / scale, color, alpha: opacity });
          else this.line.lineStyle(width / scale, color, opacity).moveTo(x1, y1).lineTo(x2, y2);
        }
      }
    }
    this.label.text = Number(info.distance.toFixed(1)) + (info.units ? " " + info.units : "");
    this.label.scale.set(1 / scale);
    const x = info.end.x, y = (this.target.y ?? info.end.y) - 15 / scale;
    this.label.position.set(x, y);
    const width = this.label.width + 16 / scale, height = this.label.height + 8 / scale;
    this.background.clear();
    if (this.background.roundRect) this.background.roundRect(x - width / 2, y - height / 2, width, height, 4 / scale).fill({ color: 0x171717, alpha: 0.9 });
    else this.background.beginFill(0x171717, 0.9).drawRoundedRect(x - width / 2, y - height / 2, width, height, 4 / scale).endFill();
  }
  clear(keepTicker = false) {
    if (!keepTicker) this.watch(null);
    this.container?.destroy({ children: true }); this.container = null; this.geometryKey = null;
  }
  reset() { clearTimeout(this.delay); this.ready = false; this.target = null; this.clear(); }
}
