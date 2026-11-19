import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { checkSource } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import { formatSource, parseModel, printSource, readSource } from '../src/dsl/syntax';
import { translateEdit, UnsupportedEdit } from '../src/dsl/translate';
import { resolveAppearance } from '../src/model/appearance';
import { CODE_ADVANCE, CODE_PAD, codeLayout, type CodeBlock } from '../src/model/code';
import { FACES } from '../src/model/fonts';
import { clone } from '../src/model/geometry';
import type { Diagram } from '../src/model/types';

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, 'fixtures/code', name + '.draft'), 'utf8');

const look = resolveAppearance();
const block = (lines: string[], extra: Partial<CodeBlock> = {}): CodeBlock => ({
  lines,
  wrap: true,
  numbers: false,
  start: 1,
  maxWidth: 960,
  sourceLine: 2,
  ...extra,
});

describe('code node source', () => {
  it('keeps a body byte for byte through format, and lines after it keep their numbers', () => {
    const body = [
      '\t{ "a": "x # not a comment" }  ',
      '  echo "$(date)" \\',
      '',
      '    // still text',
    ];
    const source = [
      'diagram   "t"',
      `node c "c.json" shape=code lang=json <<JS # trailing comment`,
      ...body,
      '  JS  ',
      'node   b "B"',
    ].join('\n');
    const formatted = formatSource(source);
    expect(formatted).toBe(
      ['diagram "t"', 'node c "c.json" shape=code lang=json <<JS # trailing comment', ...body]
        .concat(['  JS  ', 'node b "B"', ''])
        .join('\n'),
    );
    const doc = readSource(source);
    const b = doc.lines.find(l => l.kind === 'statement' && l.args[0]?.value === 'b');
    expect(b && 'line' in b && b.line).toBe(8);
  });

  it('dedents across every line, so a diff keeps its first column, and expands tabs', () => {
    const m = parseModel(
      'node d shape=code lang=diff <<D\n  @@ -1 +1 @@\n  -old\n  +new\n   same\nD\n' +
        'node t shape=code tab=2 <<T\n\tif x:\n\t\ty\nT\n',
    );
    expect(m.objects[0].code!.lines).toEqual(['@@ -1 +1 @@', '-old', '+new', ' same']);
    expect(m.objects[1].code!.lines).toEqual(['if x:', '  y']);
    expect(m.objects[0].code!.sourceLine).toBe(2);
  });

  it('reports a body with no end at its <<TAG line, and bodies on the wrong shapes', () => {
    expect(() => readSource('diagram "t"\nnode c shape=code <<SQL\nselect 1\n')).toThrow(
      /^Line 2: The body opened by <<SQL has no closing line/,
    );
    expect(() => parseModel('node c "C" shape=code')).toThrow(/A code node needs a body/);
    expect(() => parseModel('node c "C" <<X\nx\nX')).toThrow(/Only a code node takes a body/);
    expect(() => parseModel('node c "C" lang=sql')).toThrow(/lang= belongs on a code node/);
    // A body on any other statement would swallow the lines after it.
    expect(() =>
      parseModel('node a "A"\nnode b "B"\nedge e a -> b "x" <<T\nnode c "C"\nT'),
    ).toThrow(/^Line 3: The edge line takes no body/);
  });
});

