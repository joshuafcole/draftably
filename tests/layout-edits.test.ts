import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LayoutLab } from '../src/engines/layout-engine';
import { RouteLab } from '../src/engines/routing-engine';
import { checkSource, compile } from '../src/dsl/compile';
import {
  currentRecipe,
  layoutShape,
  recipeText,
  setLayoutRecipe,
  setLayoutShape,
  setRouting,
  UnstorableLayout,
  writeArrangement,
} from '../src/dsl/layout-edits';
import { projectScene } from '../src/dsl/project';
import type { Diagram } from '../src/model/types';
import { parseModel, printSource, readSource } from '../src/dsl/syntax';
import { UnsupportedEdit } from '../src/dsl/translate';

const checkout = readFileSync(path.join(__dirname, '../examples/checkout.draft'), 'utf8');
const settings = (patch: object) => LayoutLab.settings({ ...patch, mode: 'rebuild' });

function withRecipe(text: string, scope: string, patch: object) {
  const source = readSource(text);
  const removed = setLayoutRecipe(source, checkSource(text), scope, settings(patch));
  return { text: printSource(source), removed };
}

describe('layout recipes', () => {
  it('returns from an engine to the built-in recipe, keeping what the author said', () => {
    const text = checkout.replace(
      'layout root flow gap=48',
      'layout root engine=tree rank-gap=64 direction=down fit=slide',
    );
    const source = readSource(text);
    setLayoutShape(source, checkSource(text), 'root', { builtin: true });
    expect(printSource(source)).toContain('layout root flow direction=down fit=slide\n');
  });

  it('replaces the scope line with the engine and only non-default settings', () => {
    const { text } = withRecipe(checkout, 'root', { algorithm: 'layered', rankGap: 96 });
    expect(text).toContain('layout root engine=layered rank-gap=96\n');
    expect(text).not.toContain('layout root flow');
    expect(text).toContain('# Customer-facing entry points.');
    expect(parseModel(text).layouts.find(l => l.scope === 'root')!.engine).toEqual({
      algorithm: 'layered',
      params: { rankGap: 96 },
    });
  });

  it('removes soft refinements inside the scope and keeps pins and nested lines', () => {
    const refined =
      checkout + 'near payments orders side=below gap=40\nstay db x=10 y=10\npin web x=0 y=0\n';
    const root = withRecipe(refined, 'root', { algorithm: 'stress' });
    expect(root.removed).toBe(2);
    expect(root.text).toContain('pin web x=0 y=0');
    expect(root.text).toContain('layout services row gap=56');

    const group = withRecipe(refined, 'services', { algorithm: 'grid', direction: 'DOWN' });
    expect(group.removed).toBe(1);
    expect(group.text).toContain('stay db x=10 y=10');
    expect(group.text).toContain('layout services engine=grid direction=down\n');
  });

  it('keeps the fit and direction the author wrote, unless a new direction is asked for', () => {
    const fitted = checkout.replace(
      'layout root flow gap=48',
      'layout root flow gap=48 direction=down fit=slide',
    );
    expect(withRecipe(fitted, 'root', { algorithm: 'tree' }).text).toContain(
      'layout root engine=tree direction=down fit=slide\n',
    );
    const source = readSource(fitted);
    setLayoutRecipe(source, checkSource(fitted), 'root', settings({ algorithm: 'tree' }), 'right');
    expect(printSource(source)).toContain('layout root engine=tree direction=right fit=slide\n');
  });

  it('changes direction and format on the line and keeps its recipe', () => {
    const source = readSource(checkout + 'stay db x=10 y=10\n');
    const removed = setLayoutShape(source, checkSource(checkout), 'root', {
      direction: 'down',
      fit: 'slide',
    });
    const text = printSource(source);
    expect(removed).toBe(1);
    expect(text).toContain('layout root flow gap=48 direction=down fit=slide\n');
    expect(layoutShape(text, 'root')).toMatchObject({
      recipe: 'flow',
      direction: 'down',
      fit: 'slide',
      gap: 48,
    });
  });

  it('clears a direction and swaps a row for a column', () => {
    const text = checkout.replace('layout root flow gap=48', 'layout root flow direction=down');
    const source = readSource(text);
    setLayoutShape(source, checkSource(text), 'root', { direction: 'auto' });
    setLayoutShape(source, checkSource(text), 'services', { direction: 'down' });
    const after = printSource(source);
    expect(after).toContain('layout root flow\n');
    expect(after).toContain('layout services column gap=56\n');
    expect(layoutShape(after, 'services').direction).toBe('down');
  });

  it('keeps reserved group sizes and adds a line for a scope without one', () => {
    const sized = checkout.replace(
      'layout services row gap=56',
      'layout services row min-width=700',
    );
    expect(withRecipe(sized, 'services', { algorithm: 'tree' }).text).toContain(
      'layout services engine=tree min-width=700',
    );
    expect(withRecipe(checkout, 'clients', { algorithm: 'grid' }).text).toMatch(
      /layout services row gap=56\nlayout clients engine=grid/,
    );
  });

  it('compiles the written recipe to the engine arrangement', async () => {
    const { text } = withRecipe(checkout, 'root', { algorithm: 'layered', direction: 'DOWN' });
    const scene = await compile(text);
    expect(scene.diagnostics.filter(d => d.level === 'error')).toEqual([]);
    expect(scene.byId.get('db')!.y).toBeGreaterThan(scene.byId.get('web')!.y);
  });

  it('refuses engines that cannot be recomputed from the file', () => {
    expect(() => withRecipe(checkout, 'root', { algorithm: 'separate' })).toThrow(UnstorableLayout);
    expect(recipeText('root', settings({ algorithm: 'separate' }))).toMatch(/cannot be saved/);
  });

  it('describes the current line', () => {
    expect(currentRecipe(checkout, 'services')).toBe('layout services row gap=56');
    expect(currentRecipe(checkout, 'clients')).toBeNull();
  });
});

