import { conflicts, parallelConflicts } from './conflicts.ts';
import type { Context } from './context.ts';
import { find } from './find.ts';
import { cmp } from './geometry.ts';

/**
 * Routes again each line that is blocked, crosses, shares a run, runs too close to another or
 * uses a far side, worst first, and keeps a new route when the whole drawing costs less. Returns
 * how many it kept.
 */
export function improve(ctx: Context) {
  const { rawOptions, s, edges, state, metrics, total, far, syncOpen } = ctx;
  let accepted = 0;
  if (!rawOptions.quick)
    for (let pass = 1; pass < s.passes; pass++) {
      const currentMetrics = metrics(state.routes);
      if (
        !currentMetrics.crossings &&
        !currentMetrics.shared &&
        !currentMetrics.blocked &&
        !currentMetrics.lanePairs &&
        !state.routes.some(far)
      )
        break;
      // Each route's crossings with the others, counted once rather than in every comparison.
      const crossed = new Map(
        state.routes.map(r => [
          r.id,
          conflicts(
            r.points,
            state.routes.filter(q => q !== r),
          ).crossings,
        ]),
      );
      const order = [...edges].sort((a, b) => {
        const ra = state.routes.find(r => r.id === a.id)!,
          rb = state.routes.find(r => r.id === b.id)!;
        return (
          Number(rb.blocked) - Number(ra.blocked) ||
          crossed.get(rb.id)! - crossed.get(ra.id)! ||
          cmp(a.id, b.id)
        );
      });
      let current = total(state.routes);
      for (const e of order) {
        if (state.fixedPlans.has(e.id)) continue;
        const i = state.routes.findIndex(r => r.id === e.id),
          used = state.routes.filter((_, j) => j !== i),
          c = conflicts(state.routes[i].points, used);
        if (
          !state.routes[i].blocked &&
          !c.crossings &&
          !c.shared &&
          !parallelConflicts(state.routes[i].points, used, s.edgeGap).lanePairs &&
          !far(state.routes[i])
        )
          continue;
        const next = find(ctx, e, used, state.routes[i]),
          candidate = [...state.routes];
        candidate[i] = next;
        const value = total(candidate);
        if (value < current - 0.1) {
          state.routes = candidate;
          current = value;
          syncOpen();
          accepted++;
        }
      }
    }
  return accepted;
}
