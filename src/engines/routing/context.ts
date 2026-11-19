import { conflicts, parallelConflicts } from './conflicts.ts';
import { BORDER_WEIGHT } from './cost.ts';
import { center, cmp, distance, EPS, inflate, round, segments, SIDES, vector } from './geometry.ts';
import { TIGHT_PITCH } from './ports.ts';
import { settings } from './settings.ts';
import type {
  Box,
  NearBox,
  Obstacle,
  Point,
  Route,
  RouteEdge,
  RouteGroupInput,
  RouteInput,
  RouteMetrics,
  RoutingOptions,
  Side,
} from './types.ts';

/** The drawing as the passes change it. */
export interface RouteState {
  routes: Route[];
  /** Edges whose planned route was taken as it is: no pass moves them. */
  fixedPlans: Set<string>;
}

// Gate a group's header bands to the terminal lines of a route through a member's top.
export function gate(obs: Obstacle[], start: Point, fs: Side, end: Point, ts: Side) {
  if (!obs.some(r => r.gates)) return obs;
  const gates = [...(fs === 'top' ? [start.x] : []), ...(ts === 'top' ? [end.x] : [])];
  return obs.map(r => (r.gates ? { ...r, gates } : r));
}
/**
 * One routing run's view of the scene: the boxes and groups, the edges in routing order, the
 * obstacles each edge sees, and the measures the passes compare drawings with.
 */
