import { spanOf, type Line } from './conflicts.ts';
import { standoffLines } from './cost.ts';
import { atMost, below, distance, EPS, segments } from './geometry.ts';
import type { NearBox, Obstacle, Point, RoutingSettings } from './types.ts';

/** Sorted starts and ends of the segments inside one span. */
interface Band {
  los: number[];
  his: number[];
}
/** The segments that span one outer run of a dogleg, and their ranks at the run's fixed end. */
interface Arm {
  xs: number[];
  end: number;
  lo: number;
  hi: number;
}

// Grid lines a lane beside each segment of `used`, in order, as `doglegs` tries them. They do not
// depend on the line being routed, so `findAmong` works them out once for all its side pairs.
export interface Lanes {
  xs: number[];
  ys: number[];
}
export function laneLines(used: Line[], s: RoutingSettings): Lanes {
  const xs: number[] = [],
    ys: number[] = [];
  for (const r of used)
    for (const [u, v] of segments(r.points)) {
      if (Math.abs(u.x - v.x) < EPS) xs.push(u.x - s.edgeGap, u.x + s.edgeGap);
      else ys.push(u.y - s.edgeGap, u.y + s.edgeGap);
    }
  return { xs, ys };
}
// Paths of up to two bends from `a` to `b`, before `compress` and before the obstacle checks: the
// caller makes those on the paths that may win. `visit(path, k)` gets each path shorter than
// `room`, with `k` its place in the fixed order and the middle run's axis for a two-bend path.
export function doglegs(
  a: Point,
  b: Point,
  obs: Obstacle[],
  s: RoutingSettings,
  lanes: Lanes,
  near: NearBox[],
  room: number,
  visit: (path: Point[], k: number, horizontal?: boolean) => void,
) {
  const xs = new Set([(a.x + b.x) / 2]),
    ys = new Set([(a.y + b.y) / 2]);
  for (const r of obs) {
    if (r.x < Math.max(a.x, b.x) + 80 && r.x + r.w > Math.min(a.x, b.x) - 80) {
      ys.add(r.y);
      ys.add(r.y + r.h);
    }
    if (r.y < Math.max(a.y, b.y) + 80 && r.y + r.h > Math.min(a.y, b.y) - 80) {
      xs.add(r.x);
      xs.add(r.x + r.w);
    }
  }
  for (const x of lanes.xs) xs.add(x);
  for (const y of lanes.ys) ys.add(y);
  const lines: Record<'x' | 'y', number[]> = { x: [], y: [] };
  standoffLines(near, lines.x, lines.y);
  for (const x of lines.x)
    if (x > Math.min(a.x, b.x) - 80 && x < Math.max(a.x, b.x) + 80) xs.add(x);
  for (const y of lines.y)
    if (y > Math.min(a.y, b.y) - 80 && y < Math.max(a.y, b.y) + 80) ys.add(y);
  xs.add(Math.min(a.x, b.x) - s.portGap);
  xs.add(Math.max(a.x, b.x) + s.portGap);
  ys.add(Math.min(a.y, b.y) - s.portGap);
  ys.add(Math.max(a.y, b.y) + s.portGap);
  const across = distance(a, b);
  if (across < room) {
    visit([a, b], 0);
    visit([a, { x: b.x, y: a.y }, b], 1);
    visit([a, { x: a.x, y: b.y }, b], 2);
  }
  let k = 3;
  // A lane outside the span between the ends adds twice its distance from it.
  const dy = Math.abs(a.y - b.y),
    dx = Math.abs(a.x - b.x);
  for (const x of xs) {
    if (Math.abs(a.x - x) + Math.abs(x - b.x) + dy < room)
      visit([a, { x, y: a.y }, { x, y: b.y }, b], k, false);
    k++;
  }
  for (const y of ys) {
    if (Math.abs(a.y - y) + Math.abs(y - b.y) + dx < room)
      visit([a, { x: a.x, y }, { x: b.x, y }, b], k, true);
    k++;
  }
}
// A crossing counts toward `crossingFloor` only this far inside both segments, more than
// `compress` rounding can move an end, so `conflicts` always counts it too.
const INSIDE = 0.02;
/**
 * A lower bound on the crossings `conflicts` finds between a dogleg (2 to 4 points, before
 * `compress`) and `used`: segments that cross well inside both. Two such crossings are never one
 * point of one route, so each is a crossing `conflicts` counts. Runs along a fixed line use the
 * level or upright segments that span it; a dogleg's middle run, which moves with its lane, uses
 * the segments inside its fixed span.
 */
