import { describe, expect, it } from 'vitest';
import { drawScene } from '../src/cli/variants';
import { compile } from '../src/dsl/compile';
import { labelRunNotes } from '../src/dsl/label-runs';

/** `a -> b "calls"` drawn level, with its label changed by `edit`, and the run findings for it. */
async function runs(
  edit: (l: { x: number; y: number; w: number; h: number }) => object = () => ({}),
) {
  const d = drawScene(
    await compile(
      [
        'diagram "Runs" version=1',
        'node a "Alpha"',
        'node b "Beta"',
        'edge e a -> b "calls"',
        'pin a x=0 y=0',
        'pin b x=300 y=0',
      ].join('\n'),
    ),
  );
  const e = d.routes.find(r => r.id === 'e')!;
  e.label = { ...e.label!, ...edit(e.label!) };
  return labelRunNotes(d);
}

describe('label runs', () => {
  it('reports nothing for a label on a run that holds it', async () => {
    expect(await runs()).toEqual([]);
  });

  it('reports a label more than half its height off its line', async () => {
    const found = await runs(l => ({ y: l.y + 40 }));
    expect(found.map(d => [d.code, d.ids])).toEqual([['label-detached', ['e']]]);
    expect(found[0].box).toBeDefined();
  });

  it('lets a label sit beside its line', async () => {
    expect(await runs(l => ({ y: l.y + l.h / 2 + 4 }))).toEqual([]);
  });

  it('reports text wider than its run by more than a character', async () => {
    // The level run between the two boxes is 136px; the text is the box less 16px of padding.
    const found = await runs(() => ({ w: 136 + 16 + 12 }));
    expect(found.map(d => d.code)).toEqual(['label-overflows-run']);
    expect(await runs(() => ({ w: 136 + 16 + 4 }))).toEqual([]);
  });
});