export function createContext(input: RouteInput, rawOptions: RoutingOptions) {
  const facingFans = rawOptions.facing !== false,
    titleBands = rawOptions.titleBands !== false;
  const began = Date.now(),
    s = settings(rawOptions),
    rects = new Map<string, Box>(input.nodes.map(n => [n.id, { ...n }])),
    groups = new Map<string, RouteGroupInput>((input.groups || []).map(g => [g.id, { ...g }]));
  for (const [id, g] of groups) if (g.collapsed) rects.set(id, { ...g, shape: 'box' });
  const all = new Map<string, Box | RouteGroupInput>([...groups, ...rects]);
  const state: RouteState = { routes: [], fixedPlans: new Set() };
  const near: NearBox[] = s.standoff
    ? [
        // A group's frame stub stands for the group, whose border is already in the list.
        ...[...rects.values()].filter(r => !r.frame).map(r => ({ ...r, band: s.standoff })),
        ...[...groups.values()]
          .filter(g => !g.collapsed)
          .map(g => ({ ...g, band: s.standoff, border: true, weight: BORDER_WEIGHT })),
      ]
    : [];
  function ancestors(id: string) {
    const list: string[] = [];
    for (let p = all.get(id)?.parentId; p; p = all.get(p)?.parentId) {
      if (list.includes(p)) break;
      list.push(p);
    }
    return list;
  }
  const previous = new Map((rawOptions.previous || []).map(r => [r.id, r]));
  const edges: RouteEdge[] = input.edges
    .filter(e => rects.has(e.from) && rects.has(e.to))
    .map(e => ({ ...e, cfg: e.cfg || {} }));
  edges.sort((a, b) => {
    const locks = (e: RouteEdge) =>
      (e.cfg.waypoints?.length ? 4 : 0) +
      (e.cfg.fromSide && e.cfg.fromSide !== 'auto' ? 1 : 0) +
      (e.cfg.toSide && e.cfg.toSide !== 'auto' ? 1 : 0);
    return (
      locks(b) - locks(a) ||
      distance(center(rects.get(a.from)!), center(rects.get(a.to)!)) -
        distance(center(rects.get(b.from)!), center(rects.get(b.to)!)) ||
      cmp(a.id, b.id)
    );
  });
  // Edges whose route took the title-band exception (`DETOUR_RATIO`): their bands are
  // crossable straight across anywhere, not only on a top member's terminal line.
  const openBands = new Set<string>(),
    opened = new WeakSet<Route>(),
    syncOpen = () => {
      openBands.clear();
      for (const r of state.routes) if (opened.has(r)) openBands.add(r.id);
    };
  // How many edges have their other end beyond each side of a box: a fan that outgrows the
  // side's full-gap slots spreads at `TIGHT_PITCH` (`slot`'s `tight`).
  const facingCount = new Map<string, number>(),
    // Whether `other`'s centre lies past side `side` of box `id`, mostly in that direction.
    beyond = (id: string, other: string, side: Side) => {
      const r = rects.get(id)!,
        o = center(rects.get(other)!),
        c = center(r),
        level = Math.abs(o.x - c.x) >= Math.abs(o.y - c.y);
      return {
        left: level && o.x < r.x,
        right: level && o.x > r.x + r.w,
        top: !level && o.y < r.y,
        bottom: !level && o.y > r.y + r.h,
      }[side];
    };
  // Only unlabelled fans out of a box: arrowheads into one side, and labels, need the full gap.
  for (const e of edges)
    if (e.from !== e.to && !e.label)
      for (const side of SIDES)
        if (beyond(e.from, e.to, side))
          facingCount.set(e.from + '|' + side, (facingCount.get(e.from + '|' + side) ?? 0) + 1);
  const crowdedSide = (id: string, side: Side) => {
    const r = rects.get(id)!,
      span = (side === 'left' || side === 'right' ? r.h : r.w) - 24,
      gap = Math.max(s.portGap, s.edgeGap),
      slots = (pitch: number) => 1 + 2 * Math.floor(span / 2 / pitch + EPS),
      full = slots(gap);
    // Only when the tighter pitch makes room for more: otherwise the side is just full.
    return (
      facingFans &&
      (facingCount.get(id + '|' + side) ?? 0) > full &&
      slots(Math.min(TIGHT_PITCH, gap)) > full
    );
  };
  const flowOf = (e: RouteEdge) =>
    [e.cfg.flow, rawOptions.direction].find(d => d === 'right' || d === 'down');
  // Each route's score when `findIn` chose it, to weigh a gated route against an open one.
  const scores = new WeakMap<Route, number>();
  const obsFor = (e: RouteEdge, open = openBands.has(e.id)) => {
    const allowed = new Set([...ancestors(e.from), ...ancestors(e.to)]),
      // A frame stub (a line's end on an open group's frame) covers the group's members: it
      // blocks only its own lines, which must not run inside the group. Others see the group.
      obstacles: Obstacle[] = [...rects.values()]
        .filter(r => !r.frame || r.id === e.from || r.id === e.to)
        .map(r => inflate(r, s.clearance));
    for (const [id, g] of groups) {
      if (g.collapsed) continue;
      if (!allowed.has(id)) obstacles.push(inflate(g, s.clearance));
      else {
        // The title blocks the header band. Beside it, a line may cross the band
        // straight into the group but not run along it under the border.
        const title = Math.max(1, Math.min(g.w - 6, g.titleWidth ?? Infinity)),
          band = { y: g.y + 2, h: (g.titleHeight ?? 28) + s.clearance },
          lip = Math.max(s.clearance, s.standoff);
        obstacles.push({ id: id + ':header', x: g.x + 3, w: title, ...band });
        if (titleBands)
          // The whole band, from a clearance above the border, is crossed only by a line
          // straight into or out of a member's top: never run along or through.
          obstacles.push({
            id: id + ':header-band',
            // Beside the group only a clearance out, so a line can pass midway along its side.
            x: g.x - s.clearance,
            w: g.w + 2 * s.clearance,
            y: g.y - lip,
            h: band.y + band.h - g.y + lip,
            across: true,
            ...(open ? {} : { gates: [] }),
          });
        else if (title < g.w - 6)
          obstacles.push({
            id: id + ':header-band',
            x: g.x + 3 + title,
            w: g.w - 6 - title,
            ...band,
            across: true,
          });
      }
    }
    const common = ancestors(e.from).find(id => ancestors(e.to).includes(id))!;
    const g = groups.get(common);
    if (g) {
      const wall = 2000000;
      obstacles.push(
        { id: 'wall-l', x: g.x - wall, y: g.y - wall, w: wall, h: 2 * wall },
        { id: 'wall-r', x: g.x + g.w, y: g.y - wall, w: wall, h: 2 * wall },
        { id: 'wall-t', x: g.x, y: g.y - wall, w: g.w, h: wall },
        { id: 'wall-b', x: g.x, y: g.y + g.h, w: g.w, h: wall },
      );
    }
    return obstacles;
  };
  const metrics = (rs: Route[]): RouteMetrics => {
    let crossings = 0,
      shared = 0,
      lanePairs = 0,
      laneDeficit = 0,
      minGap = Infinity;
    for (let i = 0; i < rs.length; i++) {
      const used = rs.slice(0, i),
        c = conflicts(rs[i].points, used),
        p = parallelConflicts(rs[i].points, used, s.edgeGap);
      crossings += c.crossings;
      shared += c.shared;
      lanePairs += p.lanePairs;
      laneDeficit += p.laneDeficit;
      if (p.minGap !== null) minGap = Math.min(minGap, p.minGap);
    }
    return {
      crossings,
      shared: round(shared),
      lanePairs,
      laneDeficit: round(laneDeficit),
      minimumConflictingGap: Number.isFinite(minGap) ? round(minGap) : null,
      requestedEdgeGap: s.edgeGap,
      blocked: rs.filter(r => r.blocked).length,
      bends: rs.reduce((n, r) => n + Math.max(0, r.points.length - 2), 0),
      length: round(
        rs.reduce((n, r) => n + segments(r.points).reduce((v, [a, b]) => v + distance(a, b), 0), 0),
      ),
    };
  };
  const total = (rs: Route[]) => {
    const m = metrics(rs);
    return (
      m.blocked * 1e8 +
      m.length +
      m.bends * s.bendPenalty +
      m.crossings * s.crossingPenalty +
      m.shared * s.sharedPenalty +
      m.laneDeficit * s.parallelPenalty
    );
  };
  // A route that leaves or enters by a side pointing away from its other end took the long way
  // round, often because the facing side was full when it was routed. Edges routed later may
  // have moved off since, so the improvement passes try it again.
  const far = (r: Route) => {
    if (r.from === r.to) return false;
    const ca = center(rects.get(r.from)!),
      cb = center(rects.get(r.to)!),
      v = vector[r.fromSide],
      w = vector[r.toSide];
    return (
      v.x * (cb.x - ca.x) + v.y * (cb.y - ca.y) < -0.01 ||
      w.x * (ca.x - cb.x) + w.y * (ca.y - cb.y) < -0.01
    );
  };
  return {
    rawOptions,
    facingFans,
    titleBands,
    began,
    s,
    rects,
    groups,
    near,
    ancestors,
    previous,
    edges,
    state,
    opened,
    syncOpen,
    beyond,
    crowdedSide,
    flowOf,
    scores,
    obsFor,
    metrics,
    total,
    far,
  };
}
export type Context = ReturnType<typeof createContext>;
