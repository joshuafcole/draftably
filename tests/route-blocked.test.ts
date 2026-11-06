import { describe, expect, it } from 'vitest';
import { drawScene } from '../src/cli/variants';
import { compile } from '../src/dsl/compile';
import { routeBlockedNotes } from '../src/dsl/route-blocked';

const drawn = async () =>
  drawScene(
    await compile(
      ['diagram "Blocked" version=1', 'node a "A"', 'node b "B"', 'edge e a -> b'].join('\n'),
    ),
  );

describe('route-blocked', () => {
  it('reports nothing for a line the router found a way for', async () => {
    expect(routeBlockedNotes(await drawn())).toEqual([]);
  });

  it('reports a line the router gave up on', async () => {
    const d = await drawn();
    d.routes[0].blocked = true;
    const found = routeBlockedNotes(d);
    expect(found.map(n => [n.code, n.ids])).toEqual([['route-blocked', ['e']]]);
    expect(found[0].box).toBeDefined();
  });
});
