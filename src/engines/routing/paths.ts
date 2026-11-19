import { conflicts, parallelConflicts } from './conflicts.ts';
import { gate, type Context } from './context.ts';
import { cost } from './cost.ts';
import { blocked, compress, EPS, vector } from './geometry.ts';
import type { Obstacle, Point, Route, RouteEdge, Side } from './types.ts';

/**
 * Whether a path leaves and enters along its sides' normals, stays level or upright, clears the
 * obstacles (its own end boxes aside, on the first and last segment) and never doubles back.
 */
export function validPath(points: Point[], e: RouteEdge, fs: Side, ts: Side, obs: Obstacle[]) {
  if (points.length < 2) return false;
  obs = gate(obs, points[0], fs, points.at(-1)!, ts);
  const start = points[0],
    next = points[1],
    end = points.at(-1)!,
    prev = points.at(-2)!,
    v = vector[fs],
    w = vector[ts];
  if (
    v.x * (next.x - start.x) + v.y * (next.y - start.y) <= EPS ||
    w.x * (prev.x - end.x) + w.y * (prev.y - end.y) <= EPS
  )
    return false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) return false;
    const obstacles = obs.filter(
      r => !(i === 1 && r.id === e.from) && !(i === points.length - 1 && r.id === e.to),
    );
    if (blocked(a, b, obstacles)) return false;
    if (i >= 2) {
      const c = points[i - 2];
      if ((b.x - a.x) * (a.x - c.x) + (b.y - a.y) * (a.y - c.y) < -EPS) return false;
    }
  }
  return true;
}
export function simplify(
  ctx: Context,
  points: Point[],
  e: RouteEdge,
  fs: Side,
  ts: Side,
  obs: Obstacle[],
  used: Route[],
) {
  const { s, near } = ctx;
  if (e.cfg.waypoints?.length) return points;
  let result = compress(points),
    bestCost = cost(result, used, s, near);
  // Replacing a subpath removes staircase artefacts only if the complete path
  // remains obstacle-safe, respects terminal normals, and does not add a lane
  // conflict or crossing. This is geometric simplification, not SVG cosmetics.
  for (let sweep = 0; sweep < 4; sweep++) {
    let improved = false;
    const before = conflicts(result, used),
      beforeLane = parallelConflicts(result, used, s.edgeGap);
    outer: for (let span = result.length - 1; span >= 2; span--)
      for (let i = 0; i + span < result.length; i++) {
        const j = i + span,
          a = result[i],
          b = result[j];
        for (const mid of [[{ x: a.x, y: b.y }], [{ x: b.x, y: a.y }], []]) {
          const p = compress([...result.slice(0, i + 1), ...mid, ...result.slice(j)]);
          if (p.length >= result.length || !validPath(p, e, fs, ts, obs)) continue;
          const c = conflicts(p, used),
            lane = parallelConflicts(p, used, s.edgeGap),
            score = cost(p, used, s, near);
          if (
            c.crossings > before.crossings ||
            lane.laneDeficit > beforeLane.laneDeficit + 0.1 ||
            score >= bestCost - 0.01
          )
            continue;
          result = p;
          bestCost = score;
          improved = true;
          break outer;
        }
      }
    if (!improved) break;
  }
  return result;
}
