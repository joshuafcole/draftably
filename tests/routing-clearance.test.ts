import { describe, expect, it } from 'vitest';
import { RouteLab, type RouteInput } from '../src/engines/routing-engine';
import type { Point, Rect } from '../src/model/types';

const box = (id: string, x: number, y: number, w = 160, h = 56, parentId?: string) => ({
  id,
  x,
  y,
  w,
  h,
  parentId,
  shape: 'box' as const,
});
const edge = (id: string, from: string, to: string) => ({ id, from, to, cfg: {} });

/** Shortest distance from a run parallel to one of `r`'s sides, for runs alongside it. */
function closestParallel(points: Point[], r: Rect) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      h = a.y === b.y;
    const [lo, hi] = h
      ? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
      : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    const along = Math.min(hi, h ? r.x + r.w : r.y + r.h) - Math.max(lo, h ? r.x : r.y);
    if (along <= 16) continue;
    const at = h ? a.y : a.x,
      s0 = h ? r.y : r.x,
      s1 = h ? r.y + r.h : r.x + r.w;
    if (at <= s0) best = Math.min(best, s0 - at);
    else if (at >= s1) best = Math.min(best, at - s1);
  }
  return best;
}

describe('routing clearance', () => {
  it('connects stacked neighbours in a tight gap through their facing sides', () => {
    const input: RouteInput = {
      nodes: [box('a', 0, 0), box('b', 0, 76)],
      groups: [],
      edges: [edge('e', 'a', 'b')],
    };
    const [route] = RouteLab.compute(input).routes;
    expect(route.fromSide).toBe('bottom');
    expect(route.toSide).toBe('top');
    expect(route.points).toEqual([
      { x: 80, y: 56 },
      { x: 80, y: 76 },
    ]);
  });

  it('does not hook into an offset neighbour across a tight gap', () => {
    const input: RouteInput = {
      nodes: [box('a', 0, 0), box('b', 120, 76)],
      groups: [],
      edges: [edge('e', 'a', 'b')],
    };
    const [route] = RouteLab.compute(input).routes;
    expect(route.blocked).toBe(false);
    // No hook: the route keeps travelling downward and never doubles back.
    for (let i = 1; i < route.points.length; i++)
      expect(route.points[i].y).toBeGreaterThanOrEqual(route.points[i - 1].y);
  });

  it('keeps runs past a box at the standoff, not the hard clearance', () => {
    const blocker = box('c', 200, 40, 100, 120);
    const input: RouteInput = {
      nodes: [box('a', 0, 80, 100, 40), box('b', 400, 80, 100, 40), blocker],
      groups: [],
      edges: [edge('e', 'a', 'b')],
    };
    const legacy = RouteLab.compute(input, { standoff: 0, facing: false }).routes[0];
    const route = RouteLab.compute(input).routes[0];
    expect(closestParallel(legacy.points, blocker)).toBeLessThan(15);
    expect(closestParallel(route.points, blocker)).toBeGreaterThanOrEqual(20);
  });

  it('keeps runs off a group border', () => {
    const group = { id: 'g', x: 0, y: 0, w: 200, h: 200, collapsed: false };
    const input: RouteInput = {
      nodes: [
        box('a', 80, 40, 100, 40, 'g'),
        box('c', 20, 120, 170, 60, 'g'),
        box('b', 20, 300, 100, 40),
      ],
      groups: [group],
      edges: [edge('e', 'a', 'b')],
    };
    const nearestBorder = (points: Point[]) => {
      let best = Infinity;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        if (a.x === b.x) best = Math.min(best, Math.abs(a.x - group.x), Math.abs(a.x - group.w));
      }
      return best;
    };
    const legacy = RouteLab.compute(input, { standoff: 0, facing: false }).routes[0];
    const route = RouteLab.compute(input).routes[0];
    expect(nearestBorder(legacy.points)).toBeLessThan(8);
    expect(route.blocked).toBe(false);
    expect(nearestBorder(route.points)).toBeGreaterThanOrEqual(8);
  });
});
