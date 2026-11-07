import { describe, expect, it } from 'vitest';
import { checkSource } from '../src/dsl/compile';

const SOURCE = (size: string) =>
  ['node a "Collect the inputs"', 'node b "Build"', 'edge e a -> b', size].join('\n');

describe('size min-height', () => {
  it('is a floor under height=auto, never a cap', () => {
    const at = (size: string) => checkSource(SOURCE(size)).byId.get('a')!;
    const auto = at('size a width=140 height=auto');
    const floored = at('size a width=140 height=auto min-height=90');
    expect(floored.w).toBe(140);
    expect(floored.h).toBe(90);
    // A floor lower than the title's own height changes nothing.
    expect(at('size a width=140 height=auto min-height=24').h).toBe(auto.h);
    // A title that needs more than the floor grows past it.
    const long = checkSource(
      SOURCE('size a width=60 height=auto min-height=40').replace(
        'Collect the inputs',
        'Collect the inputs from every upstream service before the build',
      ),
    ).byId.get('a')!;
    expect(long.h).toBeGreaterThan(40);
  });

  it('holds in a cells group too', () => {
    const cell = (size: string) =>
      checkSource(
        [
          'group g "Steps"',
          'layout g cells',
          'node a "Inputs" in=g',
          'node b "Build" in=g',
          size,
        ].join('\n'),
      ).byId.get('a')!;
    expect(cell('size a width=140 height=auto min-height=90').h).toBe(90);
    expect(cell('size a width=140 height=auto').h).toBeLessThan(90);
  });

  it('belongs with height=auto only', () => {
    expect(() => checkSource(SOURCE('size a width=140 height=60 min-height=90'))).toThrow(
      /min-height is a floor under height=auto/,
    );
  });
});
