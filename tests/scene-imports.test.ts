import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = path.resolve(import.meta.dirname, '../src');

/** Every source file reachable from `entry` through relative imports, as paths under `src/`. */
function reachable(entry: string) {
  const seen = new Set<string>(),
    todo = [path.join(src, entry)];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const [, spec] of text.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(file), spec.replace(/\?.*$/, ''));
      const hit = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].find(ext => {
        const p = base + ext;
        return fs.existsSync(p) && fs.statSync(p).isFile();
      });
      if (hit !== undefined && /\.tsx?$/.test(base + hit)) todo.push(base + hit);
    }
  }
  return [...seen].map(f => path.relative(src, f));
}

describe('scene components', () => {
  it('reach none of the editor state, so another page can draw a scene', () => {
    const files = reachable('components/scene/StaticScene.tsx');
    expect(files).toContain('components/scene/parts.tsx');
    expect(files.filter(f => f.startsWith('state/'))).toEqual([]);
  });
});

describe('the library entry', () => {
  it('loads no editor state, importer or editor chrome', () => {
    const files = reachable('lib.ts');
    expect(files).toContain('components/scene/StaticScene.tsx');
    const chrome = files.filter(
      f =>
        f.startsWith('state/') ||
        f.startsWith('import/') ||
        (f.startsWith('components/') &&
          !f.startsWith('components/scene/') &&
          f !== 'components/Icon.tsx'),
    );
    expect(chrome).toEqual([]);
  });
});