describe('code layout', () => {
  it('sizes to the longest line with no growth cap, and places columns exactly', () => {
    const line = 'x'.repeat(100),
      laid = codeLayout(block(['  a', line]), '', look);
    expect(laid.w).toBe(Math.ceil(2 * CODE_PAD.x + 100 * CODE_ADVANCE + 0.01));
    expect(laid.rows.map(r => r.col)).toEqual([0, 0]);
    expect(laid.long).toEqual([]);
  });

  it('wraps a long line with a hanging indent, or clips it with wrap=off', () => {
    const line = '    ' + 'word '.repeat(60).trim(),
      wrapped = codeLayout(block([line], { maxWidth: 400 }), '', look);
    expect(wrapped.rows.length).toBeGreaterThan(1);
    expect(wrapped.rows[0].wraps).toBe(true);
    expect(wrapped.rows.slice(1).every(r => r.col === 6)).toBe(true);
    // Every character is drawn exactly once.
    const shown = wrapped.rows.map(r => line.slice(r.from, r.to)).join('');
    expect(shown.replace(/ /g, '')).toBe(line.replace(/ /g, ''));
    const clipped = codeLayout(block([line], { maxWidth: 400, wrap: false }), '', look);
    expect(clipped.rows).toHaveLength(1);
    expect(clipped.rows[0]).toMatchObject({ clipped: true, to: clipped.cols - 1 });
  });

  it('draws no "more lines" row outside a box too short to hold it', () => {
    const laid = codeLayout(block(['a', 'b', 'c']), 'f.sql', look, { height: 20 });
    expect(laid).toMatchObject({ h: 20, rows: [], more: 3, moreShown: false });
    const roomy = codeLayout(block(['a', 'b', 'c']), 'f.sql', look, { height: 80 });
    expect(roomy.moreShown).toBe(true);
    expect(roomy.moreY + 17).toBeLessThanOrEqual(80);
  });

  it('never breaks a line inside its leading indent', () => {
    const line = ' '.repeat(20) + 'x'.repeat(40),
      laid = codeLayout(block([line]), '', look, { width: 200 });
    expect(laid.rows.length).toBeGreaterThan(1);
    for (const r of laid.rows) expect(line.slice(r.from, r.to).trim()).not.toBe('');
  });

  it('clips a fixed height to whole lines and counts the rest', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`),
      laid = codeLayout(block(lines, { numbers: true, start: 98 }), 'f.sql', look, {
        height: 150,
      });
    expect(laid.h).toBe(150);
    expect(laid.more).toBe(30 - laid.rows.length);
    expect(laid.moreY + 17).toBeLessThanOrEqual(150);
    expect(laid.numberCols).toBe(3);
  });
});

describe('code nodes in a diagram', () => {
  it('reports long lines, a clipped body and an unknown language', () => {
    const scene = checkSource(
      [
        'node a shape=code lang=cobol <<C',
        'ok',
        'C',
        'node b shape=code max-width=200 <<C',
        'short',
        'x'.repeat(60),
        'C',
        'node c shape=code wrap=off max-width=200 <<C',
        'y'.repeat(60),
        'C',
        'node d shape=code <<C',
        ...Array.from({ length: 20 }, (_, i) => `row ${i}`),
        'C',
        'size d width=200 height=100',
      ].join('\n'),
    );
    const codes = scene.diagnostics.map(d => `${d.code}@${d.line}`);
    expect(codes).toEqual(
      expect.arrayContaining(['code-lang@1', 'code-wrap@6', 'code-clip@9', 'code-clipped@33']),
    );
  });

  it('draws every sample with left-aligned runs at column x, in JetBrains Mono', () => {
    for (const name of ['sql', 'python', 'config', 'shell', 'diff']) {
      const doc = projectScene(checkSource(fixture(name))),
        svg = renderSvg(doc);
      expect(svg).not.toContain('xml:space');
      expect(svg).toContain(`font-family:'${FACES['mono-500'].family}'`);
      expect(svg).toMatch(/<tspan x="[\d.]+" y="[\d.]+"(?: fill="#\w+")?>/);
    }
    const doc = projectScene(checkSource(fixture('diff'))),
      r = doc.layout.nodes.fix,
      svg = renderSvg(doc);
    // ` same`-style lines keep their first column: `+` sits in column 0 at the left padding.
    expect(svg).toContain(`<tspan x="${r.x + CODE_PAD.x}" `);
  });

  it('keeps the body when the editor moves or renames a code node', () => {
    const source = fixture('config'),
      scene = checkSource(source),
      before = projectScene(scene),
      run = (fn: (d: Diagram) => void) => {
        const after = clone(before);
        fn(after);
        return printSource(
          translateEdit({
            source: readSource(source),
            scene,
            before,
            after,
            label: 'Edit',
            selection: ['yaml'],
          }).source,
        );
      };
    const renamed = run(d => (d.graph.nodes.find(n => n.id === 'yaml')!.title = 'values.yaml'));
    expect(renamed).toContain('node yaml "values.yaml" shape=code lang=yaml <<YAML\n  service:');
    expect(checkSource(renamed).byId.get('yaml')!.code!.lines).toEqual(
      scene.byId.get('yaml')!.code!.lines,
    );
    expect(() => run(d => (d.styles.yaml.shape = 'box'))).toThrow(UnsupportedEdit);
  });
});
