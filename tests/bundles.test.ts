import { describe, expect, it } from 'vitest';
import { checkSource, compile } from '../src/dsl/compile';
import { projectScene, visibleRects } from '../src/dsl/project';
import { printSource, readSource } from '../src/dsl/syntax';
import { translateEdit } from '../src/dsl/translate';
import { sourceOperations } from '../src/dsl/operations';
import { bundleCount, findBundles } from '../src/model/bundles';
import { clone } from '../src/model/geometry';
import { computeRoutes } from '../src/model/routes';

const crossings = (extra: string[] = []) =>
  [
    'diagram "Crawl" version=1',
    'node crawler "Crawler"',
    'node offsite "Offsite"',
    'node frontier "Frontier"',
    'edge f frontier -> crawler "schedules"',
    'edge a crawler -> offsite "warm fetch"',
    'edge b crawler -> offsite "purge"',
    'edge c offsite -> crawler "origin pull"',
    ...extra,
  ].join('\n');

async function drawn(source: string) {
  const doc = projectScene(await compile(source)),
    { vg, rects } = visibleRects(doc),
    { routes } = computeRoutes(doc, vg, rects);
  return { doc, vg, routes, bundles: findBundles(doc, vg, routes) };
}

describe('bundles', () => {
  it('are off unless the file asks', async () => {
    expect((await drawn(crossings())).bundles).toEqual([]);
  });

  it('run three lines between one pair as one trunk at routing bundle=3', async () => {
    const { bundles, routes } = await drawn(crossings(['routing bundle=3']));
    expect(bundles).toHaveLength(1);
    const [trunk] = bundles;
    expect([trunk.a, trunk.b]).toEqual(['crawler', 'offsite']);
    expect([...trunk.members].sort()).toEqual(['a', 'b', 'c']);
    expect(trunk.text).toBe(bundleCount(3));
    // Heads at both ends: lines run each way.
    expect(trunk.toA && trunk.toB).toBe(true);
    // The trunk is one of its members' routes: the router's middle lane, unchanged.
    const lanes = trunk.members.map(id => routes.find(r => r.id === id)!.points);
    expect(
      lanes.some(
        ps =>
          JSON.stringify(ps) === JSON.stringify(trunk.points) ||
          JSON.stringify([...ps].reverse()) === JSON.stringify(trunk.points),
      ),
    ).toBe(true);
  });

  it('leave a pair under the threshold alone', async () => {
    expect((await drawn(crossings(['routing bundle=4']))).bundles).toEqual([]);
  });

  it('take a name, and bundle a named pair of two or more whatever the threshold', async () => {
    const { bundles } = await drawn(crossings(['bundle offsite crawler "Edge sync"']));
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ a: 'offsite', b: 'crawler', name: 'Edge sync' });
    expect(bundles[0].text).toBe('Edge sync');
  });

  it('refuse a bundle of one end, or of an unknown end', async () => {
    await expect(compile(crossings(['bundle crawler crawler "x"']))).rejects.toThrow('two');
    await expect(compile(crossings(['bundle crawler nowhere "x"']))).rejects.toThrow('nowhere');
    await expect(
      compile(crossings(['bundle crawler offsite "x"', 'bundle offsite crawler "y"'])),
    ).rejects.toThrow();
  });

  it('a name given on the canvas is one bundle statement, and renaming changes it', () => {
    const source = crossings(['routing bundle=3']),
      scene = checkSource(source),
      before = projectScene(scene),
      after = clone(before);
    after.appearance.bundles = [{ a: 'crawler', b: 'offsite', name: 'Edge sync' }];
    const named = translateEdit({
      source: readSource(source),
      scene,
      before,
      after,
      label: 'Name bundle',
      selection: [],
    });
    const text = printSource(named.source);
    expect(text).toMatch(/^bundle crawler offsite "Edge sync"$/m);
    const ops = sourceOperations(readSource(source), readSource(text));
    expect(ops).toEqual([
      expect.objectContaining({
        kind: 'add',
        statement: 'bundle',
        id: 'crawler,offsite',
        fields: expect.objectContaining({ a: 'crawler', b: 'offsite', name: 'Edge sync' }),
      }),
    ]);

    const scene2 = checkSource(text),
      was = projectScene(scene2),
      now = clone(was);
    now.appearance.bundles = [{ a: 'crawler', b: 'offsite', name: 'Fetches' }];
    const renamed = printSource(
      translateEdit({
        source: readSource(text),
        scene: scene2,
        before: was,
        after: now,
        label: 'Name bundle',
        selection: [],
      }).source,
    );
    expect(renamed).toMatch(/^bundle crawler offsite "Fetches"$/m);
    expect(renamed).not.toMatch(/Edge sync/);
  });
});
