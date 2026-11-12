import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { layout } from '../src/graph-api';
import { renderSvg } from '../src/runtime/render';

describe('geometry from renderSvg', () => {
  it('is the graph API layout, in the SVG viewBox units', async () => {
    const graph = await layout({
      nodes: [
        { id: 'web' },
        { id: 'api' },
        { id: 'db', parent: 'back' },
        { id: 'queue', parent: 'back' },
      ],
      groups: [{ id: 'back', label: 'Back end' }],
      edges: [
        { id: 'e1', source: 'web', target: 'api', label: 'calls' },
        { id: 'e2', source: 'api', target: 'db' },
        { id: 'e3', source: 'api', target: 'queue' },
      ],
    });
    const result = await renderSvg(graph.draft, { target: 'inline', idPrefix: 'g', fonts: 'host' });
    if (!result.ok) throw Error(result.diagnostics[0].message);
    const g = result.value.geometry!;
    const [x, y, width, height] = result.value.viewBox;
    expect(g.frame).toEqual({ x, y, width, height });
    expect(g.nodes).toEqual(graph.nodes);
    expect(g.groups).toEqual(graph.groups);
    expect(g.edges).toEqual(graph.edges);
    expect(g.bounds).toEqual(graph.bounds);
    // The frame holds the heading and the margin around the shapes.
    expect(g.frame.width).toBeGreaterThanOrEqual(g.bounds.width);
  });

  it('is null for a compare drawing, which repeats items across panels', async () => {
    const source = readFileSync(
      path.join(__dirname, '../examples/worker-pool-change.draft'),
      'utf8',
    );
    const result = await renderSvg(source, { target: 'inline', idPrefix: 'c', fonts: 'host' });
    if (!result.ok) throw Error(result.diagnostics[0].message);
    expect(result.value.geometry).toBeNull();
  });
});
