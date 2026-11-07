import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  checkScene,
  checkSource,
  LAYOUT_ENGINES,
  layoutShape,
  resolveAppearance,
  vary,
  wrapLines,
} from '../src/lib';

const src = path.resolve(import.meta.dirname, '../src');

/** The modules a file loads: its imports and re-exports, less the type-only ones. */
function loads(file: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
      (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier)
    ) {
      const spec = (node.moduleSpecifier as ts.StringLiteral).text;
      out.push(spec);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      out.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true));
  return out;
}

/** Every source file reachable from `entry`, as paths under `src/`, and the packages they load. */
function reachable(entry: string) {
  const seen = new Set<string>(),
    packages = new Set<string>(),
    todo = [path.join(src, entry)];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of loads(file)) {
      if (!spec.startsWith('.')) {
        packages.add(
          spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0],
        );
        continue;
      }
      const base = path.resolve(path.dirname(file), spec.replace(/\?.*$/, ''));
      const hit = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].find(ext => {
        const p = base + ext;
        return fs.existsSync(p) && fs.statSync(p).isFile();
      });
      if (hit !== undefined && /\.tsx?$/.test(base + hit)) todo.push(base + hit);
    }
  }
  return { files: [...seen].map(f => path.relative(src, f)), packages: [...packages].sort() };
}

describe('the library entry', () => {
  it('loads no editor session, importer or editor chrome', () => {
    const { files } = reachable('lib.ts');
    expect(files).toContain('dsl/compile.ts');
    expect(files).toContain('components/scene/StaticScene.tsx');
    const editor = files.filter(
      f =>
        f.startsWith('state/session/') ||
        f.startsWith('import/') ||
        f.startsWith('editor/') ||
        (f.startsWith('components/') &&
          !f.startsWith('components/scene/') &&
          f !== 'components/Icon.tsx' &&
          f !== 'components/session-context.tsx'),
    );
    expect(editor).toEqual([]);
  });

  it('loads no package but Solid', () => {
    expect(reachable('lib.ts').packages).toEqual(['solid-js']);
  });

  it('is what the package exports as ./lib, beside the editor as ./editor', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(src, '../package.json'), 'utf8'));
    expect(pkg.exports['./lib']).toBe('./src/lib.ts');
    expect(pkg.exports['./editor']).toBe('./src/editor/index.ts');
  });

  it('checks a compiled scene as check does, and with metrics as check --metrics does', () => {
    const scene = checkSource('node a "A"\nnode b "B"\nedge e a -> b');
    const plain = checkScene(scene);
    expect(plain.metrics).toBeUndefined();
    const measured = checkScene(scene, { metrics: true, fit: 'tall' });
    expect(measured.diagnostics.map(d => d.code)).toContain('aspect');
    expect(measured.metrics?.warnings).toBe(
      measured.diagnostics.filter(d => d.level === 'warning').length,
    );
  });

  it('varies a source as `draftably vary` does, with each variant drawn and ranked', async () => {
    const source = [
      'node a "A"',
      'node b "B"',
      'node c "C"',
      'node d "D"',
      'edge ab a -> b',
      'edge bc b -> c',
      'edge cd c -> d',
      'edge ad a -> d',
      'layout root flow direction=right',
    ].join('\n');
    const run = await vary(source, { limit: 3, fit: 'square' });
    expect(run.variants[0].id).toBe('v0');
    expect(run.variants.length).toBeGreaterThan(1);
    expect(run.variants.length).toBeLessThanOrEqual(4);
    for (const v of run.variants) {
      const drawn = run.drawn.get(v.id)!;
      expect(drawn.svg).toMatch(/^<svg/);
      // A variant's source is the file with its edits, and only those.
      if (v.id !== 'v0') expect(drawn.source).toBe(applyEdits(source, v.edits).source);
    }
    expect(run.variants.map(v => v.id)).toContain(run.recommended);
  });

  it('names the engines a layout line can use, as the Arrange panel offers them', () => {
    const ids = LAYOUT_ENGINES.map(e => e.id);
    expect(ids).toContain('compound-flow');
    expect(ids).toContain('layered');
    for (const engine of LAYOUT_ENGINES) {
      expect(engine.name.length).toBeGreaterThan(0);
      // Each one is a word a `layout` line takes: it compiles.
      const line = `node a "A"\nnode b "B"\nedge e a -> b\nlayout root engine=${engine.id}`;
      expect(checkSource(line).diagnostics ?? []).toEqual([]);
      expect(layoutShape(line, 'root')).toMatchObject({ engine: true, recipe: engine.id });
    }
  });

  it("measures text as the compiler does, so a host can size a node's text without the DOM", () => {
    const title = 'Collect the inputs from every upstream service';
    const look = resolveAppearance();
    const node = checkSource(`node a "${title}"\nsize a width=120 height=auto`).byId.get('a')!;
    const lines = wrapLines(title, 120 - 2 * look.paddingX, look.title, true);
    expect(lines.length).toBeGreaterThan(1);
    expect(node.h).toBe(lines.length * look.title.lineHeight + 2 * look.paddingY);
  });
});
