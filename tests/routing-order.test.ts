import { describe, expect, it } from 'vitest';
import { RouteLab, type RouteInput } from '../src/engines/routing-engine';
import type { EdgeLayout } from '../src/model/types';

const box = (id: string, x: number, y: number, w = 160, h = 56) => ({
  id,
  x,
  y,
  w,
  h,
  shape: 'box' as const,
});
const edge = (id: string, from: string, to: string, cfg: EdgeLayout = {}) => ({
  id,
  from,
  to,
  cfg,
});
const right: EdgeLayout = { fromSide: 'right', toSide: 'left' };

describe('routing orderliness', () => {
  it('centres the ports on a shared side', () => {
    const input: RouteInput = {
      nodes: [box('a', 0, 0), box('b', 0, 200), box('t', 300, 100)],
      groups: [],
      edges: [edge('e1', 'a', 't', { toSide: 'left' }), edge('e2', 'b', 't', { toSide: 'left' })],
    };
    const untidy = RouteLab.compute(input, { tidy: false }).routes;
    const routes = RouteLab.compute(input).routes;
    const mean = (rs: typeof routes) => rs.reduce((n, r) => n + r.points.at(-1)!.y, 0) / rs.length;
    expect(mean(untidy)).not.toBe(128);
    expect(mean(routes)).toBe(128);
    expect(routes.map(r => r.toOffset).sort((a, b) => a - b)).toEqual([-8, 8]);
  });

  it('turns a fan on one line when the lines do not overlap', () => {
    const input: RouteInput = {
      nodes: [box('s', 0, 150), box('a', 300, 0), box('b', 260, 300), box('k', 200, 240, 40, 40)],
      groups: [],
      edges: [edge('e1', 's', 'a', right), edge('e2', 's', 'b', right)],
    };
    const turns = (rs: { points: { x: number }[] }[]) => new Set(rs.map(r => r.points[1].x));
    expect(turns(RouteLab.compute(input, { tidy: false }).routes).size).toBe(2);
    const result = RouteLab.compute(input);
    expect(turns(result.routes).size).toBe(1);
    expect(result.report.crossings).toBe(0);
    expect(result.report.shared).toBe(0);
  });

  it('never merges lines to line up a fan', () => {
    // Both edges leave downward, so a shared turn line would draw one over the other.
    const input: RouteInput = {
      nodes: [box('s', 0, 0), box('a', 300, 200), box('b', 300, 400)],
      groups: [],
      edges: [edge('e1', 's', 'a', right), edge('e2', 's', 'b', right)],
    };
    const result = RouteLab.compute(input);
    expect(result.report.shared).toBe(0);
    expect(result.report.lanePairs).toBe(0);
  });

  it('leaves dragging routes alone', () => {
    const input: RouteInput = {
      nodes: [box('a', 0, 0), box('b', 0, 200), box('t', 300, 100)],
      groups: [],
      edges: [edge('e1', 'a', 't', { toSide: 'left' }), edge('e2', 'b', 't', { toSide: 'left' })],
    };
    expect(RouteLab.compute(input, { quick: true }).report.tidied).toBeUndefined();
  });
});
