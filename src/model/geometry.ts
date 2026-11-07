import type { Point, Rect } from './types';

export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** Document coordinates are stored with one decimal place. */
export const rounded = (n: number) => Math.round(n * 10) / 10;

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const manhattan = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const inside = (p: Point, r: Rect, pad = 0) =>
  p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

export const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export const contains = (outer: Rect, inner: Rect) =>
  inside({ x: inner.x, y: inner.y }, outer) &&
  inside({ x: inner.x + inner.w, y: inner.y + inner.h }, outer);

export const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/** Bounding box of the given rectangles, or a placeholder area when there are none. */
export function rectUnion(rects: readonly Rect[], pad = 0): Rect {
  if (!rects.length) return { x: 70, y: 160, w: 240, h: 160 };
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.w);
    bottom = Math.max(bottom, r.y + r.h);
  }
  return { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2 };
}

/** Rectangle spanned by two corner points. */
export const rectFromPoints = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});

export type Segment = [Point, Point];

export const segments = (points: readonly Point[]): Segment[] =>
  points.slice(1).map((p, i) => [points[i], p]);
export const shrink = (r: Rect, d: number): Rect => ({
  x: r.x + d,
  y: r.y + d,
  w: r.w - 2 * d,
  h: r.h - 2 * d,
});
/** Overlap of two rectangles larger than half a pixel on both axes. */
export const covers = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;

/** Length of a segment inside a rectangle (Liang–Barsky clipping). */
export function segmentInside([a, b]: Segment, r: Rect) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let t0 = 0,
    t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ]) {
    if (p === 0) {
      if (q <= 0) return 0;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t1 > t0 ? (t1 - t0) * Math.hypot(dx, dy) : 0;
}

/** SVG path for an orthogonal polyline with rounded corners. */
export function roundedPath(points: readonly Point[], radius: number): string {
  if (!points.length) return '';
  let path = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      p = points[i],
      b = points[i + 1];
    const r = b ? Math.min(radius, manhattan(a, p) / 2, manhattan(p, b) / 2) : 0;
    if (!b || r === 0) {
      path += `L${p.x},${p.y}`;
      continue;
    }
    const before = { x: p.x + Math.sign(a.x - p.x) * r, y: p.y + Math.sign(a.y - p.y) * r };
    const after = { x: p.x + Math.sign(b.x - p.x) * r, y: p.y + Math.sign(b.y - p.y) * r };
    path += `L${before.x},${before.y}Q${p.x},${p.y} ${after.x},${after.y}`;
  }
  return path;
}

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * A rectangle whose left and right sides are zigzags, for a field of variable length: the reader
 * sees it continue past what is drawn.
 */
export function brokenRectPath(r: Rect, step = 8, depth = 4) {
  const n = Math.max(2, Math.round(r.h / step)),
    dy = r.h / n,
    side = (x: number, down: boolean, out: number) =>
      Array.from({ length: n }, (_, i) => {
        const k = down ? i + 1 : n - i - 1;
        return `L${x + (k % 2 ? out : 0)},${r.y + k * dy}`;
      }).join(' ');
  return (
    `M${r.x},${r.y} L${r.x + r.w},${r.y} ${side(r.x + r.w, true, depth)} ` +
    `L${r.x},${r.y + r.h} ${side(r.x, false, -depth)} Z`
  );
}
