import { describe, expect, it } from 'vitest';
import { RouteLab, type RouteInput } from '../src/engines/routing-engine';

const box = (id: string, x: number, y: number, w = 164, h = 56) => ({
  id,
  x,
  y,
  w,
  h,
  shape: 'box' as const,
});

/** Lengths of a route's inner segments: the ones that aren't its end stubs. */
const inner = (points: Array<{ x: number; y: number }>) =>
  points
    .slice(1, -2)
    .map((p, i) => Math.abs(points[i + 2].x - p.x) + Math.abs(points[i + 2].y - p.y));

describe('small steps in a route', () => {
  // A fold's wrap edge, as draftably-ci-checks draws prove:layout → Upload screenshots: out of
  // the source's right side, down a lane past the band's end, back along the band gap and into
  // the target's top. The lane turns 20px past the box while the port stub is 13px long.
  const input: RouteInput = {
    nodes: [box('a', 0, 0), box('b', 0, 300)],
    groups: [],
    edges: [
      {
        id: 'wrap',
        from: 'a',
        to: 'b',
        cfg: {
          fromSide: 'right',
          toSide: 'top',
          waypoints: [
            { x: 184, y: 44 },
            { x: 184, y: 272 },
            { x: 82, y: 272 },
          ],
        },
      },
    ],
  };

  it('stepped 7px between the stub and the lane before, without the standoff', () => {
    const [route] = RouteLab.compute(input, { jogs: false, standoff: 0 }).routes;
    expect(Math.min(...inner(route.points))).toBeLessThan(12);
  });

  it('runs straight out to the lane, still through every waypoint', () => {
    const [route] = RouteLab.compute(input).routes;
    expect(Math.min(...inner(route.points))).toBeGreaterThanOrEqual(12);
    expect(route.points[1]).toEqual({ x: 184, y: 28 });
  });
});
