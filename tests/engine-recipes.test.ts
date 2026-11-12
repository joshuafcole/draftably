import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSource, compile } from '../src/dsl/compile';
import { canonicalGeometry, projectScene } from '../src/dsl/project';
import { DslError, parseModel } from '../src/dsl/syntax';
import { edgeLabelSize } from '../src/model/labels';

const checkout = readFileSync(path.join(__dirname, '../examples/checkout.draft'), 'utf8');
/** Checkout with its root arranged by an engine instead of `flow`. */
const withRoot = (recipe: string) =>
  checkout.replace('layout root flow gap=48', `layout root ${recipe}`);

const errorLine = (source: string) => {
  try {
    parseModel(source);
  } catch (error) {
    expect(error).toBeInstanceOf(DslError);
    return (error as DslError).line;
  }
  throw Error('expected a DslError');
};
const at = (scene: Awaited<ReturnType<typeof compile>>, id: string) => {
  const o = scene.byId.get(id)!;
  return { x: o.x, y: o.y };
};

describe('engine recipes', () => {
  it('parses engines and their settings, and rejects bad ones with a line', () => {
    const m = parseModel(withRoot('engine=layered rank-gap=96 fold=auto direction=down'));
    expect(m.layouts.find(l => l.scope === 'root')).toMatchObject({
      direction: 'down',
      engine: { algorithm: 'layered', params: { rankGap: 96, fold: 'auto' } },
    });
    expect(errorLine('layout root engine=sideways')).toBe(1);
    expect(errorLine('node a "A"\nlayout root engine=layered rank-gap=5')).toBe(2);
    expect(parseModel('layout root engine=layered gap=40').warnings[0].message).toContain(
      'node-gap=',
    );
    expect(errorLine('layout root flow engine=layered')).toBe(1);
    expect(errorLine('layout root engine=separate')).toBe(1);
    expect(errorLine('node a "A"\nlayout root engine=tree root=b')).toBe(2);
  });

  it('arranges the scope differently from the built-in recipe', async () => {
    const plain = await compile(checkout),
      layered = await compile(withRoot('engine=layered direction=down'));
    expect(at(layered, 'db')).not.toEqual(at(plain, 'db'));
    expect(layered.diagnostics.filter(d => d.level === 'error')).toEqual([]);
  });

  it('compiles to the same geometry every time', async () => {
    for (const engine of ['compound-flow', 'layered', 'stress', 'grid']) {
      const source = withRoot(`engine=${engine}`);
      const a = JSON.stringify(canonicalGeometry(projectScene(await compile(source)))),
        b = JSON.stringify(canonicalGeometry(projectScene(await compile(source))));
      expect(a, engine).toBe(b);
    }
  });

  it('keeps refinements on top of the engine arrangement', async () => {
    const base = withRoot('engine=layered');
    const pinned = await compile(base + 'pin db x=900 y=40\n');
    expect(at(pinned, 'db')).toEqual({ x: 900, y: 40 });
    // A pin on one object does not change how the engine arranges the others.
    const free = await compile(base);
    expect(at(pinned, 'web')).toEqual(at(free, 'web'));
  });

  it('lets a nested layout line keep its own recipe inside an engine scope', async () => {
    const scene = await compile(withRoot('engine=layered'));
    const orders = scene.byId.get('orders')!,
      payments = scene.byId.get('payments')!;
    // `layout services row gap=56` still places payments to the right of orders, at least 56px
    // away and wider when the "authorize" label between them needs more room.
    expect(payments.localY).toBe(orders.localY);
    expect(payments.localX).toBe(
      orders.localX + orders.w + Math.max(56, edgeLabelSize('authorize').w + 28),
    );
  });

  it('arranges only the named group when an engine is scoped to it', async () => {
    const source = checkout.replace('layout platform column gap=28', 'layout platform engine=grid');
    const scene = await compile(source),
      plain = await compile(checkout);
    // The root keeps its own recipe: web stays in its rank. It lines up with what it feeds, so
    // only its place across the run follows the group's new size.
    expect(at(scene, 'web').x).toBe(at(plain, 'web').x);
    expect(
      scene.byId.get('api')!.localX === plain.byId.get('api')!.localX &&
        scene.byId.get('api')!.localY === plain.byId.get('api')!.localY &&
        scene.byId.get('services')!.localX === plain.byId.get('services')!.localX &&
        scene.byId.get('services')!.localY === plain.byId.get('services')!.localY,
    ).toBe(false);
  });

  it('checks synchronously with the same errors and no engine run', () => {
    expect(() => checkSource(withRoot('engine=layered') + 'near db web\nnear web db\n')).toThrow(
      DslError,
    );
    expect(checkSource(withRoot('engine=layered')).objects).toHaveLength(9);
  });

  it('shows the root engine in the projected settings', async () => {
    const doc = projectScene(await compile(withRoot('engine=tree rank-gap=80 direction=down')));
    expect(doc.settings).toMatchObject({ algorithm: 'tree', rankGap: 80, direction: 'DOWN' });
  });
});

describe('layered folding', () => {
  const chain = (recipe: string) =>
    Array.from({ length: 12 }, (_, i) => `node n${i} "Step ${i}"`).join('\n') +
    '\n' +
    Array.from({ length: 11 }, (_, i) => `edge e${i} n${i} -> n${i + 1}`).join('\n') +
    `\nlayout root ${recipe}\n`;
  const rows = (scene: Awaited<ReturnType<typeof compile>>) =>
    new Set(scene.objects.map(o => Math.round(o.y))).size;

  it('folds a long layered chain into rows unless fold=never', async () => {
    const folded = await compile(chain('engine=layered direction=right'));
    const xs = folded.objects.flatMap(o => [o.x, o.x + o.w]),
      ys = folded.objects.flatMap(o => [o.y, o.y + o.h]);
    expect(rows(folded)).toBeGreaterThan(1);
    expect(
      (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys)),
    ).toBeLessThanOrEqual(3);
    expect(rows(await compile(chain('engine=layered direction=right fold=never')))).toBe(1);
  });
});

describe('routing statement', () => {
  it('parses router settings and applies them to the projection and routes', async () => {
    const source = checkout + 'routing edge-gap=32 corner-radius=0 passes=1\n';
    expect(parseModel(source).routing).toEqual({ edgeGap: 32, cornerRadius: 0, passes: 1 });
    const doc = projectScene(await compile(source));
    expect(doc.settings.routing).toMatchObject({ edgeGap: 32, cornerRadius: 0, passes: 1 });
    expect(JSON.stringify(canonicalGeometry(doc).routes)).not.toBe(
      JSON.stringify(canonicalGeometry(projectScene(await compile(checkout))).routes),
    );
    expect(errorLine('routing edge-gap=2')).toBe(1);
    expect(errorLine('routing\nrouting passes=2')).toBe(2);
    expect(errorLine('routing bends=4')).toBe(1);
  });
});

describe('examples', () => {
  it('compiles the engine example without errors', async () => {
    const source = readFileSync(path.join(__dirname, '../examples/order-pipeline.draft'), 'utf8');
    const scene = await compile(source);
    expect(scene.diagnostics.filter(d => d.level === 'error')).toEqual([]);
    expect(scene.objects).toHaveLength(15);
  });
});
