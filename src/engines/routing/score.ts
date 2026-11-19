import { conflicts, parallelConflicts, siblingDeficit } from './conflicts.ts';
import type { Context } from './context.ts';
import { costOf, ownCost, standoffCost } from './cost.ts';
import { center, EPS, insideLength, pathLength, SIDES, vector } from './geometry.ts';
import { sideKey, TIGHT_PITCH } from './ports.ts';
import {
  ARRIVE_BELOW,
  ARRIVE_RIGHT,
  AXIS_PENALTY,
  BACK_IN,
  BACK_OUT,
  BACK_PENALTY,
  BOUND_SLACK,
  DETOUR_WEIGHT,
  FAN_PITCH,
  FAR_PENALTY,
  HOOK_PENALTY,
  LEADING,
  LEAVE_BACK,
  LINGER_WEIGHT,
  OWN_STANDOFF,
  TRAILING,
} from './tuning.ts';
import type { Candidate, End, Point, PriorRoute, Rect, Route, RouteEdge, Side } from './types.ts';

/**
 * The score of a candidate route of edge `e` against the routed lines `used`: length, bends,
 * standoff, crossings and lane conflicts, plus what its sides cost (far sides, conventions, fans,
 * the layout's direction, a change from `old`). `from` and `to` are the sides the edge may use.
 */
