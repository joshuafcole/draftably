import { describe, expect, it } from 'vitest';
import { drawScene } from '../src/cli/variants';
import { compile } from '../src/dsl/compile';
import { portFaceNotes } from '../src/dsl/port-faces';
import type { Point, Side } from '../src/model/types';

/**
 * `a` above `b` (`a` 164×56 at 0,0; `b` at 0,200), joined by `edge`, with the route `e` drawn
 * as `points` between the given sides; and the port findings for it.
 */
async function ports(edge: string, fromSide: Side, toSide: Side, points: [number, number][]) {
  const d = drawScene(
    await compile(
      [
        'diagram "Ports" version=1',
        'node a "A"',
        'node b "B"',
        edge,
        'pin a x=0 y=0',
        'pin b x=0 y=200',
      ].join('\n'),
    ),
  );
  const e = d.routes.find(r => r.id === 'e')!;
  Object.assign(e, { fromSide, toSide, points: points.map(([x, y]): Point => ({ x, y })) });
  return portFaceNotes(d);
}

// Out of a's bottom, round b's right side, into b's bottom from below.
const fromBelow: [number, number][] = [
  [82, 56],
  [82, 128],
  [200, 128],
  [200, 300],
  [82, 300],
  [82, 256],
];

describe('port faces', () => {
  it('reports nothing for a line straight down into the top', async () => {
    expect(
      await ports('edge e a -> b', 'bottom', 'top', [
        [82, 56],
        [82, 200],
      ]),
    ).toEqual([]);
  });

  it('reports a line that arrives from below', async () => {
    const found = await ports('edge e a -> b', 'bottom', 'bottom', fromBelow);
    expect(found.map(d => [d.code, d.ids])).toEqual([['faces-away', ['e']]]);
    expect(found[0].message).toContain('enters b by its bottom');
  });

  it('leaves a side the file sets to the author', async () => {
    expect(await ports('edge e a -> b to=bottom', 'bottom', 'bottom', fromBelow)).toEqual([]);
  });

  it('reports a mark on a bend, and not on a line without one', async () => {
    const hook: [number, number][] = [
      [82, 56],
      [82, 100],
      [120, 100],
      [120, 194],
      [126, 194],
      [126, 200],
    ];
    expect((await ports('edge e a -> b', 'bottom', 'top', hook)).map(d => d.code)).toEqual([
      'arrow-room',
    ]);
    expect(await ports('edge e a -> b directed=false', 'bottom', 'top', hook)).toEqual([]);
  });
});