describe('routing line', () => {
  it('writes only non-default router settings and removes the line at defaults', () => {
    const source = readSource(checkout);
    setRouting(source, RouteLab.settings({ edgeGap: 28, cornerRadius: 0 }));
    const text = printSource(source);
    expect(text).toContain('routing edge-gap=28 corner-radius=0\n');
    expect(parseModel(text).routing).toEqual({ edgeGap: 28, cornerRadius: 0 });

    const again = readSource(text);
    setRouting(again, RouteLab.settings({ passes: 2 }));
    expect(printSource(again).match(/^routing.*$/gm)).toEqual(['routing passes=2']);

    setRouting(again, RouteLab.defaults);
    expect(printSource(again)).not.toContain('routing');
  });
});

describe('arrangements', () => {
  // Kept on one row: a force pass started from the wrapped rows sets boxes closer than the
  // minimum gap, which compiling again then separates; that is not what these round trips test.
  const pipeline = readFileSync(
    path.join(__dirname, '../examples/order-pipeline.draft'),
    'utf8',
  ).replace(/^layout root engine=compound-flow$/m, '$& fold=never');

  /** Run an engine on the compiled file, save the result as positions, and compile it again. */
  async function roundTrip(text: string, options: object) {
    const scene = await compile(text),
      doc = projectScene(scene);
    const { document: after } = await LayoutLab.compute(doc, options);
    const source = readSource(text),
      placed = writeArrangement(source, scene, after);
    const next = printSource(source);
    return { after, placed, next, compiled: await compile(next) };
  }

  /** Largest distance between where the engine put a node and where the file now draws it. */
  const drift = (after: Diagram, compiled: Awaited<ReturnType<typeof compile>>) =>
    Math.max(
      ...after.graph.nodes.map(n => {
        const a = after.layout.nodes[n.id],
          b = compiled.byId.get(n.id)!;
        return Math.hypot(a.x - b.x, a.y - b.y);
      }),
    );

  it('refuses a pass on a sequence, which draws from its lanes and rows', async () => {
    const text = readFileSync(path.join(__dirname, '../examples/login-sequence.draft'), 'utf8'),
      scene = await compile(text),
      after = projectScene(scene);
    after.layout.nodes.app.x += 40;
    const source = readSource(text);
    expect(() => writeArrangement(source, scene, after)).toThrow(UnsupportedEdit);
    expect(printSource(source)).toBe(text);
  });

  it('saves a pass as stays that compile back to the same drawing', async () => {
    const { after, placed, next, compiled } = await roundTrip(pipeline, {
      algorithm: 'force',
      mode: 'pass',
      maxMove: 120,
    });
    expect(placed.length).toBeGreaterThan(0);
    expect(next.match(/^stay /gm)!.length).toBe(placed.length);
    expect(drift(after, compiled)).toBeLessThan(1.5);
    expect(compiled.diagnostics.filter(d => d.level === 'error')).toEqual([]);
  });

  it('saves a warm-started rebuild across nested groups', async () => {
    const { after, compiled } = await roundTrip(pipeline, {
      algorithm: 'layered',
      mode: 'rebuild',
      warmStart: true,
      direction: 'DOWN',
      growContainers: true,
    });
    expect(drift(after, compiled)).toBeLessThan(1.5);
  });

  it('updates existing stays in place and never moves pins', async () => {
    const text = checkout + '\nstay web x=4 y=4\npin db x=900 y=40\n';
    const { next, compiled } = await roundTrip(text, {
      algorithm: 'force',
      mode: 'rebuild',
    });
    expect(next.indexOf('stay web')).toBe(text.indexOf('stay web'));
    expect(next).toContain('pin db x=900 y=40');
    expect(compiled.byId.get('db')!).toMatchObject({ x: 900, y: 40 });
  });
});
