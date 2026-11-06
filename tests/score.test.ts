import { describe, expect, it } from 'vitest';
import { drawScene } from '../src/cli/variants';
import { checkScene } from '../src/dsl/check';
import { compile, type Diagnostic } from '../src/dsl/compile';
import { footprint } from '../src/dsl/frame-sprawl';
import { drawingScore, SIZE_FLOOR, WEIGHTS } from '../src/dsl/score';

const drawn = async (lines: string[]) =>
  drawScene(await compile(['diagram "Score" version=1', ...lines].join('\n')));
const warning = (code: string): Diagnostic => ({ level: 'warning', code, message: '', ids: [] });

describe('--score', () => {
  it('scores a clean drawing 0', async () => {
    const scene = await compile('diagram "S" version=1\nnode a "A"\nnode b "B"\nedge e a -> b');
    const { score } = checkScene(scene, { score: true });
    expect(score).toMatchObject({ score: 0, issues: 0, lost: 0 });
  });

  it('weighs each finding by what it hides, over the size floor', async () => {
    const d = await drawn(['node a "A"', 'node b "B"', 'edge e a -> b']);
    const s = drawingScore(
      [warning('label-collision'), warning('crossing'), warning('aspect'), warning('relaxed')],
      d,
    );
    expect(s.raw).toBe(WEIGHTS['label-collision'] + WEIGHTS.crossing + WEIGHTS.aspect);
    expect(s.size).toBe(SIZE_FLOOR);
    expect(s.score).toBe(13 / SIZE_FLOOR);
    expect(s).toMatchObject({ issues: 3, lost: 1 });
    expect(s.counts).toEqual({ 'label-collision': 1, crossing: 1, aspect: 1 });
  });

  it('adds the sprawl past the knee for a sprawling drawing', async () => {
    const scene = await compile(
      [
        'diagram "S" version=1',
        'node a "A"',
        'node b "B"',
        'edge e a -> b',
        'pin a x=0 y=0',
        'pin b x=900 y=500',
      ].join('\n'),
    );
    const { score } = checkScene(scene, { score: true });
    const f = footprint(drawScene(scene))!;
    expect(score!.counts['frame-sprawl']).toBe(1);
    expect(score!.sprawl).toBeCloseTo((f - 8) * 2);
    const weighed = Object.entries(score!.counts).reduce((sum, [c, n]) => sum + n * WEIGHTS[c], 0);
    expect(score!.raw).toBeCloseTo(weighed + score!.sprawl);
  });
});
