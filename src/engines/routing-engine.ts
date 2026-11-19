/* Joint port selection and obstacle-aware routing.
 * Original local implementation, not libavoid. Pure input/output, Browser + Node.
 * Node positions are never changed. Explicit sides and waypoints are constraints.
 *
 * The phases live in `routing/`: port choice (ports, sidepairs), path search (doglegs, search,
 * find), scoring (conflicts, cost, score), and the passes over the whole drawing (improve,
 * repair, nudge, tidy).
 *
 * Node runs the engines with no build (the engine suites do). So an engine module imports other
 * engine modules with the `.ts` extension, and only types from outside `engines/`. A change here
 * must keep the output byte for byte: `pnpm test:engines` compares it with `reference/v7/`.
 */
import { compute } from './routing/compute.ts';
import { conflicts, parallelConflicts, type Line } from './routing/conflicts.ts';
import { blocked } from './routing/geometry.ts';
import { port } from './routing/ports.ts';
import { defaults, settings } from './routing/settings.ts';

export const RouteLab = {
  compute,
  settings,
  defaults,
  port,
  blocked,
  conflicts,
  parallelConflicts,
  /** Crossings and shared run length of a set of routes, each counted against the ones before it. */
  metrics: (routes: Line[]) => {
    let crossings = 0,
      shared = 0;
    routes.forEach((r, i) => {
      const c = conflicts(r.points, routes.slice(0, i));
      crossings += c.crossings;
      shared += c.shared;
    });
    return { crossings, shared };
  },
};

export type {
  PriorRoute,
  Route,
  RouteEdgeInput,
  RouteGroupInput,
  RouteInput,
  RouteMetrics,
  RouteNodeInput,
  RoutingOptions,
  RoutingReport,
  RoutingResult,
} from './routing/types.ts';
