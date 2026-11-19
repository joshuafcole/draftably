import type { Context } from './context.ts';
import { standoffCost } from './cost.ts';
import { center, clone, compress, distance, EPS, round, segments } from './geometry.ts';
import { validPath } from './paths.ts';
import { offsetKey, port, sideKey } from './ports.ts';
import { centrePorts, ends, flat, tip, type Attempt } from './tidy-ports.ts';
import { PORT_SLACK } from './tuning.ts';
import type { Axis, End, Obstacle, Point, Route, RouteEdge, Side } from './types.ts';

/**
 * Tidy: make routes look drafted on purpose. Ports on a side sit symmetrically
 * about its centre, edges fanning from one side turn on one line, and parallel
 * runs in a corridor keep one pitch. A move stands only when every moved route
 * stays valid and nothing gets worse: no crossing, shared run, lane conflict,
 * short step or standoff cost is added.
 * Returns how many moves stood.
 */
export function tidy(ctx: Context) {
  const { rawOptions, s, near, rects, edges, state, obsFor, metrics } = ctx;
  let tidied = 0;
  const byId = new Map(edges.map(e => [e.id, e])),
    obsCache = new Map<string, Obstacle[]>(),
    obsOf = (e: RouteEdge) => {
      if (!obsCache.has(e.id)) obsCache.set(e.id, obsFor(e));
      return obsCache.get(e.id)!;
    },
    steps = (ps: Point[]) =>
      segments(ps)
        .slice(1, -1)
        .filter(([a, b]) => distance(a, b) < 12).length;
  // Whether `p` lies on the polyline `ps`.
  const onPath = (p: Point, ps: Point[]) =>
    segments(ps).some(
      ([a, b]) =>
        (Math.abs(a.x - b.x) < EPS &&
          Math.abs(p.x - a.x) < EPS &&
          p.y > Math.min(a.y, b.y) - EPS &&
          p.y < Math.max(a.y, b.y) + EPS) ||
        (Math.abs(a.y - b.y) < EPS &&
          Math.abs(p.y - a.y) < EPS &&
          p.x > Math.min(a.x, b.x) - EPS &&
          p.x < Math.max(a.x, b.x) + EPS),
    );
  // `throughWaypoints` lets a waypoint route change when it still passes every waypoint.
  // Runs alongside a box side, outside it and closer than a stub (clearance + 3), for longer
  // than a port gap.
  const boxes = [...rects.values()],
    hugs = (ps: Point[]) => {
      let n = 0;
      for (const [a, b] of segments(ps)) {
        const h = Math.abs(a.y - b.y) < EPS;
        if (!h && Math.abs(a.x - b.x) >= EPS) continue;
        const at = h ? a.y : a.x,
          lo = h ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
          hi = h ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
        for (const r of boxes) {
          const s0 = h ? r.y : r.x,
            s1 = h ? r.y + r.h : r.x + r.w,
            run = Math.min(hi, h ? r.x + r.w : r.y + r.h) - Math.max(lo, h ? r.x : r.y),
            d = at < s0 ? s0 - at : at > s1 ? at - s1 : -1;
          if (run > s.portGap && d > EPS && d < s.clearance + 5) n++;
        }
      }
      return n;
    };
  const attempt: Attempt = (changes, extra = {}, throughWaypoints = false, slack = 0.5) => {
    const next = state.routes.map((r, i) =>
      changes.has(i) ? { ...r, ...extra[i], points: compress(changes.get(i)!) } : r,
    );
    for (const i of changes.keys()) {
      const r = next[i],
        e = byId.get(r.id)!,
        waypoints = e.cfg.waypoints || [];
      // Planned state.routes keep their ports and tracks.
      if (state.fixedPlans.has(r.id)) return false;
      // Waypoint state.routes stay as authored, as in the nudge pass.
      if (waypoints.length && !(throughWaypoints && waypoints.every(p => onPath(p, r.points))))
        return false;
      if (!validPath(r.points, e, r.fromSide, r.toSide, obsOf(e))) return false;
      if (steps(r.points) > steps(state.routes[i].points)) return false;
    }
    const m0 = metrics(state.routes),
      m1 = metrics(next);
    if (
      m1.crossings > m0.crossings ||
      m1.shared > m0.shared + 0.01 ||
      m1.lanePairs > m0.lanePairs ||
      m1.laneDeficit > m0.laneDeficit + 0.1
    )
      return false;
    let before = 0,
      after = 0;
    for (const i of changes.keys()) {
      before += standoffCost(state.routes[i].points, near);
      after += standoffCost(next[i].points, near);
    }
    if (after > before + slack) return false;
    // Slack never buys a new hug: a run closer than a stub's length to a box beside it.
    if (slack > 0.5) {
      let h0 = 0,
        h1 = 0;
      for (const i of changes.keys()) {
        h0 += hugs(state.routes[i].points);
        h1 += hugs(next[i].points);
      }
      if (h1 > h0) return false;
    }
    state.routes = next;
    tidied++;
    return true;
  };

  centrePorts(ctx, attempt);

  // Fans: edges leaving (or entering) one side turn on a shared line.
  const fans = new Map<string, number[]>();
  state.routes.forEach((r, i) => {
    if (r.points.length < 4) return;
    for (const end of ends) {
      const key = r[end] + '|' + end + '|' + r[sideKey(end)];
      if (!fans.has(key)) fans.set(key, []);
      fans.get(key)!.push(i);
    }
  });
  for (const [key, list] of fans) {
    if (list.length < 2) continue;
    const [, end, side] = key.split('|') as [string, End, Side],
      axis = side === 'left' || side === 'right' ? 'x' : 'y',
      turn = (i: number) => round(tip(state.routes[i].points, end, 1)[axis]),
      values = [...new Set(list.map(turn))];
    if (values.length < 2) continue;
    const spread = (t: number) => list.reduce((n, i) => n + Math.abs(turn(i) - t), 0);
    values.sort((a, b) => spread(a) - spread(b) || a - b);
    for (const t of values) {
      const changes = new Map<number, Point[]>();
      for (const i of list) {
        if (turn(i) === t) continue;
        const ps = clone(state.routes[i].points);
        tip(ps, end, 1)[axis] = t;
        tip(ps, end, 2)[axis] = t;
        changes.set(i, ps);
      }
      if (attempt(changes)) break;
    }
  }

  // Jogs: a step under 12px between two parallel runs straightens by sliding one run onto
  // the other's line. A run that ends at a port slides the port too, when its side has room
  // and no other port sits there.
  if (rawOptions.jogs !== false)
    for (let i = 0; i < state.routes.length; i++) {
      const separation = Math.max(s.portGap, s.edgeGap);
      // Slide the run of segment `j` to `value` on `axis`; null when its port can't follow.
      const slide = (ps: Point[], j: number, axis: Axis, value: number) => {
        const next = clone(ps),
          extra: Partial<Route> = {};
        next[j][axis] = value;
        next[j + 1][axis] = value;
        for (const [k, end] of [
          [j, 'from'],
          [j + 1, 'to'],
        ] as Array<[number, End]>) {
          if (k !== (end === 'from' ? 0 : ps.length - 1)) continue;
          const id = state.routes[i][end],
            side = state.routes[i][sideKey(end)],
            rect = rects.get(id);
          if (!rect || !flat(rect) || (side === 'left' || side === 'right') !== (axis === 'y'))
            return null;
          const offset = round(value - center(rect)[axis]);
          if (Math.abs(offset) > (axis === 'y' ? rect.h : rect.w) / 2 - 10 + EPS) return null;
          const crowded = state.routes.some((q, m) =>
            ends.some(
              e2 =>
                (m !== i || e2 !== end) &&
                q[e2] === id &&
                q[sideKey(e2)] === side &&
                Math.abs(tip(q.points, e2)[axis] - value) < separation - 0.01,
            ),
          );
          if (crowded) return null;
          Object.assign(next[k], port(rect, side, offset));
          extra[offsetKey(end)] = offset;
        }
        return { next, extra };
      };
      const ps = state.routes[i].points;
      for (let k = 1; k < ps.length - 2; k++) {
        if (distance(ps[k], ps[k + 1]) >= 12) continue;
        // The step runs along `axis`'s other coordinate; its neighbours run across it.
        const axis = Math.abs(ps[k].x - ps[k + 1].x) < EPS ? 'y' : 'x';
        const options = [
          slide(ps, k - 1, axis, ps[k + 1][axis]),
          slide(ps, k + 1, axis, ps[k][axis]),
        ];
        if (options.some(o => o && attempt(new Map([[i, o.next]]), { [i]: o.extra }, true))) break;
      }
    }

  centrePorts(ctx, attempt);

  // Centre: an inner run between two sides (boxes or group borders) slides to the middle
  // of that corridor, so it never hugs one side. Wide-open space leaves a run where it is.
  const sidesAcross = (h: boolean, at: number, lo: number, hi: number) => {
    let below = -Infinity,
      above = Infinity;
    for (const r of near) {
      const run = Math.min(hi, h ? r.x + r.w : r.y + r.h) - Math.max(lo, h ? r.x : r.y);
      if (run <= 1) continue;
      for (const v of h ? [r.y, r.y + r.h] : [r.x, r.x + r.w]) {
        // A box's inside is never a corridor: only borders count from both sides.
        if (!r.border && v === (h ? r.y + r.h : r.x + r.w) && at < v - EPS) continue;
        if (!r.border && v === (h ? r.y : r.x) && at > v + EPS) continue;
        if (v <= at + EPS) below = Math.max(below, v);
        if (v >= at - EPS) above = Math.min(above, v);
      }
    }
    return [below, above];
  };
  for (let i = 0; i < state.routes.length; i++)
    for (let k = 1; k < state.routes[i].points.length - 2; k++) {
      const ps = state.routes[i].points,
        a = ps[k],
        b = ps[k + 1],
        h = Math.abs(a.y - b.y) < EPS,
        axis = h ? 'y' : 'x',
        along = h ? 'x' : 'y';
      if (distance(a, b) <= 12) continue;
      const [below, above] = sidesAcross(
          h,
          a[axis],
          Math.min(a[along], b[along]),
          Math.max(a[along], b[along]),
        ),
        width = above - below,
        mid = round((below + above) / 2);
      if (!(width <= 4 * s.standoff) || Math.abs(mid - a[axis]) < 1) continue;
      const next = clone(ps);
      next[k][axis] = mid;
      next[k + 1][axis] = mid;
      // As for ports, centring is worth a little standoff; the slack never buys a hug.
      attempt(new Map([[i, next]]), {}, false, PORT_SLACK);
    }

  // Corridors: parallel inner runs close together keep one pitch.
  const pitch = s.edgeGap;
  for (const h of [true, false]) {
    const axis = h ? 'y' : 'x',
      along = h ? 'x' : 'y',
      runs: Array<{ i: number; k: number; at: number; lo: number; hi: number }> = [];
    state.routes.forEach((r, i) =>
      segments(r.points).forEach(([a, b], k) => {
        if (k === 0 || k === r.points.length - 2 || distance(a, b) <= 12) return;
        if (Math.abs(a.y - b.y) < EPS !== h) return;
        runs.push({
          i,
          k,
          at: round(a[axis]),
          lo: Math.min(a[along], b[along]),
          hi: Math.max(a[along], b[along]),
        });
      }),
    );
    runs.sort((a, b) => a.at - b.at);
    for (let j = 1; j < runs.length; j++) {
      const run = runs[j],
        prev = runs
          .slice(0, j)
          .filter(
            q =>
              q.i !== run.i && q.at < run.at && Math.min(q.hi, run.hi) - Math.max(q.lo, run.lo) > 1,
          )
          .at(-1);
      if (!prev) continue;
      const gap = run.at - prev.at;
      if (Math.abs(gap - pitch) <= 1 || gap > 2.5 * pitch) continue;
      const target = round(prev.at + pitch),
        ps = clone(state.routes[run.i].points);
      if (Math.abs(ps[run.k][axis] - run.at) > EPS || Math.abs(ps[run.k + 1][axis] - run.at) > EPS)
        continue;
      ps[run.k][axis] = target;
      ps[run.k + 1][axis] = target;
      if (attempt(new Map([[run.i, ps]]))) run.at = target;
    }
  }
  return tidied;
}
