import { spanOf } from './conflicts.ts';
import { standoffLines, standoffSegment } from './cost.ts';
import {
  atMost,
  below,
  blocked,
  compress,
  distance,
  EPS,
  round,
  same,
  segments,
} from './geometry.ts';
import { Heap } from './heap.ts';
import type { NearBox, Obstacle, Point, Route, RoutingSettings } from './types.ts';

const FAR = 100000;
/** Search window margins round the two boxes, tried in turn; null is the whole grid. */
export const WINDOWS = [80, null];
/** A search window: only grid lines inside it are used. */
export interface Window {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** A route segment as the search costs it: its ends, direction, box, and its route's ends. */
interface Track {
  a: Point;
  b: Point;
  h: boolean;
  id: string;
  first: Point;
  last: Point;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
/** What can block or cost a grid edge on one grid line. */
interface GridLine {
  obs: Obstacle[];
  near: NearBox[];
  parallel: Track[];
  crossings: number[];
}
/**
 * A* over the grid of lines through the ends, the obstacles' sides, the standoff bands and a lane
 * beside every routed line. Returns the cheapest path from `start` to `end`, or null when none
 * is found within `limit` visits.
 */
export function search(
  start: Point,
  end: Point,
  obs: Obstacle[],
  used: Route[],
  s: RoutingSettings,
  near: NearBox[] = [],
  limit = 16000,
  win: Window | null = null,
) {
  const xs = [start.x, end.x],
    ys = [start.y, end.y];
  // A wall's far side (`obsFor`) lies millions of units out: a line there would let a search
  // escape round the walls instead of failing.
  for (const r of obs)
    for (const [list, v] of [
      [xs, r.x],
      [xs, r.x + r.w],
      [ys, r.y],
      [ys, r.y + r.h],
    ] as Array<[number[], number]>)
      if (Math.abs(v) < FAR) list.push(v);
  standoffLines(near, xs, ys);
  for (const p of [start, end]) {
    xs.push(p.x - s.edgeGap, p.x + s.edgeGap);
    ys.push(p.y - s.edgeGap, p.y + s.edgeGap);
  }
  // Extra lanes beside existing paths allow rerouting without bundling them.
  for (const r of used)
    for (const p of r.points) {
      xs.push(p.x - s.edgeGap, p.x + s.edgeGap);
      ys.push(p.y - s.edgeGap, p.y + s.edgeGap);
    }
  xs.push(Math.min(...xs) - 32, Math.max(...xs) + 32);
  ys.push(Math.min(...ys) - 32, Math.max(...ys) + 32);
  // A window keeps only the grid lines inside it, with its own edges as the outermost lanes.
  const inX = (v: number) => !win || (v >= win.x0 && v <= win.x1),
    inY = (v: number) => !win || (v >= win.y0 && v <= win.y1);
  if (win) {
    xs.push(win.x0, win.x1);
    ys.push(win.y0, win.y1);
  }
  const X = [...new Set(xs.filter(inX).map(round))].sort((a, b) => a - b),
    Y = [...new Set(ys.filter(inY).map(round))].sort((a, b) => a - b),
    nx = X.length,
    ny = Y.length;
  const startCell = Y.indexOf(round(start.y)) * nx + X.indexOf(round(start.x)),
    endCell = Y.indexOf(round(end.y)) * nx + X.indexOf(round(end.x));
  const heap = new Heap(),
    // Per grid state (cell * 2 + axis): best cost so far and the state it came from. Per grid
    // edge (lower cell * 2 + axis): its cost, NaN until computed.
    scores = new Float64Array(nx * ny * 2).fill(Infinity),
    prev = new Int32Array(nx * ny * 2).fill(-1),
    cache = new Float64Array(nx * ny * 2).fill(NaN);
  // A segment farther than this from a grid edge can neither cross, share nor run parallel
  // within the edge gap, so its cost terms are zero; skipping it changes no result.
  const reach = Math.max(s.edgeGap, EPS) + 1;
  // Every grid edge lies inside the grid's box. An obstacle, standoff box or route segment that
  // cannot reach that box can neither block nor cost an edge, so each list keeps only those that
  // can, in their original order (so sums add up identically).
  const gx0 = X[0],
    gx1 = X[nx - 1],
    gy0 = Y[0],
    gy1 = Y[ny - 1],
    obsIn = obs.filter(r => r.x < gx1 && r.x + r.w > gx0 && r.y < gy1 && r.y + r.h > gy0),
    nearIn = near.filter(
      r =>
        r.x - r.band < gx1 &&
        r.x + r.w + r.band > gx0 &&
        r.y - r.band < gy1 &&
        r.y + r.h + r.band > gy0,
    );
  // Compile route geometry once per search; avoid allocating paths and segment
  // arrays for every grid edge visited by A*. Touching terminals are excluded.
  const existing: Track[] = [];
  for (const r of used) {
    const box = spanOf(r.points);
    if (
      box.x1 < gx0 - reach ||
      box.x0 > gx1 + reach ||
      box.y1 < gy0 - reach ||
      box.y0 > gy1 + reach
    )
      continue;
    for (const [a, b] of segments(r.points))
      existing.push({
        a,
        b,
        h: Math.abs(a.y - b.y) < EPS,
        id: r.id,
        first: r.points[0],
        last: r.points.at(-1)!,
        x0: Math.min(a.x, b.x),
        x1: Math.max(a.x, b.x),
        y0: Math.min(a.y, b.y),
        y1: Math.max(a.y, b.y),
      });
  }
  // A grid line has fixed crossing points. Count each route once per point, then query the
  // sorted coordinates for every grid edge. Parallel costs keep their original summation order.
  const lineCache = [new Map<number, GridLine>(), new Map<number, GridLine>()];
  function onLine(horizontal: boolean, at: number) {
    const memo = lineCache[horizontal ? 0 : 1];
    let hit = memo.get(at);
    if (hit) return hit;
    const lo = horizontal ? 'y' : 'x',
      size = horizontal ? 'h' : 'w',
      t0 = horizontal ? 'y0' : 'x0',
      t1 = horizontal ? 'y1' : 'x1';
    hit = {
      obs: obsIn.filter(r => r[lo] - 1 < at && r[lo] + r[size] + 1 > at),
      near: nearIn.filter(r => r[lo] - r.band - 1 <= at && r[lo] + r[size] + r.band + 1 >= at),
      parallel: [],
      crossings: [],
    };
    const seen = new Set<string>();
    for (const t of existing) {
      if (t[t1] < at - reach || t[t0] > at + reach) continue;
      if (horizontal === t.h) {
        hit.parallel.push(t);
        continue;
      }
      if (at < t[t0] - EPS || at > t[t1] + EPS) continue;
      const p = horizontal ? { x: t.a.x, y: at } : { x: at, y: t.a.y };
      if ((same(p, start) || same(p, end)) && (same(p, t.first) || same(p, t.last))) continue;
      const key = t.id + ':' + p.x + ',' + p.y;
      if (seen.has(key)) continue;
      seen.add(key);
      hit.crossings.push(horizontal ? p.x : p.y);
    }
    hit.crossings.sort((a, b) => a - b);
    memo.set(at, hit);
    return hit;
  }
  // Shared and parallel runs use the same tests and sums, in the same order.
  const gap = s.edgeGap,
    laneLimit = gap - 0.05;
  function segmentCost(a: Point, b: Point, line: GridLine) {
    let shared = 0,
      lanes = 0;
    const h = Math.abs(a.y - b.y) < EPS,
      lo = h ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
      hi = h ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      at = h ? a.y : a.x;
    for (const t of line.parallel) {
      const overlap = Math.min(hi, h ? t.x1 : t.y1) - Math.max(lo, h ? t.x0 : t.y0),
        separation = Math.abs(at - (h ? t.a.y : t.a.x));
      if (!(separation > EPS) && overlap > EPS) shared += overlap;
      if (overlap > 1 && separation < laneLimit) lanes += (overlap * (gap - separation)) / gap;
    }
    const hits = atMost(line.crossings, hi + EPS) - below(line.crossings, lo - EPS);
    return (
      distance(a, b) +
      (near.length ? standoffSegment(a, b, line.near) : 0) +
      hits * s.crossingPenalty +
      shared * s.sharedPenalty +
      lanes * s.parallelPenalty
    );
  }

  for (const dir of [0, 1]) {
    const key = startCell * 2 + dir;
    scores[key] = 0;
    heap.push(key, 0, distance(start, end));
  }
  let result: number | null = null,
    visits = 0;
  while (heap.length && visits++ < limit) {
    heap.pop();
    const ckey = heap.key,
      cg = heap.g;
    if (cg !== scores[ckey]) continue;
    const cell = ckey >> 1,
      dir = ckey & 1;
    if (cell === endCell) {
      result = ckey;
      break;
    }
    const x = cell % nx,
      y = (cell - x) / nx;
    for (let i = 0; i < 4; i++) {
      const nd = i & 1,
        xx = i === 0 ? x + 1 : i === 2 ? x - 1 : x,
        yy = i === 1 ? y + 1 : i === 3 ? y - 1 : y;
      if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
      const nc = yy * nx + xx,
        key = nc * 2 + nd,
        // The grid edge between two neighbouring cells: the lower cell, and which way it runs.
        ck = (cell < nc ? cell : nc) * 2 + nd;
      let k = cache[ck];
      if (k !== k) {
        const a = { x: X[x], y: Y[y] },
          b = { x: X[xx], y: Y[yy] },
          line = nd ? onLine(false, a.x) : onLine(true, a.y);
        k = blocked(a, b, line.obs) ? Infinity : segmentCost(a, b, line);
        cache[ck] = k;
      }
      if (k === Infinity) continue;
      const g = cg + k + (dir !== nd ? s.bendPenalty : 0);
      if (g >= scores[key] - 0.001) continue;
      scores[key] = g;
      prev[key] = ckey;
      heap.push(key, g, g + Math.abs(X[xx] - end.x) + Math.abs(Y[yy] - end.y));
    }
  }
  if (result === null) return null;
  const ps: Point[] = [];
  for (let k = result; k !== -1; k = prev[k]) {
    const cell = Math.floor(k / 2);
    ps.push({ x: X[cell % nx], y: Y[Math.floor(cell / nx)] });
  }
  return compress(ps.reverse());
}
