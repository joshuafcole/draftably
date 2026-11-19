import type { Point, Rect } from './types.ts';

export const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const magnitude = (x: number, y: number) => Math.hypot(x, y);
export const wait = () => new Promise(r => setTimeout(r, 0));

export function bounds(items: Rect[]): Rect {
  if (!items.length) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...items.map(p => p.x)),
    y = Math.min(...items.map(p => p.y));
  return {
    x,
    y,
    w: Math.max(1, Math.max(...items.map(p => p.x + p.w)) - x),
    h: Math.max(1, Math.max(...items.map(p => p.y + p.h)) - y),
  };
}
export const midpoint = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** How far two boxes, kept `gap` apart, reach into each other; null when they are clear. */
export interface Penetration {
  x: number;
  y: number;
  dx: number;
  dy: number;
  area: number;
}
export function penetration(a: Rect, b: Rect, gap = 0): Penetration | null {
  const ca = midpoint(a),
    cb = midpoint(b),
    x = (a.w + b.w) / 2 + gap - Math.abs(cb.x - ca.x),
    y = (a.h + b.h) / 2 + gap - Math.abs(cb.y - ca.y);
  return x > 0.01 && y > 0.01 ? { x, y, dx: cb.x - ca.x, dy: cb.y - ca.y, area: x * y } : null;
}
/** A fixed number in [0, 1) for an ID: FNV-1a. It stands in for a random start. */
export function hash(id: string) {
  let n = 2166136261;
  for (const ch of id) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  return (n >>> 0) / 4294967296;
}
