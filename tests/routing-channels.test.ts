import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RouteLab, type RouteInput } from '../src/engines/routing-engine';
import { compile } from '../src/dsl/compile';
import { planChannels, trimChannels, type Channel } from '../src/dsl/channels';
import { GROUP_INSET } from '../src/dsl/frame';
import type { Point } from '../src/model/types';

const box = (id: string, x: number, y: number, parentId?: string, w = 160, h = 56) => ({
  id,
  x,
  y,
  w,
  h,
  parentId,
  shape: 'box' as const,
});

/** Inner segments (not the first or last) that pass through the rectangle. */
const through = (points: Point[], r: { x: number; y: number; w: number; h: number }) =>
  points.slice(1).filter((b, i) => {
    if (i === 0 || i === points.length - 2) return false;
    const a = points[i];
    return (
      Math.max(a.x, b.x) > r.x &&
      Math.min(a.x, b.x) < r.x + r.w &&
      Math.max(a.y, b.y) > r.y &&
      Math.min(a.y, b.y) < r.y + r.h
    );
  });

describe('title bands', () => {
  // A group with two stacked members; a line from above and to the right into the lower one.
  const input: RouteInput = {
    nodes: [box('top', 24, 48, 'g'), box('low', 24, 160, 'g'), box('out', 400, -160)],
    groups: [{ id: 'g', x: 0, y: 0, w: 208, h: 240, collapsed: false, titleWidth: 80 }],
    edges: [{ id: 'e', from: 'out', to: 'low', cfg: {} }],
  };
  const band = { x: 0, y: 0, w: 208, h: 40 };

  it('keeps a line out of the band beside the title', () => {
    const [route] = RouteLab.compute(input).routes;
    expect(through(route.points, band)).toEqual([]);
    expect(route.blocked).toBe(false);
  });

  it('still lets a line straight into a top member cross it', () => {
    const [route] = RouteLab.compute({
      ...input,
      edges: [{ id: 'e', from: 'out', to: 'top', cfg: { toSide: 'top' } }],
    }).routes;
    expect(route.blocked).toBe(false);
    expect(route.points.at(-1)).toMatchObject({ y: 48 });
  });
});

describe('routing channels', () => {
  const example = (name: string) => readFileSync(path.join(__dirname, '../examples', name), 'utf8');

  it('plans a channel beside stacked tiers for links that skip a member', async () => {
    const scene = await compile(example('multi-region-failover.draft'));
    const primary = scene.byId.get('primary')!,
      tiers = ['p_edge', 'p_app', 'p_data'].map(id => scene.byId.get(id)!);
    const right = primary.x + primary.w - Math.max(...tiers.map(t => t.x + t.w)),
      left = Math.min(...tiers.map(t => t.x)) - primary.x;
    // API → Postgres and API → Queue read down the right; Queue → Workers returns up the left.
    expect(right).toBe(2 * 20 + 16);
    expect(left).toBe(2 * 20);
  });

  it('leaves groups without traffic at one inset', async () => {
    const scene = await compile(example('multi-region-failover.draft'));
    const channels = planChannels(scene.objects, scene.model.edges);
    expect(channels.has('p_edge')).toBe(false);
    const edge = scene.byId.get('p_edge')!,
      lb = scene.byId.get('p_lb')!;
    expect(lb.x - edge.x).toBe(GROUP_INSET);
  });

  it('adds a channel under the title for a member boxed in by its row', () => {
    const objects = [
      { id: 'g', type: 'group', parent: 'root', x: 0, y: 0, w: 600, h: 128 },
      { id: 'a', type: 'node', parent: 'g', x: 24, y: 48, w: 160, h: 56 },
      { id: 'b', type: 'node', parent: 'g', x: 216, y: 48, w: 160, h: 56 },
      { id: 'c', type: 'node', parent: 'root', x: 700, y: 48, w: 160, h: 56 },
    ];
    const edge = { id: 'e', source: 'a', target: 'c', label: '', dashed: false, line: 1 };
    const channels = planChannels(objects, [{ ...edge, from: 'auto', to: 'auto' }]);
    expect(channels.get('g')).toMatchObject({ left: 24, right: 24, top: 20, bottom: 24 });
    // Lower in its group, the same member takes a channel along the bottom.
    const low = objects.map(o => (o.id === 'g' ? { ...o, y: -60, h: 188 } : o));
    expect(planChannels(low, [{ ...edge, from: 'auto', to: 'auto' }]).get('g')).toMatchObject({
      left: 24,
      right: 24,
      top: 0,
      bottom: 40,
    });
  });

  it('drops the channels carrying fewest lines past the area budget', () => {
    const side = (n: number): Channel => ({
      left: 24,
      right: 40 + 16 * (n - 1),
      top: 0,
      bottom: 24,
      lines: { left: 0, right: n, top: 0, bottom: 0 },
    });
    const plan = new Map([
      ['busy', side(3)],
      ['quiet', side(1)],
    ]);
    // Each channel adds 6% to a drawing of area 100.
    const measure = (c: Map<string, Channel>) => 100 + 6 * c.size;
    expect([...trimChannels(plan, 100, measure).keys()]).toEqual(['busy']);
    expect(trimChannels(plan, 100, () => 100).size).toBe(2);
  });
});
