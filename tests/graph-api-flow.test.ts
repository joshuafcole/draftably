import { describe, expect, it } from 'vitest';
import { layout, route } from '../src/graph-api';

const nodes = [
  {
    id: '1',
    position: { x: 0, y: 0 },
    data: { label: 'Input' },
    measured: { width: 150, height: 40 },
  },
  { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: {} },
  { id: '2', position: { x: 0, y: 0 }, data: { label: 'Parse' }, parentId: 'g' },
  { id: '3', position: { x: 0, y: 0 }, data: { label: 'Check' }, parentNode: 'g' },
  { id: '4', position: { x: 0, y: 0 }, data: { label: 'Output' }, className: 'kept' },
];
const edges = [
  { id: 'a', source: '1', target: '2', label: 'raw' },
  { id: 'b', source: '2', target: '3', sourceHandle: 'bottom' },
  { id: 'c', source: '3', target: '4', animated: true, type: 'mine' },
];

describe('graph api for React Flow', () => {
  it('returns React Flow nodes and edges placed, in the shape it took', async () => {
    const { reactFlow, result } = await layout({ reactFlow: { nodes, edges } });
    const by = Object.fromEntries(reactFlow.nodes.map(n => [n.id, n]));
    // Children sit relative to their group, as React Flow sub-flows expect.
    expect(by['2'].position.x + by.g.position.x).toBe(result.nodes['2'].x);
    expect(by['3'].position.y + by.g.position.y).toBe(result.nodes['3'].y);
    expect(by['1']).toMatchObject({ width: 150, height: 40 });
    expect(by.g.style).toMatchObject({ width: result.groups.g.width });
    expect(by['4'].className).toBe('kept');
    expect(reactFlow.edges.map(e => e.type)).toEqual(['draftably', 'draftably', 'mine']);
    expect(reactFlow.edges[0].data.draftably.label).not.toBeNull();
    expect(result.edges.b.sourceSide).toBe('bottom');
    // Svelte Flow takes the same shape under its own key.
    const svelte = await layout({ svelteFlow: { nodes, edges } });
    expect(svelte.svelteFlow.nodes.map(n => n.position)).toEqual(
      reactFlow.nodes.map(n => n.position),
    );
    // Svelte Flow's style is a CSS string, and it sizes a node from width and height.
    const styled = await layout({
      svelteFlow: { nodes: nodes.map(n => ({ ...n, style: 'color: red' })), edges },
    });
    expect(styled.svelteFlow.nodes[0]).toMatchObject({ style: 'color: red', width: 150 });
  });

  it('routes again where the nodes are now, and keeps old routes for unmeasured ones', async () => {
    const { reactFlow } = await layout({ reactFlow: { nodes, edges } });
    const moved = reactFlow.nodes.map(n =>
      n.id === '4' ? { ...n, position: { x: 2000, y: 900 } } : n,
    );
    const again = route({ reactFlow: { nodes: moved, edges: reactFlow.edges } }).reactFlow.edges;
    const end = (e: (typeof again)[number]) => e.data.draftably.points.at(-1)!;
    expect(end(again[2]).x).toBeGreaterThan(1900);
    expect(again[0].data.draftably.path).toBe(reactFlow.edges[0].data.draftably.path);
    const unmeasured = moved.map(n =>
      n.id === '4' ? { ...n, width: undefined, height: undefined, style: {} } : n,
    );
    const kept = route({ reactFlow: { nodes: unmeasured, edges: reactFlow.edges } }).reactFlow
      .edges;
    expect(kept[2].data.draftably).toEqual(reactFlow.edges[2].data.draftably);
  });
});
