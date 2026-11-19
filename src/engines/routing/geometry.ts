import type { Obstacle, Point, Rect, Side } from './types.ts';

export const SIDES: Side[] = ['right', 'bottom', 'left', 'top'],
  EPS = 0.0001;
export const round = (n: number) => Math.round(n * 100) / 100,
  clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)),
  cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
/** Distance along the axes: every line is level or upright. */
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** The unit vector out of each side. */
export const vector: Record<Side, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};
export function inflate<R extends Rect>(r: R, p: number): R {
  return {
    ...r,
    x: round(r.x - p),
    y: round(r.y - p),
    w: round(r.w + 2 * p),
    h: round(r.h + 2 * p),
  };
}
function contains(p: Point, r: Rect) {
  return p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS;
}
// An `across` obstacle can be crossed vertically but not run along: a header band beside
// its title. With `gates`, only on those lines: the band is crossed only by a line straight
// into or out of a member's top.
const passes = (r: Obstacle, x: number) =>
  r.across && (!r.gates || r.gates.some(g => Math.abs(g - x) < EPS));
/** Whether the level or upright segment a→b enters an obstacle. A slanted segment always does. */
export function blocked(a: Point, b: Point, obs: Obstacle[]) {
  if (same(a, b)) return obs.some(r => !r.across && contains(a, r));
  if (Math.abs(a.x - b.x) < EPS)
    return obs.some(
      r =>
        !passes(r, a.x) &&
        a.x > r.x + EPS &&
        a.x < r.x + r.w - EPS &&
        Math.max(a.y, b.y) > r.y + EPS &&
        Math.min(a.y, b.y) < r.y + r.h - EPS,
    );
  if (Math.abs(a.y - b.y) < EPS)
    return obs.some(
      r =>
        a.y > r.y + EPS &&
        a.y < r.y + r.h - EPS &&
        Math.max(a.x, b.x) > r.x + EPS &&
        Math.min(a.x, b.x) < r.x + r.w - EPS,
    );
  return true;
}
/** A path with rounded points, without repeats or points inside a straight run. */
export function compress(ps: Point[]) {
  const out: Point[] = [];
  for (const raw of ps) {
    const p = { x: round(raw.x), y: round(raw.y) };
    if (out.length && same(out.at(-1)!, p)) continue;
    while (out.length >= 2) {
      const a = out.at(-2)!,
        b = out.at(-1)!;
      const collinear =
        (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - p.x) < EPS) ||
        (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - p.y) < EPS);
      // Never erase a reversal: it would hide a backtracking stub.
      if (collinear && (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= 0) out.pop();
      else break;
    }
    out.push(p);
  }
  return out;
}
export function segments(ps: Point[]) {
  return ps.slice(1).map((b, i): [Point, Point] => [ps[i], b]);
}
// Entries of sorted `a` below `v`, and at or below `v`.
export function below(a: number[], v: number) {
  let lo = 0,
    hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}
export function atMost(a: number[], v: number) {
  let lo = 0,
    hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] <= v) lo = m + 1;
    else hi = m;
  }
  return lo;
}
// The length of a path, as `pathLength` adds it, without building its segments.
export function lengthOf(ps: Point[]) {
  let n = 0;
  for (let i = 1; i < ps.length; i++) n += distance(ps[i - 1], ps[i]);
  return n;
}
// Bends `compress` leaves in `start`, `ps`, `end`, or fewer: a turn between two runs, each at
// least 0.02 long so that rounding cannot erase it.
export function bendsOf(start: Point, ps: Point[], end: Point) {
  let n = 0,
    dx = 0,
    dy = 0,
    last = start;
  const step = (p: Point) => {
    const x = p.x - last.x,
      y = p.y - last.y;
    if (Math.abs(x) + Math.abs(y) < 0.02) return;
    const ux = Math.sign(Math.abs(x) < 0.02 ? 0 : x),
      uy = Math.sign(Math.abs(y) < 0.02 ? 0 : y);
    if ((dx || dy) && (ux !== dx || uy !== dy)) n++;
    dx = ux;
    dy = uy;
    last = p;
  };
  for (const p of ps) step(p);
  step(end);
  return n;
}
/** Length of a route's axis-aligned segments that lies inside rectangle `r`. */
export function insideLength(ps: Point[], r: Rect) {
  let n = 0;
  for (let i = 1; i < ps.length; i++) {
    const p = ps[i - 1],
      q = ps[i];
    if (Math.abs(p.y - q.y) < EPS) {
      if (p.y <= r.y || p.y >= r.y + r.h) continue;
      n += Math.max(0, Math.min(Math.max(p.x, q.x), r.x + r.w) - Math.max(Math.min(p.x, q.x), r.x));
    } else if (Math.abs(p.x - q.x) < EPS) {
      if (p.x <= r.x || p.x >= r.x + r.w) continue;
      n += Math.max(0, Math.min(Math.max(p.y, q.y), r.y + r.h) - Math.max(Math.min(p.y, q.y), r.y));
    }
  }
  return n;
}
/** The length of a path, added segment by segment. */
export const pathLength = (ps: Point[]) =>
  segments(ps).reduce((n, [a, b]) => n + distance(a, b), 0);
