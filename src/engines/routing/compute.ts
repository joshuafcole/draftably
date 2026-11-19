import { createContext } from './context.ts';
import { find } from './find.ts';
import { cmp } from './geometry.ts';
import { improve } from './improve.ts';
import { nudge } from './nudge.ts';
import { planned } from './planned.ts';
import { repair } from './repair.ts';
import { tidy } from './tidy.ts';
import type { RouteInput, RoutingOptions, RoutingReport, RoutingResult } from './types.ts';

/**
 * Routes every edge between boxes that stay where they are: each edge in turn (locked ones and
 * short ones first), then the improvement, repair, nudge and tidy passes unless `quick`.
 */
export function compute(input: RouteInput, rawOptions: RoutingOptions = {}): RoutingResult {
  const ctx = createContext(input, rawOptions),
    { facingFans, began, s, previous, edges, state, syncOpen, metrics } = ctx;
  // Planned routes stay as planned: the passes below trade a crossing for bends or a backwards
  // side, which the plan's ranks avoid.
  for (const e of edges) {
    const plan = planned(ctx, e);
    if (plan) state.fixedPlans.add(e.id);
    state.routes.push(plan ?? find(ctx, e, state.routes, previous.get(e.id)));
  }
  syncOpen();
  const before = metrics(state.routes);
  const accepted = improve(ctx),
    repaired = repair(ctx),
    nudged = nudge(ctx),
    tidyOn = !rawOptions.quick && rawOptions.tidy !== false,
    tidied = tidyOn ? tidy(ctx) : 0,
    routes = state.routes;
  routes.sort((a, b) => cmp(a.id, b.id));
  const report: RoutingReport = {
    ...metrics(routes),
    initial: before,
    accepted,
    ...(facingFans && !rawOptions.quick ? { repaired } : {}),
    nudged,
    ...(tidyOn ? { tidied } : {}),
    edges: routes.length,
    milliseconds: Date.now() - began,
    passes: rawOptions.quick ? 1 : s.passes,
  };
  return { routes, report };
}
