import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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
});
