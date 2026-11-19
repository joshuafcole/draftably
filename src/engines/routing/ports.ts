import { center, clamp, EPS, round } from './geometry.ts';
import type { End, Point, Rect, Route, RoutingSettings, ShapeKind, Side } from './types.ts';

/** The fields of a route that hold the side and the offset of one end. */
export const sideKey = (end: End) => (end + 'Side') as `${End}Side`;
export const offsetKey = (end: End) => (end + 'Offset') as `${End}Offset`;

/** The point on `side` of a shape, `offset` along it from the middle, on the shape's outline. */
export function port(rect: Rect & { shape?: ShapeKind }, side: Side, offset = 0): Point {
  const r = rect,
    shape = r.shape || 'box';
  let x = r.x + r.w / 2,
    y = r.y + r.h / 2;
  if (side === 'left' || side === 'right') {
    y += clamp(offset, -r.h / 2 + 10, r.h / 2 - 10);
    let inset = 0;
    if (['circle', 'icon', 'pill'].includes(shape)) {
      const radius = shape === 'pill' ? Math.min(r.h / 2, r.w / 2) : r.w / 2;
      inset = radius * (1 - Math.sqrt(Math.max(0, 1 - ((y - r.y - r.h / 2) / (r.h / 2)) ** 2)));
    }
    if (shape === 'diamond') inset = (Math.abs(y - r.y - r.h / 2) * r.w) / r.h;
    x = side === 'left' ? r.x + inset : r.x + r.w - inset;
  } else {
    x += clamp(offset, -r.w / 2 + 10, r.w / 2 - 10);
    let inset = 0;
    if (['circle', 'icon'].includes(shape))
      inset = (r.h / 2) * (1 - Math.sqrt(Math.max(0, 1 - ((x - r.x - r.w / 2) / (r.w / 2)) ** 2)));
    if (shape === 'pill') {
      const radius = Math.min(r.h / 2, r.w / 2),
        beyond = Math.max(0, Math.abs(x - r.x - r.w / 2) - (r.w / 2 - radius));
      inset = radius - Math.sqrt(Math.max(0, radius * radius - beyond * beyond));
    }
    if (shape === 'diamond') inset = (Math.abs(x - r.x - r.w / 2) * r.h) / r.w;
    y = side === 'top' ? r.y + inset : r.y + r.h - inset;
  }
  return { x: round(x), y: round(y) };
}
// A full fan's pitch: closer than the port gap, still clear of `edges-too-close` (< 10px).
export const TIGHT_PITCH = 12;
// `tight`: more edges face this side than it has full-gap slots, so its fan takes `TIGHT_PITCH`
// from the first port on. Handing the tight slots out from the start keeps the fan nested:
// the nearer ends take the middle slots and the farther ones the outer slots.
export function slot(
  id: string,
  side: Side,
  r: Rect,
  used: Route[],
  s: RoutingSettings,
  other: Rect,
  tight = false,
  spread = true,
) {
  const vertical = side === 'left' || side === 'right',
    span = (vertical ? r.h : r.w) - 24,
    cross = vertical ? 'y' : 'x',
    desired = center(other)[cross] - center(r)[cross];
  const separation = tight
    ? Math.min(TIGHT_PITCH, Math.max(s.portGap, s.edgeGap))
    : Math.max(s.portGap, s.edgeGap);
  const occupied: number[] = [];
  for (const q of used) {
    if (q.from === id && q.fromSide === side) occupied.push(q.fromOffset);
    if (q.to === id && q.toSide === side) occupied.push(q.toOffset);
  }
  const options = [0];
  for (let i = 1; i <= 16; i++)
    for (const sign of [1, -1])
      if (i * separation <= span / 2 + EPS) options.push(sign * i * separation);
  options.sort((a, b) => Math.abs(a) - Math.abs(b) || (desired < 0 ? a - b : b - a));
  for (const n of options) if (occupied.every(v => Math.abs(n - v) >= separation - 0.01)) return n;
  // A full side packs its fan tighter, at `TIGHT_PITCH`, before it gives up on spacing.
  if (spread && !tight && TIGHT_PITCH < separation) {
    const pitch = TIGHT_PITCH,
      closer: number[] = [];
    for (let i = 1; i <= 16; i++)
      for (const sign of [1, -1]) if (i * pitch <= span / 2 + EPS) closer.push(sign * i * pitch);
    closer.sort((a, b) => Math.abs(a) - Math.abs(b) || (desired < 0 ? a - b : b - a));
    for (const n of closer) if (occupied.every(v => Math.abs(n - v) >= pitch - 0.01)) return n;
  }
  // Crowded small sides degrade to evenly-spaced choices. Overlap is reported.
  let best = 0,
    score = -1;
  for (let n = -span / 2; n <= span / 2; n += 2) {
    const d = Math.min(...occupied.map(v => Math.abs(n - v)));
    if (d > score) {
      score = d;
      best = n;
    }
  }
  return round(best);
}
