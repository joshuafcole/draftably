import type { Context } from './context.ts';
import { center, clone, EPS, round } from './geometry.ts';
import { offsetKey, port, sideKey } from './ports.ts';
import { PORT_SLACK } from './tuning.ts';
import type { Box, End, Point, Route, Side } from './types.ts';

/** One end of a route, by the route's index. */
type PortEnd = { i: number; end: End };

/**
 * Tries a tidy move: new points for some routes, by index, with their new offsets. It stands
 * only when every moved route stays valid and nothing gets worse.
 */
export type Attempt = (
  changes: Map<number, Point[]>,
  extra?: Record<number, Partial<Route>>,
  throughWaypoints?: boolean,
  slack?: number,
) => boolean;

/** Whether a shape's sides are straight, so a port may slide along them. */
export const flat = (r: Box) => !['pill', 'circle', 'diamond', 'icon'].includes(r.shape!);
export const ends: End[] = ['from', 'to'];
/** The point `k` steps in from one end of a path. */
export const tip = (ps: Point[], end: End, k = 0) =>
  end === 'from' ? ps[k] : ps[ps.length - 1 - k];

// Ports: shift a side's ports so their mean sits on the side's centre.
// Jogs can slide a port off its side's centre, so this runs again after them.
// Whether a port at `offset` stays within 2px of the side's face at its middle. Always true
// for flat sides; on a round end it allows a small slide off the tip.
const nearTip = (r: Box, side: Side, offset: number) => {
  const across = side === 'left' || side === 'right' ? 'x' : 'y';
  return flat(r) || Math.abs(port(r, side, offset)[across] - port(r, side)[across]) <= 2;
};
export function centrePorts(ctx: Context, attempt: Attempt) {
  const { s, rects, state } = ctx;
  const sides = new Map<string, PortEnd[]>();
  state.routes.forEach((r, i) => {
    for (const end of ends) {
      const key = r[end] + '|' + r[sideKey(end)];
      if (!sides.has(key)) sides.set(key, []);
      sides.get(key)!.push({ i, end });
    }
  });
  for (const [key, list] of sides) {
    const [id, side] = key.split('|') as [string, Side],
      rect = rects.get(id)!,
      vertical = side === 'left' || side === 'right',
      axis = vertical ? 'y' : 'x',
      mid = center(rect)[axis],
      limit = (vertical ? rect.h : rect.w) / 2 - 10,
      at = [...new Set(list.map(({ i, end }) => round(tip(state.routes[i].points, end)[axis])))];
    if (at.length < 2) continue;
    const d = round(mid - at.reduce((n, v) => n + v, 0) / at.length);
    if (Math.abs(d) < 2 || at.some(v => Math.abs(v + d - mid) > limit + EPS)) continue;
    // Diamonds keep their ports on the tips; round ends allow a small slide.
    if (at.some(v => !nearTip(rect, side, v + d - mid))) continue;
    const changes = new Map<number, Point[]>(),
      extra: Record<number, Partial<Route>> = {},
      farSides = new Set<string>();
    for (const { i, end } of list) {
      const ps = clone(changes.get(i) ?? state.routes[i].points),
        offset = round(tip(ps, end)[axis] + d - mid),
        moved = port(rect, side, offset);
      Object.assign(tip(ps, end), moved);
      extra[i] = { ...extra[i], [offsetKey(end)]: offset };
      if (ps.length === 2) {
        // A straight route slides as a whole, moving its other port too.
        const other: End = end === 'from' ? 'to' : 'from',
          far = rects.get(state.routes[i][other])!,
          otherSide = state.routes[i][sideKey(other)],
          otherOffset = round(tip(ps, other)[axis] + d - center(far)[axis]);
        if (!nearTip(far, otherSide, otherOffset)) {
          changes.clear();
          break;
        }
        Object.assign(tip(ps, other), port(far, otherSide, otherOffset));
        extra[i][offsetKey(other)] = otherOffset;
        farSides.add(state.routes[i][other] + '|' + otherSide);
      } else tip(ps, end, 1)[axis] = moved[axis];
      changes.set(i, ps);
    }
    // This side alone, in case the far side's shift is rejected.
    const own = new Map(changes);
    // The far side of a slid straight line keeps its own ports centred: its bent lines
    // shift together so the side's mean stays on its middle.
    for (const fk of farSides) {
      const [fid, fside] = fk.split('|') as [string, Side],
        far = rects.get(fid)!,
        fmid = center(far)[axis],
        flimit = (vertical ? far.h : far.w) / 2 - 10,
        entries = sides.get(fk) ?? [],
        pos = ({ i, end }: PortEnd) => tip(changes.get(i) ?? state.routes[i].points, end)[axis],
        movable = entries.filter(({ i }) => !changes.has(i) && state.routes[i].points.length >= 4);
      if (!movable.length || !flat(far)) continue;
      const sum = entries.reduce((n, en) => n + pos(en), 0),
        delta = round((entries.length * fmid - sum) / movable.length);
      if (Math.abs(delta) < 2) continue;
      for (const en of movable) {
        const ps = clone(state.routes[en.i].points),
          offset = round(tip(ps, en.end)[axis] + delta - fmid);
        if (Math.abs(offset) > flimit + EPS) continue;
        Object.assign(tip(ps, en.end), port(far, fside, offset));
        tip(ps, en.end, 1)[axis] = tip(ps, en.end)[axis];
        extra[en.i] = { ...extra[en.i], [offsetKey(en.end)]: offset };
        changes.set(en.i, ps);
      }
    }
    if (!changes.size) continue;
    // A line that turns in beside the side runs alongside it a stub away; the shift can
    // lengthen that run into a hug. Turn a full standoff out instead, where the line allows.
    const across = vertical ? 'x' : 'y',
      face = { left: rect.x, right: rect.x + rect.w, top: rect.y, bottom: rect.y + rect.h }[side],
      out = side === 'left' || side === 'top' ? -1 : 1,
      widen = (moves: Map<number, Point[]>) =>
        new Map(
          [...moves].map(([i, ps]) => {
            const end = list.find(l => l.i === i)?.end,
              q = clone(ps);
            if (
              end &&
              q.length >= 4 &&
              Math.abs(tip(q, end, 1)[across] - tip(q, end, 2)[across]) < EPS &&
              Math.abs(tip(q, end, 1)[across] - face) < s.standoff
            ) {
              tip(q, end, 1)[across] = face + out * s.standoff;
              tip(q, end, 2)[across] = face + out * s.standoff;
            }
            return [i, q];
          }),
        );
    // Centring a side is worth a little standoff: a port gap's shift barely moves a line.
    for (const moves of changes.size > own.size ? [changes, own] : [own])
      if (
        attempt(widen(moves), extra, false, PORT_SLACK * moves.size) ||
        attempt(moves, extra, false, PORT_SLACK * moves.size)
      )
        break;
  }
}
