import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkSource } from '../src/dsl/compile';
import { inlineSources } from '../src/dsl/inline-sources';
import { canonicalGeometry, projectScene } from '../src/dsl/project';
import { readCodeFiles } from '../src/server/code-files';
import { main } from '../src/cli/main';
import { embedSvgSource } from '../src/model/embed';

const SQL = ['SELECT 1;', '', '-- orders', 'SELECT id,', '       total', 'FROM orders', ''].join(
  '\n',
);
const draft = (src: string, extra = '') =>
  [
    'diagram "t"',
    `node q "orders" shape=code src="${src}"`,
    'node n "note"',
    'edge e1 n -> q',
    extra,
  ].join('\n');

/** A folder holding `queries/orders.sql` and a `.draft` path inside it. */
function folder() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'draftably-src-')));
  fs.mkdirSync(path.join(root, 'queries'));
  fs.writeFileSync(path.join(root, 'queries/orders.sql'), SQL);
  return { root, file: path.join(root, 'd.draft') };
}

const notes = (source: string) => {
  const { root, file } = folder();
  return checkSource(source, readCodeFiles(source, file, root)).diagnostics.filter(
    d => d.code === 'code-src',
  );
};

describe('code src=', () => {
  it('draws the named lines, numbered from the range, with lang= from the extension', () => {
    const { root, file } = folder(),
      source = draft('queries/orders.sql#L3-L5', 'range q.cols lines=4-5'),
      q = checkSource(source, readCodeFiles(source, file, root)).objects.find(o => o.id === 'q')!;
    expect(q.code!.lines).toEqual(['-- orders', 'SELECT id,', '       total']);
    expect(q.code!.start).toBe(3);
    expect(q.code!.lang).toBe('sql');
    expect(q.code!.ranges).toMatchObject([{ name: 'cols', from: 1, to: 2 }]);
  });

  it('draws a placeholder naming the file where the host has no file access', () => {
    const scene = checkSource(draft('queries/orders.sql#L3-L5', 'range q.cols lines=40-50')),
      q = scene.objects.find(o => o.id === 'q')!;
    expect(q.code!.lines.join(' ')).toContain('queries/orders.sql');
    expect(scene.diagnostics.find(d => d.code === 'code-src')?.level).toBe('warning');
  });

  it('reports a missing file, a range past the end and a path outside the folder', () => {
    const errors = (src: string) => notes(draft(src)).map(d => [d.level, d.message]);
    expect(errors('queries/none.sql')).toEqual([
      ['error', expect.stringContaining('no such file')],
    ]);
    expect(errors('queries/orders.sql#L4-L40')).toEqual([
      ['error', expect.stringContaining('past the end of queries/orders.sql (6 lines)')],
    ]);
    expect(errors('../outside.sql')).toEqual([['error', expect.stringContaining('is outside')]]);
    expect(errors('queries/orders.sql#L0')).toEqual([['error', expect.stringContaining('from 1')]]);
    expect(errors('queries/orders.sql#L5-L3')).toEqual([
      ['error', expect.stringContaining('runs backwards')],
    ]);
  });

  it('refuses src= and a body together', () => {
    expect(() => checkSource('node q shape=code src="a.sql" <<X\n  SELECT 1\nX')).toThrow(
      /src= or a body, never both/,
    );
  });

  it('never reads files for a source embedded in an image', async () => {
    const { root } = folder();
    fs.writeFileSync(path.join(root, 'secret.env'), 'TOKEN=hunter2');
    const svg = path.join(root, 'evil.svg');
    fs.writeFileSync(
      svg,
      embedSvgSource('<svg xmlns="http://www.w3.org/2000/svg"></svg>', draft('secret.env')),
    );
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => ((out += chunk), true));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await main(['inspect', svg, '--svg'])).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
    expect(out).toContain('src=');
    expect(out).not.toContain('hunter2');
  });

  it('refuses an export whose inlined source could not be read back', () => {
    const big = { 'a.sql': { text: 'SELECT 1;\n'.repeat(31_000) } };
    expect(() => inlineSources(draft('a.sql'), big)).toThrow(/over the 300,000/);
  });

  it('exports a self-contained source that draws the same', () => {
    const { root, file } = folder(),
      source = draft('queries/orders.sql#L3-L5', 'range q.cols lines=4-5'),
      files = readCodeFiles(source, file, root),
      inline = inlineSources(source, files);
    expect(inline).not.toContain('src=');
    expect(inline).toContain('start=3');
    const geometry = (s: string, f?: typeof files) =>
      canonicalGeometry(projectScene(checkSource(s, f)));
    expect(geometry(inline)).toEqual(geometry(source, files));
  });
});
