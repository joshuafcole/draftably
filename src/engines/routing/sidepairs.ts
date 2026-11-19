import type { Context } from './context.ts';
import { gate } from './context.ts';
import { blocked, center, clamp, distance, round, vector } from './geometry.ts';
import { port, slot } from './ports.ts';
import type {
  Box,
  Candidate,
  Obstacle,
  Point,
  PriorRoute,
  Rect,
  Route,
  RouteEdge,
  Side,
} from './types.ts';

/** One pair of sides an edge may use, with its ports and stubs, and how to look for its paths. */
export interface SidePair {
  c: Candidate;
  /** Stacked neighbours closer than two stubs: the stubs meet halfway and no grid search runs. */
  tight: boolean;
  /** The obstacles its doglegs must clear. */
  walls: Obstacle[];
  /** The two ports face each other on one clear line. */
  straight: boolean;
  /** False for an edge with waypoints: only the grid search routes it. */
  paths: boolean;
}

/**
 * Port choice: for each allowed pair of sides, the port offsets the fans already on those sides
 * leave free, the stubs out of them, and the obstacles gated to them. Pairs whose stubs are
 * blocked, or whose diamond vertex is taken while another is free, are left out.
 */
export function sidePairs(
  ctx: Context,
  e: RouteEdge,
  used: Route[],
  edgeObs: Obstacle[],
  from: Side[],
  to: Side[],
  axis: (c: Candidate) => number,
  old: PriorRoute | null | undefined,
): SidePair[] {
  const { rects, s, facingFans, crowdedSide } = ctx,
    a = rects.get(e.from)!,
    b = rects.get(e.to)!,
    cfg = e.cfg,
    pin = e.pin || {},
    out: SidePair[] = [];
  // A diamond's ports sit on its four vertices, one edge each; a further edge goes to a free
  // vertex. Only when all four are taken do they share.
  const vertices = (r: Box) => facingFans && r.shape === 'diamond',
    vertexTaken = (id: string, side: Side) =>
      used.some(q => (q.from === id && q.fromSide === side) || (q.to === id && q.toSide === side)),
    vertexClosed = (r: Box, id: string, side: Side, sides: Side[]) =>
      vertices(r) &&
      sides.length > 1 &&
      vertexTaken(id, side) &&
      sides.some(x => !vertexTaken(id, x));
  for (const fs of from)
    for (const ts of to) {
      if (e.from === e.to && fs === ts) continue;
      if (vertexClosed(a, e.from, fs, from) || vertexClosed(b, e.to, ts, to)) continue;
      let fo = vertices(a)
          ? 0
          : slot(e.from, fs, a, used, s, b, !e.label && crowdedSide(e.from, fs), facingFans),
        toff = vertices(b) ? 0 : slot(e.to, ts, b, used, s, a, false, facingFans);
      const sameAxis = (fs === 'left' || fs === 'right') === (ts === 'left' || ts === 'right');
      if (sameAxis && e.from !== e.to && !vertices(b)) {
        const vertical = fs === 'left' || fs === 'right',
          axis = vertical ? 'y' : 'x',
          limit = (vertical ? b.h : b.w) / 2 - 12;
        // A group's frame is a long side: a line meets it as near its own line as the side
        // allows, not at the middle.
        const want = port(a, fs, fo)[axis] - center(b)[axis],
          desired = b.frame ? clamp(want, -limit, limit) : want;
        const taken = used.flatMap(q => [
          ...(q.from === e.to && q.fromSide === ts ? [q.fromOffset] : []),
          ...(q.to === e.to && q.toSide === ts ? [q.toOffset] : []),
        ]);
        if (
          Math.abs(desired) <= limit &&
          taken.every(v => Math.abs(desired - v) >= Math.max(s.portGap, s.edgeGap) - 0.01)
        )
          toff = desired;
      }
      // A lane may say where along the target's side the edge arrives.
      if (typeof cfg.toOffset === 'number' && cfg.toSide === ts && !vertices(b))
        toff = cfg.toOffset;
      // An end at a code range sits at the range's middle line, on a left or right side.
      const level = (x: Side) => x === 'left' || x === 'right';
      if (typeof cfg.fromAt === 'number' && level(fs)) fo = cfg.fromAt;
      if (typeof cfg.toAt === 'number' && level(ts)) toff = cfg.toAt;
      if (pin.from) fo = pin.from.offset;
      if (pin.to) toff = pin.to.offset;
      const start = port(a, fs, fo),
        end = port(b, ts, toff),
        obs = gate(edgeObs, start, fs, end, ts);
      // Stacked neighbours closer than two stubs: meet halfway across the gap
      // between the facing sides instead of hooking round the outside.
      const gap = s.standoff
          ? {
              right: b.x - a.x - a.w,
              left: a.x - b.x - b.w,
              bottom: b.y - a.y - a.h,
              top: a.y - b.y - b.h,
            }[fs]
          : 0,
        tight =
          vector[fs].x === -vector[ts].x &&
          vector[fs].y === -vector[ts].y &&
          gap > 0 &&
          gap < 2 * (s.clearance + 3),
        stub = tight ? gap / 2 : s.clearance + 3,
        ends = tight ? obs.filter(r => r.id !== e.from && r.id !== e.to) : null;
      // A diamond's vertex is a point, so a stub turning a clearance out runs along the
      // diamond's corners. It leaves a full standoff out where there is room.
      const stubAt = (r: Rect, side: Side, p: Point, n: number) => ({
          x: round(side === 'left' ? r.x - n : side === 'right' ? r.x + r.w + n : p.x),
          y: round(side === 'top' ? r.y - n : side === 'bottom' ? r.y + r.h + n : p.y),
        }),
        clearOf = (p: Point, q: Point, id: string) =>
          !blocked(p, q, ends || obs.filter(r => r.id !== id)),
        long = Math.max(stub, s.standoff);
      let as = stubAt(a, fs, start, stub),
        bs = stubAt(b, ts, end, stub);
      if (!clearOf(start, as, e.from) || !clearOf(end, bs, e.to)) continue;
      if (!tight && vertices(a) && long > stub) {
        const far = stubAt(a, fs, start, long);
        if (clearOf(start, far, e.from)) as = far;
      }
      if (!tight && vertices(b) && long > stub) {
        const far = stubAt(b, ts, end, long);
        if (clearOf(end, far, e.to)) bs = far;
      }
      const c: Candidate = { fs, ts, fo, toff, start, end, as, bs, obs, lower: 0 };
      // Through any waypoints, so a side facing away from the first one ranks last.
      const via = [start, ...(cfg.waypoints || []), end];
      c.lower =
        via.reduce((sum, p, i) => (i ? sum + distance(via[i - 1], p) : 0), 0) +
        axis(c) +
        (old && fs !== old.fromSide ? s.portStability : 0) +
        (old && ts !== old.toSide ? s.portStability : 0);
      if (tight) {
        if (cfg.waypoints?.length) continue;
        const walls = [...ends!, { ...a, id: e.from }, { ...b, id: e.to }];
        out.push({ c, tight, walls, straight: false, paths: true });
        continue;
      }
      if (cfg.waypoints?.length) {
        out.push({ c, tight, walls: obs, straight: false, paths: false });
        continue;
      }
      // Preserve genuinely straight facing connections even when two 13px
      // stubs would overlap inside a narrow but valid inter-node gap.
      const v = vector[fs],
        w = vector[ts],
        dx = end.x - start.x,
        dy = end.y - start.y;
      const straight =
        (start.x === end.x || start.y === end.y) &&
        v.x * dx + v.y * dy > 0 &&
        w.x * -dx + w.y * -dy > 0 &&
        !blocked(
          start,
          end,
          obs.filter(r => r.id !== e.from && r.id !== e.to),
        );
      out.push({ c, tight, walls: obs, straight, paths: true });
    }
  return out;
}
