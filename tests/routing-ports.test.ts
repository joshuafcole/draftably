import { describe, expect, it } from 'vitest';
import { RouteLab, type RouteInput } from '../src/engines/routing-engine.js';

const box = (id: string, x: number, y: number, w = 164, h = 57) => ({
  id,
  x,
  y,
  w,
  h,
  shape: 'box' as const,
});

describe('ports centred on a side', () => {
  // A straight line into b's left side, and a second line from below into the same side, one
  // port gap under it: the uneven-ports shape of round 3 (`29, 45 of 57`). The gap between the
  // columns is narrow, so the second line turns in a stub from b.
  const input: RouteInput = {
    nodes: [box('a', 0, 0), box('b', 200, 0), box('c', 0, 160)],
    groups: [],
    edges: [
      { id: 'ab', from: 'a', to: 'b', cfg: { fromSide: 'right', toSide: 'left' } },
      { id: 'cb', from: 'c', to: 'b', cfg: { toSide: 'left' } },
    ],
  };
  const arrivals = (routes: Array<{ to: string; points: Array<{ y: number }> }>) =>
    routes.filter(r => r.to === 'b').map(r => r.points.at(-1)!.y);

  it('sat lopsided without the tidy pass', () => {
    const ys = arrivals(RouteLab.compute(input, { tidy: false }).routes);
    expect(ys.reduce((n, y) => n + y, 0) / ys.length - 28.5).toBeGreaterThan(4);
  });

  it('slides both ports about the middle, the straight line whole', () => {
    const { routes } = RouteLab.compute(input);
    const ys = arrivals(routes);
    expect(ys.reduce((n, y) => n + y, 0) / ys.length).toBeCloseTo(28.5, 0);
    const straight = routes.find(r => r.id === 'ab')!;
    expect(straight.points).toHaveLength(2);
    expect(straight.points[0].y).toBe(straight.points[1].y);
  });

  it('turns the other line midway between the columns rather than hugging the side', () => {
    const { routes } = RouteLab.compute(input);
    const turn = routes.find(r => r.id === 'cb')!.points.at(-2)!;
    expect(turn.x).toBe((164 + 200) / 2);
  });
});

describe('planned ports', () => {
  const plan = {
    points: [
      { x: 50, y: 60 },
      { x: 50, y: 200 },
    ],
    fromOffset: 0,
    toOffset: 0,
  };
  const input: RouteInput = {
    nodes: [box('a', 0, 0, 100, 60), box('b', 0, 200, 100, 60)],
    groups: [],
    edges: [{ id: 'ab', from: 'a', to: 'b', cfg: { plan } }],
  };

  it('reconnects a plan after either box moves', () => {
    for (const id of ['a', 'b']) {
      const nodes = input.nodes.map(n => (n.id === id ? { ...n, x: 100 } : n));
      const [r] = RouteLab.compute({ ...input, nodes }, { quick: true }).routes;
      const a = nodes[0],
        b = nodes[1];
      const onBox = (p: { x: number; y: number }, n: typeof a) =>
        p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h;
      expect(onBox(r.points[0], a)).toBe(true);
      expect(onBox(r.points.at(-1)!, b)).toBe(true);
      expect(r.blocked).toBe(false);
    }
  });

  it('honours an explicit target port offset instead of the plan', () => {
    const edges = [
      {
        ...input.edges[0],
        cfg: {
          plan,
          fromSide: 'bottom' as const,
          toSide: 'top' as const,
          toOffset: -20,
        },
      },
    ];
    const [r] = RouteLab.compute({ ...input, edges }, { quick: true }).routes;
    expect(r.points.at(-1)).toEqual({ x: 30, y: 200 });
    expect(r.blocked).toBe(false);
  });
});
