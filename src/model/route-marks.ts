/**
 * Marks drawn on routed lines that never change a route: an authored label's place along its
 * line, the leader that ties a label standing clear of its line back to it, and hops where one
 * line passes over another (`routing hops=on`).
 */
import { manhattan } from './geometry';
import type { Point, Rect } from './types';

/** Radius of a hop's arc. */
export const HOP_RADIUS = 5;
/** Room a hop leaves to a corner or an end of either line, past its own radius. */
const HOP_ROOM = 4;

/** A line's length along its runs. */
const lengthOf = (points: readonly Point[]) =>
  points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

/** The unit normal to the left of a run's way (above a run going right, on screen). */
const leftOf = (a: Point, b: Point) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
};

/**
 * The spot `at` of the way along a line (0 its source, 1 its target), moved `offset` to the left
 * of its way: where a `label` statement puts the label's middle.
 */
export function placeAlong(points: readonly Point[], at: number, offset: number): Point {
  if (!points.length) return { x: 0, y: 0 };
  const total = lengthOf(points),
    want = Math.max(0, Math.min(1, at)) * total;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    if (walked + len >= want || i === points.length - 1) {
      const t = Math.max(0, Math.min(1, (want - walked) / len)),
        n = leftOf(a, b);
      return { x: a.x + (b.x - a.x) * t + n.x * offset, y: a.y + (b.y - a.y) * t + n.y * offset };
    }
    walked += len;
  }
  return { ...points[0] };
}

/**
 * The inverse of `placeAlong`: the place on a line nearest a point, as a fraction of its length
 * (to three places) and a whole distance off it. What a label slide writes.
 */
export function placeOf(points: readonly Point[], p: Point): { at: number; offset: number } {
  const total = lengthOf(points);
  let best = { d: Infinity, along: 0, offset: 0 },
    walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len ** 2),
      ),
      q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d - 1e-9) {
      const n = leftOf(a, b);
      best = { d, along: walked + t * len, offset: (p.x - q.x) * n.x + (p.y - q.y) * n.y };
    }
    walked += len;
  }
  return {
    at: total ? Math.round((best.along / total) * 1000) / 1000 : 0.5,
    offset: Math.round(best.offset),
  };
}

/** The point of a line nearest `p`. */
export function nearestOnLine(points: readonly Point[], p: Point): Point {
  let best = points[0] ?? p,
    d = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2,
      t = l2
        ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2))
        : 0,
      q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      dq = Math.hypot(p.x - q.x, p.y - q.y);
    if (dq < d) [best, d] = [q, dq];
  }
  return best;
}

/** Distance from a rectangle to a line; 0 when they touch. */
export function gapToLine(r: Rect, points: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = Math.max(r.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - (r.x + r.w), 0),
      dy = Math.max(r.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - (r.y + r.h), 0);
    // Runs are level or upright, so the box-to-segment gap is the gap between their bounds.
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

/** A leader: from a label's edge to the nearest point of its line. */
export interface Leader {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The leader a label takes when it stands clear of its line by more than half its height (the
 * line `check` calls `label-detached`), so it never reads as a floating string; none otherwise.
 */
export function labelLeader(points: readonly Point[], box: Rect): Leader | undefined {
  if (points.length < 2 || gapToLine(box, points) <= box.h / 2) return undefined;
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 },
    to = nearestOnLine(points, c),
    dx = to.x - c.x,
    dy = to.y - c.y,
    // Where the way from the middle to the line leaves the box.
    s = Math.min(
      dx ? box.w / 2 / Math.abs(dx) : Infinity,
      dy ? box.h / 2 / Math.abs(dy) : Infinity,
      1,
    );
  return { x1: c.x + dx * s, y1: c.y + dy * s, x2: to.x, y2: to.y };
}

/** One line for `hopsOf`: its id (which line of a crossing pair hops) and its points. */
export interface HopLine {
  id: string;
  points: readonly Point[];
}

const isLevel = (a: Point, b: Point) => Math.abs(a.y - b.y) < 0.5;
const isUpright = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5;

/**
 * Where each line hops: one point per crossing of a level run with an upright run of another line,
 * on the line with the greater id, so of every crossing pair exactly one line hops and always the
 * same one, whatever else is drawn. Lines that share an end are candidates too: two lines may meet
 * at a box they share, and that is not a crossing, but they may still cross in open space. A
 * crossing within a hop's room of a corner or an end of either run is left plain, as a hop there
 * would read as a bend (and a shared anchor is never a crossing).
 */
export function hopsOf(lines: readonly HopLine[]): Point[][] {
  const room = HOP_RADIUS + HOP_ROOM,
    runs = lines.map(l => l.points.slice(1).map((b, i) => [l.points[i], b] as const)),
    out: Point[][] = lines.map(() => []),
    clear = (t: number, p: number, q: number) =>
      t > Math.min(p, q) + room && t < Math.max(p, q) - room;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const hopper = lines[i].id > lines[j].id ? i : j;
      for (const r of runs[i])
        for (const s of runs[j]) {
          const [h, v] =
            isLevel(...r) && isUpright(...s)
              ? [r, s]
              : isUpright(...r) && isLevel(...s)
                ? [s, r]
                : [];
          if (!h || !v) continue;
          const x = v[0].x,
            y = h[0].y;
          if (!clear(x, h[0].x, h[1].x) || !clear(y, v[0].y, v[1].y)) continue;
          const mine = out[hopper];
          if (!mine.some(p => Math.hypot(p.x - x, p.y - y) < 2 * room)) mine.push({ x, y });
        }
    }
  return out;
}

