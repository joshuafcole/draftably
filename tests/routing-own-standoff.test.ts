import { describe, expect, it } from 'vitest';
import { RouteLab, type RouteInput } from '../src/engines/routing-engine';

const box = (id: string, x: number, y: number, w = 164, h = 63) => ({
  id,
  x,
  y,
  w,
  h,
  shape: 'box' as const,
});

describe('standoff from a line’s own ends', () => {
  // draftably-code-layers: state/ → model/ leaves state's top and turns right along it.
  const input: RouteInput = {
    nodes: [box('state', 216, 131), box('model', 644, 152), box('dsl', 429, 183)],
    groups: [],
    edges: [{ id: 'e', from: 'state', to: 'model', cfg: { fromSide: 'top', toSide: 'left' } }],
  };

  it('turns a full standoff away from the box it leaves', () => {
    const [route] = RouteLab.compute(input).routes;
    expect(131 - route.points[1].y).toBeGreaterThanOrEqual(20);
  });

  it('turned at the 13px stub before, riding the box’s top', () => {
    const [legacy] = RouteLab.compute(input, { facing: false }).routes;
    expect(131 - legacy.points[1].y).toBe(13);
  });
});
