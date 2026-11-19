import { describe, expect, it, vi } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { compareSources } from '../src/dsl/compare';
import { checkSource, compile } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import { formatSource, parseModel, printSource, readSource } from '../src/dsl/syntax';
import { translateEdit } from '../src/dsl/translate';
import { LayoutLab } from '../src/engines/layout-engine';
import { clone } from '../src/model/geometry';
import type { Diagram } from '../src/model/types';

const nodes = 'node a "A"\nnode b "B"\n';
const source = nodes + 'edge relation a -> b "related" directed=false\n';

/** Exercise the same source-to-model-to-source seam as committed viewer edits. */
function edit(text: string, change: (diagram: Diagram) => void) {
  const scene = checkSource(text);
  const before = projectScene(scene);
  const after = clone(before);
  change(after);
  const result = translateEdit({
    source: readSource(text),
    scene,
    before,
    after,
    label: 'Test edit',
    selection: ['a'],
  });
  return printSource(result.source);
}

describe('native undirected connections', () => {
  it('keeps old files directed and validates the new boolean attribute', () => {
    const directed = projectScene(checkSource(nodes + 'edge relation a -> b\n'));
    expect(directed.graph.edges[0].directed).toBe(true);
    expect(
      projectScene(checkSource(nodes + 'edge relation a -> b directed=true\n')).graph.edges[0]
        .directed,
    ).toBe(true);
    expect(() => checkSource(nodes + 'edge relation a -> b directed=both\n')).toThrow(
      'directed=true|false',
    );
  });

  it('preserves a single undirected edge through formatting and projection', async () => {
    const formatted = formatSource(source);
    expect(formatted).toContain('directed=false');
    const scene = await compile(formatted);
    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0]).toMatchObject({
      id: 'relation',
      source: 'a',
      target: 'b',
      directed: false,
    });
    expect(projectScene(scene).graph.edges).toEqual([
      expect.objectContaining({ id: 'relation', from: 'a', to: 'b', directed: false }),
    ]);
  });

  it('allows an unrelated label edit and still saves the undirected edge', () => {
    const next = edit(source, diagram => {
      diagram.graph.nodes[0].title = 'Renamed A';
    });
    expect(next).toContain('node a "Renamed A"');
    expect(next).toContain('directed=false');
    expect(projectScene(checkSource(next)).graph.edges[0].directed).toBe(false);
  });

  it('preserves direction when an existing undirected edge is relabeled', () => {
    const next = edit(source, diagram => {
      diagram.graph.edges[0].label = 'renamed relation';
    });
    expect(next).toContain('"renamed relation" directed=false');
    expect(projectScene(checkSource(next)).graph.edges[0].directed).toBe(false);
  });

  it('writes new undirected edges and can change an edge back to directed', () => {
    const created = edit(nodes, diagram => {
      diagram.graph.edges.push({
        id: 'temporary',
        from: 'a',
        to: 'b',
        label: '',
        directed: false,
        dashed: false,
        emphasis: false,
      });
    });
    expect(projectScene(checkSource(created)).graph.edges[0].directed).toBe(false);
    const directed = edit(created, diagram => {
      diagram.graph.edges[0].directed = true;
    });
    expect(directed).not.toContain('directed=false');
    expect(projectScene(checkSource(directed)).graph.edges[0].directed).toBe(true);
  });

  it('does not impose a flow rank for an undirected connection', () => {
    const layout = 'layout root flow direction=right fold=never\n';
    const positions = (text: string) =>
      checkSource(text).objects.map(o => ({ id: o.id, x: o.x, y: o.y }));
    expect(positions(nodes + 'edge relation b -> a directed=false\n' + layout)).toEqual(
      positions(nodes + layout),
    );
    const directed = checkSource(nodes + 'edge relation b -> a\n' + layout);
    expect(directed.byId.get('b')!.x).toBeLessThan(directed.byId.get('a')!.x);
  });

  it('does not impose a swim-lane rank for an undirected connection', () => {
    const scene = checkSource(
      'group left "Left"\ngroup right "Right"\n' +
        'node a "A" in=left\nnode b "B" in=right\n' +
        'edge relation b -> a directed=false\nlayout root lanes direction=right\n',
    );
    expect(scene.byId.get('a')!.x).toBe(scene.byId.get('b')!.x);
  });

  it('passes undirected adjacency to layout engines unless constraint=false', async () => {
    const spy = vi.spyOn(LayoutLab, 'compute');
    try {
      await compile(source + 'layout root engine=stress\n');
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][0].graph.edges).toEqual([
        expect.objectContaining({ id: 'relation', directed: false }),
      ]);
      spy.mockClear();
      await compile(
        source.replace('directed=false', 'directed=false constraint=false') +
          'layout root engine=stress\n',
      );
      expect(spy.mock.calls[0][0].graph.edges).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('omits the SVG arrow marker only on the undirected edge', () => {
    const svg = renderSvg(projectScene(checkSource(source + 'edge directed b -> a "reply"\n')));
    const relation = /<g data-id="relation"[^>]*>([\s\S]*?)<\/g>/.exec(svg)?.[1];
    const directed = /<g data-id="directed"[^>]*>([\s\S]*?)<\/g>/.exec(svg)?.[1];
    expect(relation).toBeDefined();
    expect(relation).not.toContain('marker-end=');
    expect(directed).toContain('marker-end=');
  });

  it('compares a direction change as removed and added edges', () => {
    const before = nodes + 'edge relation a -> b\n';
    const merged = compareSources(before, source);
    const model = parseModel(merged);
    expect(model.edges).toHaveLength(2);
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'relation-was', status: 'removed' }),
        expect.objectContaining({ id: 'relation', status: 'added', directed: false }),
      ]),
    );
  });
});