/** The squares a line's hop arcs take up, for labels to keep clear of (as #629 did). */
export const hopRects = (hops: readonly Point[][]): Rect[] =>
  hops.flat().map(h => ({
    x: h.x - HOP_RADIUS,
    y: h.y - HOP_RADIUS,
    w: 2 * HOP_RADIUS,
    h: 2 * HOP_RADIUS,
  }));

/**
 * A rounded path, as `roundedPath` draws it, with an arc over each hop on its straight runs. The
 * bulge is the same way up everywhere: a level run arcs up, an upright run arcs right, whichever
 * way the line runs.
 */
export function hoppedPath(points: readonly Point[], radius: number, hops: readonly Point[]) {
  if (!points.length) return '';
  let path = `M${points[0].x},${points[0].y}`;
  const R = HOP_RADIUS;
  const run = (from: Point, to: Point) => {
    const level = Math.abs(from.y - to.y) < 0.5,
      upright = Math.abs(from.x - to.x) < 0.5;
    if (level || upright) {
      // Along the run: x on a level one, y on an upright one.
      const along = (p: Point) => (level ? p.x : p.y),
        across = (p: Point) => (level ? p.y : p.x),
        dir = Math.sign(along(to) - along(from));
      const on = hops
        .filter(
          h =>
            Math.abs(across(h) - across(from)) < 0.5 &&
            (along(h) - along(from)) * dir > R &&
            (along(to) - along(h)) * dir > R,
        )
        .sort((p, q) => (along(p) - along(q)) * dir);
      for (const h of on) {
        const [a, b] = level
          ? [`${h.x - dir * R},${h.y}`, `${h.x + dir * R},${h.y}`]
          : [`${h.x},${h.y - dir * R}`, `${h.x},${h.y + dir * R}`];
        // Up on a level run and right on an upright one: clockwise going right or down.
        path += `L${a}A${R},${R} 0 0 ${dir > 0 ? 1 : 0} ${b}`;
      }
    }
    path += `L${to.x},${to.y}`;
  };
  let at = points[0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      p = points[i],
      b = points[i + 1];
    const r = b ? Math.min(radius, manhattan(a, p) / 2, manhattan(p, b) / 2) : 0;
    if (!b || r === 0) {
      run(at, p);
      at = p;
      continue;
    }
    const before = { x: p.x + Math.sign(a.x - p.x) * r, y: p.y + Math.sign(a.y - p.y) * r },
      after = { x: p.x + Math.sign(b.x - p.x) * r, y: p.y + Math.sign(b.y - p.y) * r };
    run(at, before);
    path += `Q${p.x},${p.y} ${after.x},${after.y}`;
    at = after;
  }
  return path;
}
