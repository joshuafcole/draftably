import { describe, expect, it } from 'vitest';
import { alignTarget, seedGrid } from '../src/engines/layout/grid';
import { hintTargets, normalizeIntent } from '../src/engines/layout/intent';
import { layeredTarget, sketchCrossings } from '../src/engines/layout/layered';
import {
  defaults as layoutDefaults,
  settings as layoutSettings,
} from '../src/engines/layout/settings';
import { forest, shortestPaths, topology } from '../src/engines/layout/topology';
import { bounds, hash, penetration } from '../src/engines/layout/util';
import { conflicts, parallelConflicts } from '../src/engines/routing/conflicts';
import { standoffCost } from '../src/engines/routing/cost';
import { atMost, below, bendsOf, blocked, compress } from '../src/engines/routing/geometry';
import { Heap, Queue } from '../src/engines/routing/heap';
import { port, slot } from '../src/engines/routing/ports';
import {
  defaults as routeDefaults,
  settings as routeSettings,
} from '../src/engines/routing/settings';

const item = (id: string, x = 0, y = 0, w = 100, h = 40) => ({ id, x, y, w, h });
const link = (from: string, to: string, directed = true) => ({ from, to, directed });

describe('layout helpers', () => {
  it('ranks a chain and marks the edge that closes a cycle as feedback', () => {
    const t = topology(
      ['a', 'b', 'c'].map(id => ({ id })),
      [link('a', 'b'), link('b', 'c'), link('c', 'a')],
    );
    expect([...t.rank]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    expect([...t.feedback]).toEqual(['c\0a']);
    expect(t.forward).toHaveLength(2);
    expect(t.components).toEqual([['a', 'b', 'c']]);
  });

  it('keeps an undirected link out of the ranks and drops links to unknown items', () => {
    const t = topology(
      [{ id: 'a' }, { id: 'b' }],
      [link('a', 'b', false), link('a', 'zz'), link('a', 'a')],
    );
    expect(t.edges).toHaveLength(1);
    expect(t.forward).toHaveLength(0);
    expect(t.rank.get('b')).toBe(0);
    expect(t.adj.get('a')).toEqual(['b']);
  });

  it('gives an authored start rank zero and an authored end the last rank', () => {
    const t = topology(
      ['a', 'b', 'c'].map(id => ({ id })),
      [link('a', 'b'), link('b', 'c')],
      { start: { id: 'b', placement: 'top-left' }, end: { id: 'a', placement: 'bottom-right' } },
    );
    expect(t.rank.get('b')).toBe(0);
    expect(t.rank.get('a')).toBe(Math.max(...t.rank.values()));
    expect(t.feedback.has('a\0b')).toBe(true);
  });

  it('counts hops and builds a breadth-first forest from the chosen root', () => {
    const t = topology(
      ['a', 'b', 'c', 'd'].map(id => ({ id })),
      [link('a', 'b'), link('b', 'c'), link('a', 'd')],
    );
    expect(shortestPaths(t).get('c')!.get('d')).toBe(3);
    const f = forest(t, { ...layoutDefaults, rootId: 'b' });
    expect(f.roots).toEqual(['b', 'a']);
    expect(f.kids.get('a')).toEqual(['d']);
    expect(f.depth.get('c')).toBe(1);
  });

  it('measures boxes: bounds, overlap with a gap, and a fixed hash', () => {
    expect(bounds([])).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(bounds([item('a', 10, 20), item('b', 200, -5)])).toEqual({
      x: 10,
      y: -5,
      w: 290,
      h: 65,
    });
    expect(penetration(item('a'), item('b', 110, 0))).toBeNull();
    expect(penetration(item('a'), item('b', 110, 0), 24)).toMatchObject({ x: 14, y: 64, dx: 110 });
    expect(hash('n01')).toBe(hash('n01'));
    expect(hash('n01')).not.toBe(hash('n02'));
    expect(hash('')).toBeCloseTo(2166136261 / 4294967296, 12);
  });

  it('checks settings: old names, ranges and bad values', () => {
    expect(layoutSettings({ algorithm: 'radial' }).algorithm).toBe('tree');
    expect(layoutSettings({ algorithm: 'compact' }).algorithm).toBe('layered');
    expect(layoutSettings({ maxMove: 9999, iterations: 7.6 })).toMatchObject({
      maxMove: 300,
      iterations: 8,
    });
    expect(() => layoutSettings({ algorithm: 'spiral' })).toThrow('Unknown layout algorithm');
    expect(() => layoutSettings({ nodeGap: 'wide' })).toThrow('nodeGap must be a finite number');
    expect(() => layoutSettings({ aspect: '3' })).toThrow('Unknown target aspect ratio');
  });

  it('checks intent and turns a hint into a point in the drawing', () => {
    expect(normalizeIntent({ end: { id: 'a' } })).toEqual({
      end: { id: 'a', placement: 'bottom-right' },
    });
    expect(() => normalizeIntent({ start: { id: 'x' } }, new Set(['a']))).toThrow('existing shape');
    expect(() => normalizeIntent([])).toThrow('must be an object');
    const items = [item('a', 0, 0), item('b', 300, 200)];
    const at = hintTargets(items, { start: { id: 'b', placement: 'top-left' } });
    expect(at.get('b')).toEqual({ x: 50, y: 20 });
  });

  it('seeds a grid in item order and shifts a target onto a frame', () => {
    const items = ['a', 'b', 'c', 'd'].map(id => item(id));
    const seed = seedGrid(items, layoutDefaults, 1.6);
    expect(seed.get('a')).toEqual({ x: 50, y: 20 });
    expect(seed.get('d')).toEqual({ x: 174, y: 84 });
    alignTarget(seed, items, { x: 500, y: 400, w: 600, h: 300 });
    expect(seed.get('a')).toEqual({ x: 550, y: 420 });
  });

  it('puts ranks in columns, and in rows when the flow runs down', () => {
    const items = ['a', 'b', 'c'].map(id => item(id));
    const t = topology(items, [link('a', 'b'), link('a', 'c')]);
    const right = layeredTarget(items, t, { ...layoutDefaults, mode: 'rebuild' }, 1.6);
    expect(right.get('a')!.x).toBeLessThan(right.get('b')!.x);
    expect(right.get('b')!.x).toBe(right.get('c')!.x);
    const down = layeredTarget(
      items,
      t,
      { ...layoutDefaults, mode: 'rebuild', direction: 'DOWN' },
      1.6,
    );
    expect(down.get('a')!.y).toBeLessThan(down.get('b')!.y);
    expect(sketchCrossings(t, right)).toBe(0);
  });
});

describe('routing helpers', () => {
  const p = (x: number, y: number) => ({ x, y });

  it('compresses a path but keeps a reversal', () => {
    expect(compress([p(0, 0), p(5, 0), p(5, 0), p(10.004, 0), p(10, 8)])).toEqual([
      p(0, 0),
      p(10, 0),
      p(10, 8),
    ]);
    expect(compress([p(0, 0), p(10, 0), p(4, 0)])).toEqual([p(0, 0), p(10, 0), p(4, 0)]);
  });

  it('blocks a segment through a box, and lets an upright line cross an open band at a gate', () => {
    const box = { x: 10, y: 10, w: 20, h: 20 };
    expect(blocked(p(0, 20), p(40, 20), [box])).toBe(true);
    expect(blocked(p(0, 10), p(40, 10), [box])).toBe(false);
    expect(blocked(p(0, 0), p(5, 5), [])).toBe(true);
    const band = { ...box, across: true };
    expect(blocked(p(20, 0), p(20, 40), [band])).toBe(false);
    expect(blocked(p(0, 20), p(40, 20), [band])).toBe(true);
    expect(blocked(p(20, 0), p(20, 40), [{ ...band, gates: [25] }])).toBe(true);
    expect(blocked(p(25, 0), p(25, 40), [{ ...band, gates: [25] }])).toBe(false);
  });

  it('searches sorted numbers and counts the bends compress would leave', () => {
    expect(below([1, 3, 3, 7], 3)).toBe(1);
    expect(atMost([1, 3, 3, 7], 3)).toBe(3);
    expect(bendsOf(p(0, 0), [p(10, 0), p(10, 10)], p(20, 10))).toBe(2);
    expect(bendsOf(p(0, 0), [p(10, 0), p(10.01, 0)], p(20, 0))).toBe(0);
  });

  it('puts ports on the outline of each shape', () => {
    const r = { x: 0, y: 0, w: 100, h: 60 };
    expect(port({ ...r, shape: 'box' }, 'right', 10)).toEqual(p(100, 40));
    expect(port({ ...r, shape: 'box' }, 'top', 999)).toEqual(p(90, 0));
    expect(port({ ...r, shape: 'diamond' }, 'left', 15)).toEqual(p(25, 45));
    expect(port({ ...r, shape: 'circle' }, 'bottom')).toEqual(p(50, 60));
  });

  it('gives the next edge on a side the free slot nearest its other end', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 },
      above = { x: 300, y: -200, w: 100, h: 40 },
      taken = {
        id: 'e1',
        from: 'a',
        to: 'b',
        fromSide: 'right' as const,
        toSide: 'left' as const,
        fromOffset: 0,
        toOffset: 0,
        points: [],
        blocked: false,
      };
    expect(slot('a', 'right', a, [], routeDefaults, above)).toBe(0);
    expect(slot('a', 'right', a, [taken], routeDefaults, above)).toBe(-16);
    expect(slot('a', 'left', a, [taken], routeDefaults, above)).toBe(0);
  });

  it('counts a crossing once, a shared run by length, and close parallel runs as a lane deficit', () => {
    const level = { points: [p(0, 0), p(100, 0)] };
    expect(conflicts([p(50, -20), p(50, 20)], [level])).toEqual({ crossings: 1, shared: 0 });
    // A corner on the other line meets two of its segments but is one crossing.
    const corner = { points: [p(0, 0), p(50, 0), p(50, 50)] };
    expect(conflicts([p(20, -20), p(50, -20), p(50, 0), p(80, 0)], [corner]).crossings).toBe(1);
    expect(conflicts([p(20, 0), p(60, 0)], [level])).toEqual({ crossings: 0, shared: 40 });
    // A shared end point is a connection, not a crossing.
    expect(conflicts([p(0, 0), p(0, 40)], [level]).crossings).toBe(0);
    expect(parallelConflicts([p(0, 4), p(100, 4)], [level], 16)).toEqual({
      lanePairs: 1,
      laneDeficit: 75,
      minGap: 4,
    });
    expect(parallelConflicts([p(0, 16), p(100, 16)], [level], 16).lanePairs).toBe(0);
  });

  it('charges a run inside a standoff band by its length and closeness', () => {
    const near = [{ id: 'a', x: 0, y: 0, w: 100, h: 40, band: 20 }];
    expect(standoffCost([p(0, -10), p(100, -10)], near)).toBe(25);
    expect(standoffCost([p(0, -20), p(100, -20)], near)).toBe(0);
    expect(standoffCost([p(0, -10), p(100, -10)], [{ ...near[0], weight: 2 }])).toBe(50);
  });

  it('pops the heap and the queue in order', () => {
    const heap = new Heap(),
      out: number[] = [];
    [5, 1, 4, 2, 3].forEach((f, i) => heap.push(i, f * 10, f));
    while (heap.length) {
      heap.pop();
      out.push(heap.g);
    }
    expect(out).toEqual([10, 20, 30, 40, 50]);
    const queue = new Queue<number>((a, b) => a < b);
    [5, 1, 4, 2, 3].forEach(v => queue.push(v));
    expect([queue.pop(), queue.pop(), queue.pop()]).toEqual([1, 2, 3]);
  });

  it('holds routing settings to their ranges', () => {
    expect(routeSettings({ clearance: 100, passes: 2.6 })).toMatchObject({
      clearance: 30,
      passes: 3,
    });
    expect(() => routeSettings({ edgeGap: NaN })).toThrow(
      'Routing edgeGap must be a finite number',
    );
  });
});
