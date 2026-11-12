/**
 * The editor must work inside a shadow root. There, a page-level listener sees events retargeted
 * to the host, and `document` lookups cannot see the editor. This walks the modules the editor
 * bundle imports (as `scripts/build-editor.ts` does) and fails on lookups that read the page.
 * App-shell files outside the bundle may use `document` on purpose.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..');
const ENTRIES = ['src/editor/mount.tsx', 'src/editor/element.ts'];
/** Modules whose functions run as document-level listeners: their events are retargeted. */
const DOCUMENT_LISTENERS = ['src/editor/mount.tsx', 'src/state/canvas-keyboard.ts'];
const PAGE_LOOKUPS = /document\.(?:elementFromPoint|activeElement|querySelector(?:All)?)\b/;

function editorModules() {
  const seen = new Set<string>(),
    stack = [...ENTRIES];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const m of text.matchAll(
      /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"?]+)['"]/g,
    )) {
      if (/\.(?:css|svg|png|woff2?|json)$/.test(m[1])) continue;
      const base = path.join(path.dirname(file), m[1]).replace(/\.js$/, '');
      const hit = ['.ts', '.tsx', '/index.ts', '/index.tsx', ''].find(
        ext =>
          existsSync(path.join(root, base + ext)) && statSync(path.join(root, base + ext)).isFile(),
      );
      if (hit !== undefined) stack.push(base + hit);
    }
  }
  return [...seen];
}

describe('the editor bundle', () => {
  it('finds its own root, not the page, so it works in a shadow root', () => {
    const modules = editorModules();
    expect(modules.length).toBeGreaterThan(50);
    const bad: string[] = [];
    for (const file of modules) {
      const lines = readFileSync(path.join(root, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (PAGE_LOOKUPS.test(line)) bad.push(`${file}:${i + 1}: ${line.trim()}`);
        if (DOCUMENT_LISTENERS.includes(file) && /\be\.target\b/.test(line))
          bad.push(`${file}:${i + 1}: use eventTarget(e), not e.target: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
