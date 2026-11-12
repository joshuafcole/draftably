import { describe, expect, it } from 'vitest';
import { planRoutes } from '../src/dsl/corridors';
import type { Rect } from '../src/model/types';

describe('corridor ports', () => {
  it.each(['down', 'right'] as const)('keeps a split fan on the box in a %s flow', axis => {
    const flip = (r: Rect): Rect => (axis === 'down' ? r : { x: r.y, y: r.x, w: r.h, h: r.w });
    const targets = [-600, -140, 120, 340, 560].map(
      (x, i) => [`b${i}`, flip({ x, y: 200, w: 164, h: 56 })] as const,
    );
    const boxes = new Map<string, Rect>([['a', flip({ x: 0, y: 0, w: 164, h: 56 })], ...targets]);
    const plans = planRoutes(
      axis,
      [['a'], targets.map(([id]) => id)],
      targets.map(([id]) => ({ id, chain: ['a', id] })),
      id => boxes.get(id),
      () => undefined,
    );
    const ports = [...plans.values()].map(p => (axis === 'down' ? p.points[0].x : p.points[0].y));
    expect(ports).toHaveLength(5);
    expect(Math.min(...ports)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...ports)).toBeLessThanOrEqual(152);
    ports.sort((a, b) => a - b);
    for (let i = 1; i < ports.length; i++)
      expect(ports[i] - ports[i - 1]).toBeGreaterThanOrEqual(16);
  });

  it('spaces ports by the router’s gaps', () => {
    const targets = [180, 200, 220].map(x => [`b${x}`, { x, y: 200, w: 164, h: 56 }] as const);
    const boxes = new Map<string, Rect>([['a', { x: 200, y: 0, w: 164, h: 56 }], ...targets]);
    const ports = (spacing?: { port: number; track: number }) =>
      [
        ...planRoutes(
          'down',
          [['a'], targets.map(([id]) => id)],
          targets.map(([id]) => ({ id, chain: ['a', id] })),
          id => boxes.get(id),
          () => undefined,
          spacing,
        ).values(),
      ].map(p => p.points[0].x);
    // The targets sit 20 apart: room enough at the default pitch, too close at 28.
    expect(ports().sort((a, b) => a - b)).toEqual([262, 282, 302]);
    expect(ports({ port: 28, track: 32 }).sort((a, b) => a - b)).toEqual([254, 282, 310]);
  });
});
