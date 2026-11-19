import type { Context } from './context.ts';
import { distance, EPS } from './geometry.ts';
import { validPath } from './paths.ts';
import { port } from './ports.ts';
import type { Route, RouteEdge } from './types.ts';

/**
 * A line's planned route (`plan`, from a `flow` scope's ranks) is its route when it leaves and
 * enters by facing sides and clears every box.
 */
export function planned(ctx: Context, e: RouteEdge): Route | null {
  const { rects, obsFor } = ctx;
  const plan = e.cfg.plan;
  if (!plan || e.from === e.to || e.cfg.waypoints?.length) return null;
  const ps = plan.points,
    level = Math.abs(ps[0].y - ps[1].y) < EPS,
    fs = level ? (ps[1].x > ps[0].x ? 'right' : 'left') : ps[1].y > ps[0].y ? 'bottom' : 'top',
    last = ps.at(-2)!,
    end = ps.at(-1)!,
    ts =
      Math.abs(last.y - end.y) < EPS
        ? end.x > last.x
          ? 'left'
          : 'right'
        : end.y > last.y
          ? 'top'
          : 'bottom',
    startPort = port(rects.get(e.from)!, fs, plan.fromOffset),
    endPort = port(rects.get(e.to)!, ts, plan.toOffset);
  // Plans round both the port and its offset to hundredths.
  if (
    (e.cfg.fromSide && e.cfg.fromSide !== 'auto' && e.cfg.fromSide !== fs) ||
    (e.cfg.toSide && e.cfg.toSide !== 'auto' && e.cfg.toSide !== ts) ||
    (typeof e.cfg.toOffset === 'number' && e.cfg.toOffset !== plan.toOffset) ||
    distance(ps[0], startPort) > 0.02 ||
    distance(end, endPort) > 0.02 ||
    !validPath(ps, e, fs, ts, obsFor(e))
  )
    return null;
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    fromSide: fs,
    toSide: ts,
    fromOffset: plan.fromOffset,
    toOffset: plan.toOffset,
    points: ps.map(p => ({ x: p.x, y: p.y })),
    blocked: false,
  };
}
