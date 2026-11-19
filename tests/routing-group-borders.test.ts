import { describe, expect, it } from 'vitest';
import { RouteLab, type RouteInput } from '../src/engines/routing-engine';
import type { Point, Rect } from '../src/model/types';

const box = (id: string, x: number, y: number, parentId?: string, w = 160, h = 56) => ({
  id,
  x,
  y,
  w,
  h,
  parentId,
  shape: 'box' as const,
});
const group = (id: string, x: number, y: number, w: number, h: number, parentId?: string) => ({
  id,
  x,
  y,
  w,
  h,
  parentId,
  collapsed: false,
});
const edge = (id: string, from: string, to: string) => ({ id, from, to, cfg: {} });

/** Closest distance of a run parallel to one of a group's borders, inside or outside it. */
function closestToBorder(points: Point[], g: Rect) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      h = a.y === b.y;
    const [lo, hi] = h
      ? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
      : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    const along = Math.min(hi, h ? g.x + g.w : g.y + g.h) - Math.max(lo, h ? g.x : g.y);
    if (along <= 20) continue;
    for (const side of h ? [g.y, g.y + g.h] : [g.x, g.x + g.w])
      best = Math.min(best, Math.abs((h ? a.y : a.x) - side));
  }
  return best;
}

describe('routing near group borders', () => {
  // Two tiers stacked in a region, one box each, as in multi-region-failover.
  const tiers = (titleWidth?: number): RouteInput => ({
    nodes: [box('lb', 24, 52, 'edge'), box('api', 24, 184, 'app')],
    groups: [
      group('region', 0, -28, 256, 340),
      group('edge', 0, 0, 208, 132, 'region'),
      group('app', 0, 132, 208, 132, 'region'),
    ].map(g => (g.id === 'region' ? g : { ...g, titleWidth })),
    edges: [edge('e', 'lb', 'api')],
  });

  it('drops straight into a group beside its title', () => {
    const [route] = RouteLab.compute(tiers(64)).routes;
    expect(route.points).toEqual([
      { x: 104, y: 108 },
      { x: 104, y: 184 },
    ]);
  });

  it('crosses the band beside a title but never runs along it', () => {
    // Two boxes side by side under a group's header: the link may not ride the band.
    const input: RouteInput = {
      nodes: [box('a', 24, 52, 'g'), box('b', 264, 52, 'g')],
      groups: [{ ...group('g', 0, 0, 448, 132), titleWidth: 64 }],
      edges: [edge('e', 'b', 'a')],
    };
    input.edges[0].cfg = { fromSide: 'top', toSide: 'top' };
    const [route] = RouteLab.compute(input).routes;
    for (let i = 1; i < route.points.length; i++)
      if (route.points[i].y === route.points[i - 1].y)
        expect(route.points[i].y <= 2 || route.points[i].y >= 40).toBe(true);
  });

  it('treats the whole header band as the title without a title width', () => {
    const [route] = RouteLab.compute(tiers()).routes;
    expect(route.points.length).toBeGreaterThan(2);
  });

  it('goes round the far side rather than squeeze past a group border', () => {
    // A 30px slot between box c and group g: the line takes c's open left side instead.
    const input: RouteInput = {
      nodes: [box('a', 0, 0), box('b', 0, 320), box('c', 0, 160), box('x', 214, 160, 'g')],
      groups: [group('g', 190, 120, 208, 136)],
      edges: [edge('e', 'a', 'b')],
    };
    const [route] = RouteLab.compute(input).routes;
    expect(closestToBorder(route.points, input.groups[0])).toBeGreaterThanOrEqual(20);
    // Without the standoff the line takes the slot, 17px from the border.
    const [legacy] = RouteLab.compute(input, { standoff: 0 }).routes;
    expect(closestToBorder(legacy.points, input.groups[0])).toBeLessThan(20);
  });
});