export function crossingFloor(used: Line[]) {
  const level: number[] = [],
    upright: number[] = [];
  for (const r of used) {
    const v = spanOf(r.points);
    for (let i = 0; i < v.n; i++)
      if (v.hi[i] - v.lo[i] > 2 * INSIDE)
        (v.h[i] ? level : upright).push(v.at[i], v.lo[i], v.hi[i]);
  }
  const lines = new Map<string, number[]>(),
    bands = new Map<string, Band>();
  // Across the line `at`: where the segments of `list` that span it lie, sorted.
  const line = (key: string, list: number[], at: number) => {
    let xs = lines.get(key);
    if (!xs) {
      xs = [];
      for (let i = 0; i < list.length; i += 3)
        if (list[i + 1] + INSIDE < at && at < list[i + 2] - INSIDE) xs.push(list[i]);
      xs.sort((p, q) => p - q);
      lines.set(key, xs);
    }
    return xs;
  };
  // The segments of `list` inside the span lo..hi across them: their starts and ends, sorted.
  const band = (key: string, list: number[], lo: number, hi: number) => {
    let b = bands.get(key);
    if (!b) {
      const los: number[] = [],
        his: number[] = [];
      for (let i = 0; i < list.length; i += 3)
        if (lo + INSIDE < list[i] && list[i] < hi - INSIDE) {
          los.push(list[i + 1]);
          his.push(list[i + 2]);
        }
      los.sort((p, q) => p - q);
      his.sort((p, q) => p - q);
      b = { los, his };
      bands.set(key, b);
    }
    return b;
  };
  // Crossings of a straight path or an L, whose runs lie on fixed lines.
  const run = (p: Point, q: Point) => {
    const flat = Math.abs(p.y - q.y) < EPS;
    if (!flat && Math.abs(p.x - q.x) >= EPS) return 0;
    const at = flat ? p.y : p.x,
      lo = flat ? Math.min(p.x, q.x) : Math.min(p.y, q.y),
      hi = flat ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
    if (hi - lo <= 2 * INSIDE) return 0;
    // A level run crosses upright segments, and an upright run level ones.
    const list = flat ? upright : level;
    const xs = line((flat ? 'h' : 'v') + at, list, at);
    return Math.max(0, below(xs, hi - INSIDE) - atMost(xs, lo + INSIDE));
  };
  // A side pair fixes both outer runs and the middle span. Prepare their endpoint ranks once;
  // only the lane coordinate changes between its doglegs.
  const arm = (xs: number[], end: number): Arm => ({
    xs,
    end,
    lo: below(xs, end - INSIDE),
    hi: atMost(xs, end + INSIDE),
  });
  const along = (arm: Arm, at: number) => {
    if (Math.abs(at - arm.end) <= 2 * INSIDE) return 0;
    return Math.max(
      0,
      at > arm.end ? below(arm.xs, at - INSIDE) - arm.hi : arm.lo - atMost(arm.xs, at + INSIDE),
    );
  };
  return (a: Point, b: Point) => {
    const pairs: Array<{ first: Arm; last: Arm; middle: Band | null }> = [];
    return (raw: Point[], horizontal?: boolean) => {
      if (raw.length !== 4) {
        let n = 0;
        for (let i = 1; i < raw.length; i++) n += run(raw[i - 1], raw[i]);
        return n;
      }
      const axis = horizontal ? 0 : 1;
      let pair = pairs[axis];
      if (!pair) {
        const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
          hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
          at0 = horizontal ? a.x : a.y,
          at1 = horizontal ? b.x : b.y,
          list = horizontal ? level : upright;
        pair = {
          first: arm(line((horizontal ? 'v' : 'h') + at0, list, at0), horizontal ? a.y : a.x),
          last: arm(line((horizontal ? 'v' : 'h') + at1, list, at1), horizontal ? b.y : b.x),
          middle:
            hi - lo <= 2 * INSIDE
              ? null
              : band(
                  (horizontal ? 'H' : 'V') + lo + ',' + hi,
                  horizontal ? upright : level,
                  lo,
                  hi,
                ),
        };
        pairs[axis] = pair;
      }
      const at = horizontal ? raw[1].y : raw[1].x,
        mid = pair.middle,
        n =
          along(pair.first, at) +
          (mid ? Math.max(0, below(mid.los, at - INSIDE) - atMost(mid.his, at + INSIDE)) : 0);
      return n + along(pair.last, at);
    };
  };
}
