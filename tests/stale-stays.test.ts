import { describe, expect, it } from 'vitest';
import { checkSource } from '../src/dsl/compile';

const flow = (extra: string[] = []) =>
  [
    'diagram "Stays" version=1',
    'node a "Collect the inputs"',
    'node b "Build the package"',
    'node c "Publish"',
    'edge e1 a -> b',
    'edge e2 b -> c',
    'layout root flow direction=right gap=48',
    ...extra,
  ].join('\n');

const at = (source: string, id: string) => {
  const o = checkSource(source).byId.get(id)!;
  return { x: o.x, y: o.y };
};

describe('stale viewer stays', () => {
  it('honours stays that still fit the arrangement', () => {
    const source = flow(['stay a x=0 y=0', 'stay b x=400 y=40']),
      scene = checkSource(source);
    expect(scene.diagnostics.some(d => d.code === 'stale-stay')).toBe(false);
    expect(at(source, 'b').x - at(source, 'a').x).toBe(400);
  });

  it('drops stays that now land two ranks on top of each other', () => {
    // Written when the boxes were narrow: b's stay now sits on a.
    const source = flow(['stay a x=0 y=0', 'stay b x=30 y=10']),
      scene = checkSource(source);
    const note = scene.diagnostics.find(d => d.code === 'stale-stay');
    expect(note?.level).toBe('info');
    expect(note?.ids.sort()).toEqual(['a', 'b']);
    for (const id of ['a', 'b', 'c']) expect(at(source, id)).toEqual(at(flow(), id));
  });

  it('gives a stale-stay diagnostic the intended position and distance', () => {
    const scene = checkSource(flow(['stay a x=0 y=0', 'stay b x=30 y=10'])),
      note = scene.diagnostics.find(d => d.code === 'stale-stay')!;
    expect(note.ids[0]).toBe('a');
    expect(note.intended).toEqual({ x: 0, y: 0 });
    expect(typeof note.distance).toBe('number');
  });

  it('keeps stays when a new object lands on a stayed one', () => {
    const source = flow(['stay a x=0 y=0', 'stay b x=400 y=0', 'stay c x=800 y=0']),
      grown = source.replace('edge e2 b -> c', 'node d "Sign"\nedge e2 b -> d\nedge e3 d -> c');
    expect(checkSource(grown).diagnostics.some(d => d.code === 'stale-stay')).toBe(false);
  });
});