export function createScorer(
  ctx: Context,
  e: RouteEdge,
  used: Route[],
  old: PriorRoute | null | undefined,
  from: Side[],
  to: Side[],
) {
  const { rects, groups, s, near, facingFans, ancestors, flowOf, crowdedSide, beyond } = ctx,
    a = rects.get(e.from)!,
    b = rects.get(e.to)!,
    ca = center(a),
    cb = center(b);
  // A forward edge in a layout with a declared reading direction leaves its source's
  // trailing side and enters its target's leading side (bottom → top going down), so
  // it reads as parent → child. A side across the flow costs `AXIS_PENALTY`, more than the
  // standoff or fan-out a clean Z pays, so it wins only when the axis sides are blocked; a
  // backward side costs `BACK_PENALTY`.
  const flow = flowOf(e);
  const along = flow === 'down' ? cb.y - ca.y : cb.x - ca.x,
    forward = flow && e.from !== e.to && along > 20,
    axis = (c: Candidate) =>
      forward
        ? (c.fs === TRAILING[flow]
            ? 0
            : BACK_OUT[flow].includes(c.fs)
              ? BACK_PENALTY
              : AXIS_PENALTY) +
          (c.ts === LEADING[flow] ? 0 : BACK_IN[flow].includes(c.ts) ? BACK_PENALTY : AXIS_PENALTY)
        : 0,
    onAxis = (side: Side, end: End) =>
      forward && side === (end === 'from' ? TRAILING : LEADING)[flow];
  // A line that leaves a box and turns to run alongside it, just past the stub, reads as
  // hugging its own box. Runs beside the edge's own ends pay the standoff again.
  const own = facingFans ? near.filter(r => !r.border && (r.id === e.from || r.id === e.to)) : [];
  // Ports already on side `side` of node `id`, from this edge's end of the fan.
  const taken = (id: string, side: Side, end: End) =>
    used.filter(r => r[end] === id && r[sideKey(end)] === side).length;
  // A side faces the other end when it points toward it. A fan spreads along a
  // facing side for free until the side runs out of port slots (`slot` spacing),
  // and only then pays the fan-out penalty that pushes it round to another side.
  const facing = (side: Side, from: Point, to: Point) =>
    vector[side].x * (to.x - from.x) + vector[side].y * (to.y - from.y) > 0.01;
  // A facing side holds its fan at `TIGHT_PITCH` once full spacing runs out.
  const roomy = (side: Side, r: Rect, n: number) => {
    const span = (side === 'left' || side === 'right' ? r.h : r.w) - 24,
      pitch = facingFans
        ? Math.min(TIGHT_PITCH, Math.max(s.portGap, s.edgeGap))
        : Math.max(s.portGap, s.edgeGap);
    return n < 1 + 2 * Math.floor(span / 2 / pitch + EPS);
  };
  function fan(side: Side, r: Rect, from: Point, to: Point, end: End, id: string) {
    const n = taken(id, side, end);
    if (!n || (end === 'from' ? onAxis(side, 'from') : onAxis(side, 'to'))) return 0;
    if (facingFans && facing(side, from, to) && roomy(side, r, n)) return 0;
    return n * s.fanoutPenalty;
  }
  // Route length beyond the gap between the two boxes, which no route can avoid.
  const floor =
    Math.max(0, Math.abs(ca.x - cb.x) - (a.w + b.w) / 2) +
    Math.max(0, Math.abs(ca.y - cb.y) - (a.h + b.h) / 2);
  const excess = (points: Point[]) => Math.max(0, pathLength(points) - floor);
  // Containers that hold one end but not the other: the line should leave (or enter) them by
  // the short way and run outside, not along their inside to reach something beyond.
  const passing = facingFans
    ? [
        ...ancestors(e.from)
          .filter(g => !ancestors(e.to).includes(g))
          .map(g => ({ g: groups.get(g), box: a })),
        ...ancestors(e.to)
          .filter(g => !ancestors(e.from).includes(g))
          .map(g => ({ g: groups.get(g), box: b })),
      ].filter(p => p.g && !p.g.collapsed)
    : [];
  // Run inside each such container beyond the shortest way between the box and its border.
  const lingering = (points: Point[]) =>
    passing.reduce((sum, { g, box }) => {
      const shortest = Math.min(
        box.x - g!.x,
        g!.x + g!.w - (box.x + box.w),
        box.y - g!.y,
        g!.y + g!.h - (box.y + box.h),
      );
      return sum + Math.max(0, insideLength(points, g!) - Math.max(0, shortest));
    }, 0);
  // `bound`: the score a candidate must beat. One whose cheap terms already reach it returns
  // Infinity without the line-against-line checks, which take most of the routing time.
  // `floor`: return 0 once the cheap terms fall below `bound`, without the rest.
  function score(points: Point[], c: Candidate, bound = Infinity, floor = false) {
    const v = vector[c.fs],
      w = vector[c.ts],
      delta = { x: cb.x - ca.x, y: cb.y - ca.y };
    // Leaving or arriving by a far side (one that points away from the other end)
    // draws a hook round the box; it is worth a detour only when the facing sides
    // are blocked.
    const far = facingFans ? FAR_PENALTY : 18;
    const awayOut = v.x * delta.x + v.y * delta.y < -0.01,
      awayIn = w.x * -delta.x + w.y * -delta.y < -0.01;
    // A far side also pays for the loop it draws: the length beyond the shortest way between
    // the boxes, so a line into a box's back from round the far side of a group loses to a
    // crossing (NEXT.md item 1).
    // Only a side the router chose pays it; a side the file fixed is the author's call.
    const detour =
      facingFans && ((awayOut && from.length > 1) || (awayIn && to.length > 1))
        ? DETOUR_WEIGHT * excess(points)
        : 0;
    const backwards = (awayOut ? far : 0) + (awayIn ? far : 0) + detour;
    // Diagrams read left to right and top to bottom: lines arrive on a box's left or top and
    // leave by its right or bottom. Arriving from below costs most; it reads as backwards.
    const convention = facingFans
      ? (c.ts === 'bottom' ? ARRIVE_BELOW : 0) +
        (c.ts === 'right' ? ARRIVE_RIGHT : 0) +
        (c.fs === 'top' || c.fs === 'left' ? LEAVE_BACK : 0)
      : 0;
    const stability = old
      ? (c.fs !== old.fromSide ? s.portStability : 0) + (c.ts !== old.toSide ? s.portStability : 0)
      : 0;
    // Fan-out depends on the side pair alone, so it is worked out once per candidate.
    const fanout = (c.fanout ??=
      fan(c.fs, a, ca, cb, 'from', e.from) + fan(c.ts, b, cb, ca, 'to', e.to));
    // Out of one side and back into the same side of the other end: a U-turn, which a line
    // into a perpendicular side draws with one bend fewer.
    const hook = facingFans && c.fs === c.ts && points.length > 3 ? HOOK_PENALTY : 0;
    // Every term left out here is at least zero, except `packed`'s sibling credit, which the
    // lane deficit in `cost` always covers (to its rounding: `BOUND_SLACK`).
    if (
      ownCost(points, s) +
        backwards +
        convention +
        hook +
        stability +
        fanout +
        axis(c) -
        BOUND_SLACK >=
      bound
    )
      return Infinity;
    if (floor) return 0;
    // A fan planned at `TIGHT_PITCH` keeps to its side: leaving by another side costs, and
    // the close pitch to its siblings there is the plan, not a lane conflict.
    let packed = 0;
    for (const [end, id, other, side] of facingFans
      ? [['from', e.from, e.to, c.fs] as const, ['to', e.to, e.from, c.ts] as const]
      : []) {
      if (id === other) continue;
      const siblings = used.filter(q => q[end] === id && q[sideKey(end)] === side);
      const want =
        end === 'from' && !e.label
          ? SIDES.filter(x => crowdedSide(id, x) && beyond(id, other, x))
          : [];
      if (want.length && !want.includes(side)) packed += 2 * s.fanoutPenalty;
      // Lines fanning out of (or into) one side nest in the gap beside it. Siblings closer than
      // the edge gap but still apart (`FAN_PITCH`) are the fan's shape, not a lane conflict:
      // charging them pushed a tree's third child out of its parent's side. A fan planned at
      // `TIGHT_PITCH` is that close by design.
      packed -=
        siblingDeficit(points, siblings, want.includes(side) ? 0 : FAN_PITCH, s.edgeGap) *
        s.parallelPenalty;
    }
    // The line-against-line terms come last, each only while the sum so far stays under
    // `bound`: every term is at least zero, `packed` aside, which is already in the sum.
    const linger = LINGER_WEIGHT * lingering(points),
      ownStandoff = own.length ? standoffCost(points, own) * OWN_STANDOFF : 0,
      sides = backwards + convention + hook + stability + fanout + axis(c),
      over = (sum: number) => bound < Infinity && sum - 1e-6 >= bound;
    let sum = ownCost(points, s) + linger + packed + ownStandoff + sides;
    if (over(sum)) return Infinity;
    const standoff = near.length ? standoffCost(points, near, bound - sum + 1e-3) : 0;
    if (over((sum += standoff))) return Infinity;
    const crossed = conflicts(points, used, bound - sum + 1e-3, s);
    if (over(sum + crossed.crossings * s.crossingPenalty + crossed.shared * s.sharedPenalty))
      return Infinity;
    const lanes = parallelConflicts(points, used, s.edgeGap).laneDeficit;
    // The same sum as before the early returns, term for term, so scores do not drift.
    return (
      linger +
      packed +
      costOf(points, s, standoff, crossed, lanes) +
      ownStandoff +
      backwards +
      convention +
      hook +
      stability +
      fanout +
      axis(c)
    );
  }
  const sideFloor = (c: Candidate) => {
    const delta = { x: cb.x - ca.x, y: cb.y - ca.y },
      v = vector[c.fs],
      w = vector[c.ts],
      far = facingFans ? FAR_PENALTY : 18;
    return (
      (v.x * delta.x + v.y * delta.y < -0.01 ? far : 0) +
      (w.x * -delta.x + w.y * -delta.y < -0.01 ? far : 0) +
      (facingFans
        ? (c.ts === 'bottom' ? ARRIVE_BELOW : 0) +
          (c.ts === 'right' ? ARRIVE_RIGHT : 0) +
          (c.fs === 'top' || c.fs === 'left' ? LEAVE_BACK : 0)
        : 0) +
      (old && c.fs !== old.fromSide ? s.portStability : 0) +
      (old && c.ts !== old.toSide ? s.portStability : 0) +
      (c.fanout ??= fan(c.fs, a, ca, cb, 'from', e.from) + fan(c.ts, b, cb, ca, 'to', e.to)) +
      axis(c) -
      BOUND_SLACK -
      1
    );
  };
  return { axis, score, sideFloor };
}
