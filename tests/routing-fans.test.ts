import { describe, expect, it } from 'vitest';
import { RouteLab, type RouteInput } from '../src/engines/routing-engine.js';

const box = (id: string, x: number, y: number, w = 160, h = 80) => ({
  id,
  x,
  y,
  w,
  h,
  shape: 'box' as const,
});
const edge = (id: string, from: string, to: string) => ({ id, from, to, cfg: {} });

/** A hub with three targets to its right: one level, one above, one below. */
const fan: RouteInput = {
  nodes: [box('hub', 0, 120), box('a', 320, 0), box('b', 320, 120), box('c', 320, 240)],
  groups: [],
  edges: [edge('ea', 'hub', 'a'), edge('eb', 'hub', 'b'), edge('ec', 'hub', 'c')],
};

describe('fans on facing sides', () => {
  it('fans out of the side that faces the targets', () => {
    const { routes } = RouteLab.compute(fan);
    expect(routes.map(r => r.fromSide)).toEqual(['right', 'right', 'right']);
    // Every target is entered from a side that faces the hub, so nothing hooks round.
    for (const r of routes) expect(['left', 'top', 'bottom']).toContain(r.toSide);
    expect(new Set(routes.map(r => r.fromOffset)).size).toBe(3);
  });

  it('spreads round to the far sides without the facing rule', () => {
    const { routes } = RouteLab.compute(fan, { facing: false });
    expect(new Set(routes.map(r => r.fromSide)).size).toBeGreaterThan(1);
  });

  it('gathers a fan-in on the side facing its sources', () => {
    // Three sources left of one target: all arrive on its left, where the old rule
    // pushed the second and third round to its top and bottom.
    const input: RouteInput = {
      nodes: [box('a', 0, 0), box('b', 0, 120), box('c', 0, 240), box('t', 320, 120)],
      groups: [],
      edges: [edge('ea', 'a', 't'), edge('eb', 'b', 't'), edge('ec', 'c', 't')],
    };
    const { routes } = RouteLab.compute(input);
    expect(routes.map(r => r.toSide)).toEqual(['left', 'left', 'left']);
  });
});

describe('fan order on a shared side', () => {
  it('nests a fan-in whose last line would take a middle port', () => {
    // From a review of five PRs: three lines enter one short side, and the line from the
    // farthest box is routed last. Its port has to sit past the others, or it crosses one.
    const into = (id: string, from: string, to: string, label: string) => ({
      id,
      from,
      to,
      label,
      directed: true,
      cfg: { flow: 'right' as const },
    });
    const input: RouteInput = {
      nodes: [
        { ...box('pr498', 24, 48, 164, 72), parentId: 'prs' },
        { ...box('pr499', 24, 144, 164, 72), parentId: 'prs' },
        { ...box('pr502', 24, 240, 164, 56), parentId: 'prs' },
        { ...box('pr500', 24, 320, 164, 72), parentId: 'prs' },
        { ...box('small', 392, 64, 164, 56), parentId: 'lands' },
        { ...box('api', 392, 144, 164, 72), parentId: 'lands' },
        { ...box('camera', 392, 240, 164, 56), parentId: 'lands' },
      ],
      groups: [
        { id: 'prs', x: 0, y: 0, w: 212, h: 416, collapsed: false, titleWidth: 127 },
        { id: 'lands', x: 368, y: 16, w: 245, h: 384, collapsed: false, titleWidth: 189 },
      ],
      edges: [
        into('v498', 'pr498', 'small', 'merge'),
        into('v499', 'pr499', 'small', 'merge'),
        into('v502a', 'pr502', 'small', 'close; land fixes'),
        into('v502b', 'pr502', 'api', 'own-tree drawing [2]'),
        into('v500', 'pr500', 'camera', 'rebuild on the handle'),
      ],
    };
    const { routes, report } = RouteLab.compute(input, { standoff: 20 });
    expect(report.crossings).toBe(0);
    const order = routes
      .filter(r => r.to === 'small')
      .sort((a, b) => a.toOffset - b.toOffset)
      .map(r => r.id);
    expect(order).toEqual(['v498', 'v499', 'v502a']);
  });
});
