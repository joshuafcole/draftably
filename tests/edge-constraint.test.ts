import { describe, expect, it } from 'vitest';
import { compile } from '../src/dsl/compile';

const flow = (back: string) =>
  [
    'diagram "Feedback" version=1',
    'group t1 "Trigger 1" color=teal',
    'node open "Open the record" in=t1 shape=pill',
    'node key "Cache key" in=t1',
    'node get "Fetch" in=t1',
    'group t2 "Trigger 2" color=blue',
    'node click "Click save" in=t2 shape=pill',
    'node save "Save job" in=t2',
    'node store "Store" color=slate',
    'node sync "Sync to clients" color=slate',
    'edge a open -> key',
    'edge b key -> get',
    'edge c click -> save',
    'edge d save -> store',
    'edge e store -> sync',
    back,
    'layout root engine=layered direction=down',
  ].join('\n');

const boxes = async (source: string) =>
  (await compile(source)).objects.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));

describe('constraint=false', () => {
  it('draws the edge but lays out as if it were not there', async () => {
    const free = await compile(flow('edge back sync -> key "refetch on change" constraint=false'));
    expect(free.edges.find(e => e.id === 'back')?.constraint).toBe(false);
    expect(await boxes(flow('edge back sync -> key "refetch on change" constraint=false'))).toEqual(
      await boxes(flow('')),
    );
    // Without the option the feedback edge ranks Trigger 1 below Sync.
    const tied = await compile(flow('edge back sync -> key "refetch on change"'));
    expect(tied.byId.get('t1')!.y).toBeGreaterThan(tied.byId.get('sync')!.y);
  });

  it('lets a dashed side input rank only a box no solid edge reaches', async () => {
    const scene = await compile(
      [
        'diagram "Side input" version=1',
        'node a "Start"',
        'node b "Middle"',
        'node c "End"',
        'node x "Called by start"',
        'node q "Queue"',
        'node w "Worker"',
        'edge ab a -> b',
        'edge bc b -> c',
        'edge ax a -> x',
        'edge cx c -> x "same shapes" kind=async',
        'edge qw q -> w kind=async',
        'layout root flow direction=right',
      ].join('\n'),
    );
    // x sits beside b, where its solid caller places it, not past c.
    expect(scene.byId.get('x')!.x).toBe(scene.byId.get('b')!.x);
    // A worker that only a dashed edge reaches still ranks after its queue.
    expect(scene.byId.get('w')!.x).toBeGreaterThan(scene.byId.get('q')!.x);
  });

  it('rejects other values', async () => {
    await expect(compile(flow('edge back sync -> key constraint=no'))).rejects.toThrow(
      'constraint=true|false',
    );
  });
});
