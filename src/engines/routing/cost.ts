import { conflicts, parallelConflicts, type Line } from './conflicts.ts';
import { distance, EPS, lengthOf } from './geometry.ts';
import type { NearBox, Point, RoutingSettings } from './types.ts';

// Soft clearance: a run parallel to a box side inside `band` costs more the closer
// it gets. Group borders (`border`) count from both sides. The hard clearance
// still decides what is passable, so tight gaps stay routable.
export const STANDOFF_WEIGHT = 0.5,
  // A line along a group border reads as part of the frame: worse than one beside a box.
  BORDER_WEIGHT = 2;
// Per `near` list, per grid line: the boxes whose band reaches that line, in their order. Only they
// can add to a run along it, so the sum keeps its terms and their order.
const bandsByLine = new WeakMap<NearBox[], [Map<number, NearBox[]>, Map<number, NearBox[]>]>();
// With a finite `bound`, stops once the cost passes it: the caller needs only to know that.
export function standoffCost(ps: Point[], near: NearBox[], bound = Infinity) {
  let lines = bandsByLine.get(near);
  if (!lines && near.length > 4) {
    lines = [new Map(), new Map()];
    bandsByLine.set(near, lines);
  }
  let n = 0;
  for (let i = 1; i < ps.length; i++) {
    const a = ps[i - 1],
      b = ps[i];
    const h = Math.abs(a.y - b.y) < EPS;
    if (!h && Math.abs(a.x - b.x) >= EPS) continue;
    const lo = h ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
      hi = h ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      at = h ? a.y : a.x;
    let close = near;
    if (lines) {
      const axis = lines[h ? 0 : 1];
      let hit = axis.get(at);
      if (!hit) {
        hit = near.filter(r =>
          h
            ? at >= r.y - r.band && at <= r.y + r.h + r.band
            : at >= r.x - r.band && at <= r.x + r.w + r.band,
        );
        axis.set(at, hit);
      }
      close = hit;
    }
    for (const r of close) {
      const run = Math.min(hi, h ? r.x + r.w : r.y + r.h) - Math.max(lo, h ? r.x : r.y);
      if (run <= 1) continue;
      const s0 = h ? r.y : r.x,
        s1 = h ? r.y + r.h : r.x + r.w;
      let d;
      if (r.border) d = Math.min(Math.abs(at - s0), Math.abs(at - s1));
      else if (at <= s0) d = s0 - at;
      else if (at >= s1) d = at - s1;
      // Inside a box (only an edge's own end lets it in): as close as it gets.
      else d = 0;
      if (d < r.band) n += run * (1 - d / r.band) * (r.weight ?? 1);
    }
    if (n * STANDOFF_WEIGHT > bound) return n * STANDOFF_WEIGHT;
  }
  return n * STANDOFF_WEIGHT;
}
// `standoffCost` of the one segment a→b, without building its segment list.
export function standoffSegment(a: Point, b: Point, near: NearBox[]) {
  let n = 0;
  const h = Math.abs(a.y - b.y) < EPS;
  if (!h && Math.abs(a.x - b.x) >= EPS) return 0;
  const lo = h ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
    hi = h ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
    at = h ? a.y : a.x;
  for (const r of near) {
    const run = Math.min(hi, h ? r.x + r.w : r.y + r.h) - Math.max(lo, h ? r.x : r.y);
    if (run <= 1) continue;
    const s0 = h ? r.y : r.x,
      s1 = h ? r.y + r.h : r.x + r.w;
    let d;
    if (r.border) d = Math.min(Math.abs(at - s0), Math.abs(at - s1));
    else if (at <= s0) d = s0 - at;
    else if (at >= s1) d = at - s1;
    else d = 0;
    if (d < r.band) n += run * (1 - d / r.band) * (r.weight ?? 1);
  }
  return n * STANDOFF_WEIGHT;
}
/** Adds the grid lines a standoff band out from each box to `xs` and `ys`. */
export function standoffLines(near: NearBox[], xs: number[], ys: number[]) {
  for (const r of near) {
    const add = r.border ? [-r.band, r.band] : [-r.band];
    for (const k of add) {
      xs.push(r.x + k, r.x + r.w - k);
      ys.push(r.y + k, r.y + r.h - k);
    }
  }
}
// The part of `cost` that does not depend on other lines or boxes: length, bends and jogs. The
// rest of `cost` is never negative, so this is a lower bound on it.
export function ownCost(ps: Point[], s: RoutingSettings) {
  return lengthOf(ps) + Math.max(0, ps.length - 2) * s.bendPenalty + jogsOf(ps);
}
// What short inner segments cost: a jog under 8 units between two bends reads as a mistake.
function jogsOf(ps: Point[]) {
  let sum = 0;
  for (let i = 2; i < ps.length - 1; i++) sum += Math.max(0, 8 - distance(ps[i - 1], ps[i])) * 4;
  return sum;
}
export function cost(ps: Point[], used: Line[], s: RoutingSettings, near: NearBox[] = []) {
  return costOf(
    ps,
    s,
    near.length ? standoffCost(ps, near) : 0,
    conflicts(ps, used),
    parallelConflicts(ps, used, s.edgeGap).laneDeficit,
  );
}
// `cost` from its parts: the standoff, the conflicts and the lane deficit against the other lines.
export function costOf(
  ps: Point[],
  s: RoutingSettings,
  standoff: number,
  c: { crossings: number; shared: number },
  laneDeficit: number,
) {
  return (
    standoff +
    lengthOf(ps) +
    Math.max(0, ps.length - 2) * s.bendPenalty +
    c.crossings * s.crossingPenalty +
    c.shared * s.sharedPenalty +
    laneDeficit * s.parallelPenalty +
    jogsOf(ps)
  );
}
