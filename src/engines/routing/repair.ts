import { conflicts } from './conflicts.ts';
import type { Context } from './context.ts';
import { standoffCost } from './cost.ts';
import { find } from './find.ts';
import { center, inflate, segments } from './geometry.ts';
import { offsetKey, port, sideKey } from './ports.ts';
import { FAN_GROUP, MAX_REPAIRS, REPAIR_EDGES } from './tuning.ts';
import type { End, Obstacle, Pin, Route, RouteEdge } from './types.ts';

/** One end of a route of the group a fan repair routes again: the route's index and the end. */
type Fanned = { q: number; end: End };

/**
 * Edges are routed one at a time, so a crossing priced when the later edge was routed is never
 * repaired: moving either line alone costs more than the crossing. Try each crossing pair
 * together: route one with the other's line as a wall, then the other round it, and keep the
 * pair when the drawing as a whole costs less (NEXT.md item 9, R6).
 * Returns how many pairs it rerouted.
 */
export function repair(ctx: Context) {
  const { rawOptions, facingFans, s, near, rects, edges, state, metrics, total, far, syncOpen } =
    ctx;
  let repaired = 0;
  if (!rawOptions.quick && facingFans && edges.length <= REPAIR_EDGES) {
    // A repair buys its crossing with length or bends, never with a line that reads backwards:
    // into a box from below, out of or into a far side, or a U-turn (FEEL.md: never arrive from
    // below; a loop round the outside is worse than one crossing).
    const backwards = (r: Route) =>
      r.toSide === 'bottom' || far(r) || (r.fromSide === r.toSide && r.points.length > 3);
    // Lines along a box or a group border cost here as they do when routed.
    const value = (rs: Route[]) =>
      total(rs) + rs.reduce((n, r) => n + standoffCost(r.points, near), 0);
    // A route as a wall: each segment a sliver half a lane wide each way. Segments at an end the
    // two edges share stay open, so a fan off one side can still leave beside it.
    const wallOf = (r: Route, e: RouteEdge): Obstacle[] => {
      const ends = new Set([e.from, e.to]),
        segs = segments(r.points);
      return segs
        .filter(
          (_, k) => !(k === 0 && ends.has(r.from)) && !(k === segs.length - 1 && ends.has(r.to)),
        )
        .map(([a, b]) =>
          inflate(
            {
              x: Math.min(a.x, b.x),
              y: Math.min(a.y, b.y),
              w: Math.abs(a.x - b.x),
              h: Math.abs(a.y - b.y),
            },
            s.edgeGap / 2,
          ),
        );
    };
    const byId = new Map(edges.map(e => [e.id, e])),
      fixed = (e: RouteEdge) =>
        (e.cfg.waypoints?.length as number) > 0 || state.fixedPlans.has(e.id);
    // Two lines that cross where they share a box side often hold its ports out of order: the line
    // from farther along took a middle port because it was routed last. Route the pair and every
    // line beside them again, with the ports on each side they share in the order of their far
    // ends, so the fan nests.
    const both: End[] = ['from', 'to'],
      sideOf = (r: Route, end: End) => r[end] + '|' + r[sideKey(end)];
    const fanTries = (i: number, j: number): Route[][] => {
      const sides = new Set(
        [state.routes[i], state.routes[j]].flatMap(r => both.map(end => sideOf(r, end))),
      );
      const group = state.routes.flatMap((r, q) =>
        q === i || q === j || (r.from !== r.to && both.some(end => sides.has(sideOf(r, end))))
          ? [q]
          : [],
      );
      // A line to a code range keeps its port at the range, so its fan is not reordered.
      const held = (e: RouteEdge) =>
        fixed(e) || e.cfg.fromAt !== undefined || e.cfg.toAt !== undefined;
      if (group.length > FAN_GROUP || group.some(q => held(byId.get(state.routes[q].id)!)))
        return [];
      const at = new Map<string, Fanned[]>();
      for (const q of group)
        for (const end of both) {
          const key = sideOf(state.routes[q], end);
          if (!at.has(key)) at.set(key, []);
          at.get(key)!.push({ q, end });
        }
      const pins = new Map<number, Partial<Record<End, Pin>>>(group.map(q => [q, {}]));
      let moved = false;
      for (const list of at.values()) {
        if (list.length < 2) continue;
        const side = state.routes[list[0].q][sideKey(list[0].end)],
          axis = side === 'left' || side === 'right' ? 'y' : 'x',
          offset = ({ q, end }: Fanned) => state.routes[q][offsetKey(end)],
          far = ({ q, end }: Fanned) =>
            center(rects.get(state.routes[q][end === 'from' ? 'to' : 'from'])!)[axis],
          offsets = list.map(offset).sort((a, b) => a - b);
        [...list]
          .sort((a, b) => far(a) - far(b) || offset(a) - offset(b))
          .forEach((x, n) => {
            if (offsets[n] !== offset(x)) moved = true;
            pins.get(x.q)![x.end] = { side, offset: offsets[n] };
          });
      }
      if (!moved) return [];
      // Routed in turn, each line takes the track it likes best and the next goes round it. The
      // line that leaves farthest along its side should take the track nearest the far box, so
      // the group also goes in the order of its start ports, both ways for a fan that turns up
      // or down.
      const rest = state.routes.filter((_, q) => !group.includes(q)),
        start = (q: number) => {
          const r = state.routes[q],
            pin = pins.get(q)!.from,
            p = pin ? port(rects.get(r.from)!, pin.side, pin.offset) : r.points[0];
          return r.fromSide === 'left' || r.fromSide === 'right' ? p.y : p.x;
        },
        byStart = [...group].sort((a, b) => start(a) - start(b) || a - b),
        orders = new Map(
          [group, [...group].reverse(), byStart, [...byStart].reverse()].map(o => [o.join(), o]),
        );
      return [...orders.values()].map(order => {
        const t = [...state.routes],
          done: Route[] = [];
        for (const q of order) {
          const e = byId.get(state.routes[q].id)!,
            r = find(ctx, { ...e, pin: pins.get(q) }!, [...rest, ...done], state.routes[q]);
          if (r.blocked) return state.routes;
          t[q] = r;
          done.push(r);
        }
        return t;
      });
    };
    const tried = new Set();
    for (let sweep = 0; sweep < 2; sweep++) {
      let changed = false;
      for (let i = 0; i < state.routes.length; i++)
        for (let j = i + 1; j < state.routes.length; j++) {
          if (!conflicts(state.routes[i].points, [state.routes[j]]).crossings) continue;
          const key = state.routes[i].id + '|' + state.routes[j].id;
          if (tried.has(key) || tried.size >= MAX_REPAIRS) continue;
          tried.add(key);
          let best = null as Route[] | null,
            bestValue = value(state.routes) - 0.1;
          const consider = (t: Route[]) => {
            if (
              t.some(
                (r, q) => r !== state.routes[q] && backwards(r) && !backwards(state.routes[q]),
              ) ||
              metrics(t).crossings >= metrics(state.routes).crossings
            )
              return;
            const v = value(t);
            if (v < bestValue) {
              best = t;
              bestValue = v;
            }
          };
          for (const [m, k] of [
            [i, j],
            [j, i],
          ]) {
            const em = byId.get(state.routes[m].id)!,
              ek = byId.get(state.routes[k].id)!;
            if (fixed(em)) continue;
            const rest = state.routes.filter((_, q) => q !== m && q !== k),
              tries = [],
              moved = find(
                ctx,
                em,
                [...rest, state.routes[k]],
                state.routes[m],
                wallOf(state.routes[k], em),
              );
            if (!moved.blocked) {
              const one = [...state.routes];
              one[m] = moved;
              tries.push(one);
              if (!fixed(ek)) {
                const two = [...one];
                two[k] = find(ctx, ek, [...rest, moved], state.routes[k]);
                tries.push(two);
              }
            }
            // Or in the other order: `k` first, as if `m` were not there, then `m` round it.
            if (!fixed(ek)) {
              const first = find(ctx, ek, rest, state.routes[k]),
                then = find(ctx, em, [...rest, first], state.routes[m], wallOf(first, em));
              if (!then.blocked) {
                const swap = [...state.routes];
                swap[k] = first;
                swap[m] = then;
                tries.push(swap);
              }
            }
            for (const t of tries) consider(t);
          }
          // The fan's order is the last resort: a pair that moves alone draws fewer changes.
          if (!best) for (const t of fanTries(i, j)) consider(t);
          if (best) {
            state.routes = best;
            syncOpen();
            repaired++;
            changed = true;
          }
        }
      if (!changed) break;
    }
  }
  return repaired;
}
