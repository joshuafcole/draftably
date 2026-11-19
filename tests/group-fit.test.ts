import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LayoutLab } from '../src/engines/layout-engine';
import { compile, type Scene } from '../src/dsl/compile';
import { GROUP_INSET, GROUP_TITLE_CHROME } from '../src/dsl/frame';
import { writeArrangement } from '../src/dsl/layout-edits';
import { projectScene } from '../src/dsl/project';
import { printSource, readSource } from '../src/dsl/syntax';
import { measureText } from '../src/model/fonts';
import { GROUP_TITLE_LINES, groupHeaderFor, groupTitleLines } from '../src/model/labels';

const examples = path.join(__dirname, '../examples');
const read = (name: string) => readFileSync(path.join(examples, name), 'utf8');

/** Space between each group's frame and the bounding box of its children. */
function paddings(scene: Scene) {
  // A `cells` group has no inset: its cells fill it edge to edge.
  const cells = new Set(scene.model.layouts.filter(l => l.algorithm === 'cells').map(l => l.scope));
  return scene.objects
    .filter(o => o.type === 'group' && !cells.has(o.id))
    .flatMap(g => {
      const kids = scene.objects.filter(o => o.parent === g.id);
      if (!kids.length) return [];
      const x0 = Math.min(...kids.map(k => k.x)),
        y0 = Math.min(...kids.map(k => k.y)),
        x1 = Math.max(...kids.map(k => k.x + k.w)),
        y1 = Math.max(...kids.map(k => k.y + k.h));
      const titleRoom = Math.ceil(measureText(g.label, scene.look.groupTitle)) + GROUP_TITLE_CHROME;
      return [
        {
          id: g.id,
          w: g.w,
          titleRoom,
          left: x0 - g.x,
          right: g.x + g.w - x1,
          top: y0 - g.y,
          bottom: g.y + g.h - y1,
        },
      ];
    });
}

/** Every object's box, for comparing two compiles exactly. */
const geometry = (scene: Scene) => scene.objects.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));

describe('group fit', () => {
  // Swim lanes and a sequence's bands span the whole drawing by design, so they are not fitted
  // to their content.
  const files = readdirSync(examples).filter(
    f => f.endsWith('.draft') && !/^layout root (lanes|sequence)/m.test(read(f)),
  );

  // A routing channel (src/dsl/channels.ts) is two standoffs plus an edge gap per extra line on
  // a side, or one standoff plus the gaps under the title.
  const channel = (pad: number) => pad >= 40 && (pad - 40) % 16 === 0;
  const under = (pad: number) => pad >= 20 && (pad - 20) % 16 === 0;

  it.each(files)('%s fits every group to its content with one inset', async file => {
    const scene = await compile(read(file));
    for (const p of paddings(scene)) {
      expect(p.left === GROUP_INSET || channel(p.left), `${p.id} left ${p.left}`).toBe(true);
      expect(p.bottom === GROUP_INSET || channel(p.bottom), `${p.id} bottom ${p.bottom}`).toBe(
        true,
      );
      const top = p.top - groupHeaderFor(scene.look, scene.byId.get(p.id)!.titleLines);
      expect(top === 0 || under(top), `${p.id} top ${p.top}`).toBe(true);
      // Only a title wider than the content or a channel may widen the frame.
      // A wrapped title sets a width of its own, up to the one-line width.
      if (p.right !== GROUP_INSET && !channel(p.right))
        if (scene.byId.get(p.id)!.titleLines) expect(p.w).toBeLessThan(p.titleRoom);
        else expect(p.w, `${p.id} right`).toBe(p.titleRoom);
    }
  });

  it('fits nested groups and groups arranged by engines', async () => {
    const source = [
      'group outer "Outer"',
      'group inner "Inner" in=outer',
      'node a "A" in=inner',
      'node b "B" in=inner',
      'group cells "Cells"',
      'node c "C" in=cells',
      'node d "D" in=cells',
      'node e "E" in=cells',
      'edge ab a -> b',
      'edge bc b -> c',
      'layout cells engine=grid',
      '',
    ].join('\n');
    for (const text of [source, source + 'layout root engine=compound-flow\n']) {
      const pads = paddings(await compile(text));
      expect(pads.map(p => p.id).sort()).toEqual(['cells', 'inner', 'outer']);
      for (const p of pads) expect([p.left, p.right, p.bottom]).toEqual([24, 24, 24]);
    }
  });

  it('widens a group for a short title wider than its content', async () => {
    const scene = await compile(`group g "Payments and refunds"\nnode a "A" in=g\n`);
    const [p] = paddings(scene);
    expect(p.w).toBe(p.titleRoom);
    expect(p.w).toBeGreaterThan(scene.byId.get('a')!.w + 2 * GROUP_INSET);
    expect([p.left, p.bottom]).toEqual([24, 24]);
  });

  it('wraps a long title and grows the header instead of the width', async () => {
    const title =
      '1 · Open an order from the dashboard and load its latest shipping status (always on)';
    const scene = await compile(`group g "${title}"\nnode a "Cached status" in=g\n`);
    const g = scene.byId.get('g')!,
      [p] = paddings(scene);
    expect(g.titleLines).toBeGreaterThan(1);
    expect(g.titleLines).toBeLessThanOrEqual(GROUP_TITLE_LINES);
    expect(p.w).toBeLessThan(p.titleRoom / 2);
    expect(p.top).toBe(groupHeaderFor(scene.look, g.titleLines));
    const lines = groupTitleLines(title, g.w, scene.look, g.titleLines);
    expect(lines.join(' ')).toBe(title);
  });

  it('keeps an explicit minimum size', async () => {
    const text = read('checkout.draft').replace(
      'layout services row gap=56',
      'layout services row gap=56 min-width=900 min-height=400',
    );
    const services = (await compile(text)).byId.get('services')!;
    expect([services.w, services.h]).toEqual([900, 400]);
  });

  it('gives an empty group a usable size', async () => {
    const g = (await compile('group g "Empty"\n')).byId.get('g')!;
    expect([g.w, g.h]).toEqual([260, 110]);
  });
});

describe('group fit converges', () => {
  it.each(['ci-cd-pipeline.draft', 'order-pipeline.draft', 'kubernetes-cluster.draft'])(
    '%s compiles to the same geometry every time',
    async file => {
      const text = read(file);
      expect(geometry(await compile(text))).toEqual(geometry(await compile(text)));
    },
  );

  it('compiles a file the viewer saved to the drawing it saved, and saving again changes nothing', async () => {
    // On one row, as in the arrangement round trips (see layout-edits.test.ts).
    const text = read('order-pipeline.draft').replace(
      /^layout root engine=compound-flow$/m,
      '$& fold=never',
    );
    const scene = await compile(text);
    const { document: after } = await LayoutLab.compute(projectScene(scene), {
      algorithm: 'force',
      mode: 'pass',
      maxMove: 120,
    });
    const source = readSource(text);
    expect(writeArrangement(source, scene, after).length).toBeGreaterThan(0);
    const saved = printSource(source);
    expect(saved).toMatch(/^stay /m);

    const once = await compile(saved),
      twice = await compile(saved);
    expect(geometry(twice)).toEqual(geometry(once));
    // Saving the compiled drawing back finds every object already where the file puts it.
    const again = readSource(saved);
    expect(writeArrangement(again, once, projectScene(once))).toEqual([]);
    expect(printSource(again)).toBe(saved);
    for (const p of paddings(once)) expect([p.left, p.bottom]).toEqual([24, 24]);
  });
});
