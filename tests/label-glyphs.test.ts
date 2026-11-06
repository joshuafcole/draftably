import { describe, expect, it } from 'vitest';
import { compile } from '../src/dsl/compile';
import { findConflicts } from '../src/dsl/conflicts';
import { projectScene, visibleRects } from '../src/dsl/project';
import { computeRoutes } from '../src/model/routes';

/**
 * A drawing with its label `calls` on `e` moved to `at` (its centre), and the label findings
 * `check` reports for it. Moving the label rather than the boxes keeps every other line put.
 */
async function labelAt(
  at: (box: { x: number; y: number; w: number; h: number }) => {
    x: number;
    y: number;
  },
) {
  const scene = await compile(
    [
      'diagram "Labels" version=1',
      'node a "Alpha"',
      'node b "Beta"',
      'node c "Gamma"',
      'edge e a -> b "calls"',
      'edge f b -> c',
      'pin a x=0 y=0',
      'pin b x=300 y=0',
      'pin c x=300 y=200',
    ].join('\n'),
  );
  const doc = projectScene(scene),
    { vg, rects } = visibleRects(doc),
    { routes } = computeRoutes(doc, vg, rects, { previous: [] });
  const e = routes.find(r => r.id === 'e')!;
  e.label = { ...e.label!, ...at(rects.get('c')!) };
  return findConflicts(scene, doc, rects, routes).filter(d => d.code.startsWith('label-'));
}

describe('label findings test the text, not the label box', () => {
  it('reports a label whose text a box hides', async () => {
    const found = await labelAt(c => ({ x: c.x + 20, y: c.y + c.h - 8 }));
    expect(found.map(d => d.code)).toEqual(['label-collision']);
    expect(found[0].ids).toEqual(['e', 'c']);
    expect(found[0].message).toContain('is drawn under c');
  });

  it('only notes a label whose padding alone is under a box', async () => {
    // The label's centre sits below the box by half its height less 4px of its 3px padding.
    const found = await labelAt(c => ({ x: c.x + c.w / 2, y: c.y + c.h + 11 - 4 }));
    expect(found.map(d => d.code)).toEqual(['label-crowded']);
  });

  it('reports nothing for a label clear of every box', async () => {
    expect(await labelAt(c => ({ x: c.x - 100, y: c.y + c.h + 60 }))).toEqual([]);
  });

  it('reports a line through the text', async () => {
    // Line f runs down from b to c; put the label across it, above c.
    const found = await labelAt(c => ({ x: c.x + c.w / 2, y: c.y - 60 }));
    expect(found.map(d => [d.code, d.ids])).toEqual([['label-collision', ['e', 'f']]]);
  });
});
