import { describe, expect, it } from 'vitest';
import { dagreLayout, DraftablyELK, layout, type DagreGraph } from '../src/graph-api';

describe('elkjs stand-in', () => {
  const graph = () => ({
    id: 'root',
    layoutOptions: { 'elk.direction': 'DOWN', 'elk.layered.crossingMinimization.strategy': 'X' },
    children: [
      {
        id: 'n1',
        width: 120,
        height: 40,
        labels: [{ text: 'Client' }],
        ports: [{ id: 'n1.out', layoutOptions: { 'elk.port.side': 'SOUTH' } }],
      },
      {
        id: 'cluster',
        labels: [{ text: 'Backend' }],
        children: [
          { id: 'n2', width: 120, height: 40, labels: [{ text: 'API' }] },
          { id: 'n3', width: 120, height: 40, labels: [{ text: 'DB' }] },
        ],
      },
    ],
    edges: [
      { id: 'e1', sources: ['n1.out'], targets: ['n2'] },
      { id: 'e2', sources: ['n2'], targets: ['n3'], labels: [{ text: 'SQL' }] },
    ],
  });

  it('returns the ELK tree placed, with edges relative to their container as elkjs does', async () => {
    const elk = new DraftablyELK(),
      out = await elk.layout(graph());
    const [n1, cluster] = out.children!,
      [n2] = cluster.children!;
    expect(n2).toMatchObject({ width: 120, height: 40 });
    expect(out.edges!.map(e => e.container)).toEqual(['root', 'cluster']);
    // e1 leaves the SOUTH port, on n1's bottom; e2 is relative to the cluster, as elkjs sets it.
    const e1 = out.edges![0].sections![0];
    expect(e1.startPoint.y).toBe(n1.y! + n1.height!);
    const e2 = out.edges![1].sections![0];
    const { x, y } = e2.startPoint,
      onSide = (x === n2.x || x === n2.x! + n2.width!) && y >= n2.y! && y <= n2.y! + n2.height!,
      onEnd = (y === n2.y || y === n2.y! + n2.height!) && x >= n2.x! && x <= n2.x! + n2.width!;
    expect(onSide || onEnd).toBe(true);
    expect(out.edges![1].labels![0].width).toBeGreaterThan(0);
    // Everything starts at (0, 0) or below and right, as in elkjs.
    expect(Math.min(n1.x!, n1.y!, cluster.x!, cluster.y!)).toBeGreaterThanOrEqual(0);
    expect(elk.warnings).toEqual([
      'These ELK options are not used: layered.crossingMinimization.strategy.',
    ]);
  });

  it('mirrors a DOWN layout for UP, and takes the graph under the elk key', async () => {
    const down = await new DraftablyELK().layout(graph()),
      up = await layout({ elk: { ...graph(), layoutOptions: { 'elk.direction': 'UP' } } });
    expect(down.children![0].y).toBeLessThan(down.children![1].y!);
    expect(up.elk.children![0].y).toBeGreaterThan(up.elk.children![1].y!);
    expect(up.elk.edges![0].sections![0].startPoint.y).toBe(up.elk.children![0].y);
  });
});

describe('dagre stand-in', () => {
  /** The graphlib calls dagreLayout makes, over plain maps. */
  function graphlib() {
    const nodes = new Map<string, Record<string, unknown>>(),
      edges = new Map<
        string,
        { v: string; w: string; name?: string; label: Record<string, unknown> }
      >(),
      parents = new Map<string, string>(),
      info: Record<string, unknown> = { rankdir: 'LR' };
    const g = {
      setNode: (v: string, label: Record<string, unknown>) => nodes.set(v, label),
      setEdge: (v: string, w: string, label: Record<string, unknown> = {}, name?: string) =>
        edges.set(`${v}|${w}|${name ?? ''}`, { v, w, name, label }),
      setParent: (v: string, p: string) => parents.set(v, p),
      nodes: () => [...nodes.keys()],
      node: (v: string) => nodes.get(v),
      edges: () =>
        [...edges.values()].map(({ v, w, name }) => ({ v, w, ...(name ? { name } : {}) })),
      edge: (e: { v: string; w: string; name?: string }) =>
        edges.get(`${e.v}|${e.w}|${e.name ?? ''}`)?.label,
      graph: () => info,
      parent: (v: string) => parents.get(v),
      children: (v?: string) => [...parents].filter(([, p]) => p === v).map(([c]) => c),
    };
    return g satisfies DagreGraph;
  }

  it('writes centres, edge points and the graph size back, as dagre.layout does', () => {
    const g = graphlib();
    g.setNode('a', { label: 'Start', width: 120, height: 40 });
    g.setNode('b', { label: 'Check', width: 120, height: 40 });
    g.setNode('c', { label: 'Done', width: 120, height: 40 });
    g.setNode('k', { label: 'Cluster' });
    g.setParent('b', 'k');
    g.setParent('c', 'k');
    g.setEdge('a', 'b', { label: 'go' });
    g.setEdge('b', 'c');
    g.setEdge('a', 'c', {}, 'skip');
    dagreLayout(g);
    const [a, b, k] = ['a', 'b', 'k'].map(
      v => g.node(v) as { x: number; y: number; width: number; height: number },
    );
    expect(a.x).toBe(60);
    expect(b.x).toBeGreaterThan(a.x);
    expect(k.width).toBeGreaterThan(b.width);
    expect(
      (g.edge({ v: 'a', w: 'c', name: 'skip' }) as { points: unknown[] }).points.length,
    ).toBeGreaterThanOrEqual(2);
    expect(g.edge({ v: 'a', w: 'b' })).toHaveProperty('x');
    expect(g.graph()).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  });
});
