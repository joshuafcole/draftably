import { conflicts, parallelConflicts, parallelNear } from './conflicts.ts';
import type { Context } from './context.ts';
import { cost } from './cost.ts';
import { clone, compress, EPS, round, segments } from './geometry.ts';
import { simplify, validPath } from './paths.ts';

/**
 * Slide complete internal orthogonal segments into nearby free channels.
 * Endpoints, sides, node coordinates and authored waypoint routes stay fixed.
 * Returns how many routes it moved.
 */
export function nudge(ctx: Context) {
  const { rawOptions, s, near, edges, state, obsFor } = ctx;
  let nudged = 0;
  if (!rawOptions.quick)
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let ri = 0; ri < state.routes.length; ri++) {
        const route = state.routes[ri],
          e = edges.find(e => e.id === route.id)!;
        if (route.blocked || e.cfg.waypoints?.length || state.fixedPlans.has(e.id)) continue;
        const used = state.routes.filter((_, j) => j !== ri),
          obs = obsFor(e);
        if (!parallelConflicts(route.points, used, s.edgeGap).lanePairs) continue;
        let best = route.points,
          bestValue = cost(best, used, s, near);
        const before = conflicts(best, used);
        for (let i = 1; i < route.points.length - 2; i++) {
          const a = route.points[i],
            b = route.points[i + 1],
            h = Math.abs(a.y - b.y) < EPS,
            axis = h ? 'y' : 'x';
          const choices = new Set<number>();
          for (const other of used)
            for (const [c, d] of segments(other.points)) {
              if (Math.abs(c.y - d.y) < EPS !== h) continue;
              if (parallelNear(a, b, c, d, s.edgeGap * 2)) {
                choices.add(round(c[axis] + s.edgeGap));
                choices.add(round(c[axis] - s.edgeGap));
              }
            }
          for (const value of choices) {
            const p = clone(route.points);
            p[i][axis] = value;
            p[i + 1][axis] = value;
            const clean = compress(p);
            if (
              !validPath(clean, e, route.fromSide, route.toSide, obs) ||
              conflicts(clean, used).crossings > before.crossings
            )
              continue;
            const score = cost(clean, used, s, near);
            if (score < bestValue - 0.1) {
              best = clean;
              bestValue = score;
            }
          }
        }
        if (best !== route.points) {
          state.routes[ri] = {
            ...route,
            points: simplify(ctx, best, e, route.fromSide, route.toSide, obs, used),
          };
          changed = true;
          nudged++;
        }
      }
      if (!changed) break;
    }
  return nudged;
}
