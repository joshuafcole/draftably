import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const src = path.resolve(import.meta.dirname, '../src');

/**
 * Every source file reachable from `entry` through relative imports that load code, as paths
 * under `src/`. A type-only import (`import type …`) loads nothing, so it is not followed.
 */
function reachable(entry: string) {
  const seen = new Set<string>(),
    todo = [path.join(src, entry)];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs
      .readFileSync(file, 'utf8')
      .replace(/\b(?:import|export)\s+type\s[^;]*?from\s*['"][^'"]+['"]/g, '');
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
  it('load none of the editor state, so another page can draw a scene', () => {
    for (const file of fs.readdirSync(path.join(src, 'components/scene'))) {
      const files = reachable(`components/scene/${file}`);
      expect(files.filter(f => f.startsWith('state/'))).toEqual([]);
    }
    expect(reachable('components/scene/StaticScene.tsx')).toContain(
      'components/scene/LinkMark.tsx',
    );
  });
});

describe('a link mark in a session', () => {
  afterAll(() => vi.unstubAllGlobals());
  it('is labelled by the session it is drawn in', async () => {
    // A session reads the page's motion preference; these tests run without a DOM.
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const { createDiagramSession } = await import('../src/state/session');
    const s = createDiagramSession();
    expect(s.describeLink('https://example.com/a')).toBe('Open https://example.com/a');
    s.dispose();
  });
});
