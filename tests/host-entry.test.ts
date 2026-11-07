// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { render } from 'solid-js/web';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as host from '../src/host';

const src = path.resolve(import.meta.dirname, '../src');
const ENTRY = path.join(src, 'host.ts');

/**
 * Every name `src/host.ts` exports, with its tier: `experimental` when the statement that exports
 * it carries an `@experimental` tag, else `stable`. Read from the syntax, so types count too.
 */
function surface(): Record<string, 'stable' | 'experimental'> {
  const file = ts.createSourceFile(
    ENTRY,
    fs.readFileSync(ENTRY, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const out: Record<string, 'stable' | 'experimental'> = {};
  for (const statement of file.statements) {
    const exported =
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    const names: string[] = [];
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause))
        throw Error('src/host.ts names each export; `export *` would hide what it adds');
      names.push(...statement.exportClause.elements.map(e => e.name.text));
    } else if (exported && ts.isFunctionDeclaration(statement) && statement.name)
      names.push(statement.name.text);
    else if (exported && ts.isVariableStatement(statement))
      for (const d of statement.declarationList.declarations) names.push(d.name.getText(file));
    else if (exported) throw Error(`Unexpected export: ${statement.getText(file).slice(0, 60)}`);
    const tier = ts.getJSDocTags(statement).some(t => t.tagName.text === 'experimental')
      ? 'experimental'
      : 'stable';
    for (const name of names) out[name] = tier;
  }
  return out;
}

/** The modules a file loads: its imports and re-exports, less the type-only ones. */
function loads(file: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
      (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier)
    )
      out.push((node.moduleSpecifier as ts.StringLiteral).text);
    else if (
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

/** Every source file the entry loads, as paths under `src/`, and the packages they load. */
function reachable() {
  const seen = new Set<string>(),
    packages = new Set<string>(),
    todo = [ENTRY];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of loads(file)) {
      if (!spec.startsWith('.')) {
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec);
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

describe('the host entry', () => {
  it('exports exactly its surface, each name in its tier', () => {
    expect(surface()).toEqual({
      compile: 'stable',
      Diagnostic: 'stable',
      Scene: 'stable',
      printSource: 'stable',
      readSource: 'stable',
      SourceDoc: 'stable',
      Rect: 'stable',
      StaticDrawing: 'stable',
      draw: 'experimental',
      StaticScene: 'experimental',
      resolveAppearance: 'experimental',
      measureText: 'experimental',
      typeProfile: 'experimental',
      widestPiece: 'experimental',
      wordPieces: 'experimental',
      wrapLines: 'experimental',
      TypeProfile: 'experimental',
    });
    // The values the module really exports are the value names above.
    expect(Object.keys(host).sort()).toEqual(
      [
        'compile',
        'draw',
        'measureText',
        'printSource',
        'readSource',
        'resolveAppearance',
        'StaticScene',
        'typeProfile',
        'widestPiece',
        'wordPieces',
        'wrapLines',
      ].sort(),
    );
  });

  it('loads no editor state or chrome, no CLI, no embedded fonts, and no package but Solid', () => {
    const { files, packages } = reachable();
    expect(files).toContain('dsl/compile.ts');
    expect(files).toContain('components/scene/StaticScene.tsx');
    expect(
      files.filter(
        f =>
          f.startsWith('state/') ||
          f.startsWith('import/') ||
          f.startsWith('editor/') ||
          f.startsWith('runtime/viewer') ||
          f.startsWith('cli/') ||
          f.startsWith('lib/') ||
          (f.startsWith('components/') &&
            !f.startsWith('components/scene/') &&
            f !== 'components/Icon.tsx' &&
            f !== 'components/session-context.tsx'),
      ),
    ).toEqual([]);
    expect(packages.filter(p => !p.startsWith('solid-js'))).toEqual([]);
  });
});

describe('a host drawing through the entry', () => {
  const SOURCE =
    'diagram "Checkout" version=1\nnode cart "Cart"\nnode pay "Pay"\nedge go cart -> pay "next"\n';

  it('compiles, draws in its own Solid tree, and prints the source back', async () => {
    const scene = await host.compile(SOURCE);
    expect(scene.diagnostics.filter(d => d.level === 'error')).toEqual([]);
    expect(scene.objects.map(o => o.id).sort()).toEqual(['cart', 'pay']);

    const drawing = host.draw(scene);
    expect([...drawing.rects.keys()].sort()).toEqual(['cart', 'pay']);
    expect(drawing.routes.map(r => r.id)).toEqual(['go']);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const dispose = render(() => host.StaticScene({ scene: drawing, idPrefix: 'a-' }), svg);
    expect([...svg.querySelectorAll('[data-id]')].map(e => e.getAttribute('data-id'))).toEqual(
      expect.arrayContaining(['cart', 'pay', 'go']),
    );
    expect(svg.textContent).toContain('Cart');
    // The host has none of the editor's stylesheets: the drawing carries its own presentation.
    for (const line of svg.querySelectorAll('.edge-line'))
      expect(line.getAttribute('fill')).toBe('none');
    expect(svg.querySelectorAll('.edge-label')).toHaveLength(1);
    for (const label of svg.querySelectorAll('.edge-label'))
      expect(label.getAttribute('text-anchor')).toBe('middle');
    dispose();

    expect(host.printSource(host.readSource(SOURCE))).toBe(SOURCE);
    const title = host.resolveAppearance().title;
    expect(host.wrapLines('Cart', 400, title)).toEqual(['Cart']);
    expect(host.measureText('Cart', title)).toBeGreaterThan(0);
  });
});
