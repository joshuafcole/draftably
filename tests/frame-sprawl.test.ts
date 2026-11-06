import { describe, expect, it } from 'vitest';
import { drawScene } from '../src/cli/variants';
import { compile } from '../src/dsl/compile';
import { footprint, frameSprawlNotes, sprawlCost } from '../src/dsl/frame-sprawl';

const drawn = async (lines: string[]) =>
  drawScene(await compile(['diagram "Sprawl" version=1', ...lines].join('\n')));

describe('frame-sprawl', () => {
  it('reports nothing for boxes side by side', async () => {
    const d = await drawn(['node a "A"', 'node b "B"', 'edge e a -> b']);
    expect(footprint(d)).toBeLessThan(2);
    expect(frameSprawlNotes(d)).toEqual([]);
  });

  it('reports two boxes far apart, with a cost past the knee', async () => {
    const d = await drawn([
      'node a "A"',
      'node b "B"',
      'edge e a -> b',
      'pin a x=0 y=0',
      'pin b x=900 y=500',
    ]);
    const f = footprint(d)!;
    expect(f).toBeGreaterThan(8);
    expect(frameSprawlNotes(d).map(n => n.code)).toEqual(['frame-sprawl']);
    expect(sprawlCost(f)).toBeCloseTo((f - 8) * 2);
  });

  it('leaves a sequence diagram unmeasured', async () => {
    const d = await drawn([
      'layout root sequence',
      'node a "A"',
      'node b "B"',
      ...Array.from({ length: 12 }, (_, i) => `edge m${i} a -> b "step ${i}"`),
    ]);
    expect(footprint(d)).toBeUndefined();
  });
});
