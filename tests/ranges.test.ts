import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { checkSource } from '../src/dsl/compile';
import { canonicalGeometry, projectScene } from '../src/dsl/project';
import { resolveAppearance } from '../src/model/appearance';
import { codeLayout } from '../src/model/code';
import { placeNotes } from '../src/model/note';
import { rangeBand, rangeRect } from '../src/model/ranges';
import { withState } from '../src/model/status';
import { visibleRects } from '../src/dsl/project';
import { nestedQuantifier, printSource, readSource } from '../src/dsl/syntax';
import { translateEdit } from '../src/dsl/translate';
import * as edits from '../src/model/edits';
import { clone } from '../src/model/geometry';
import type { Diagram } from '../src/model/types';

/** Apply an editor edit and return the source it writes, compiled again to prove it parses. */
function edit(source: string, fn: (d: Diagram) => void) {
  const scene = checkSource(source),
    before = projectScene(scene),
    after = clone(before);
  fn(after);
  const result = translateEdit({
    source: readSource(source),
    scene,
    before,
    after,
    label: 'edit',
    selection: [],
  });
  const text = printSource(result.source);
  return { text, scene: checkSource(text) };
}

const fixture = readFileSync(path.join(__dirname, 'fixtures/code/ranges.draft'), 'utf8');

const code = (extra = '') =>
  [
    'diagram "t"',
    'node a "A"',
    'node sql shape=code lang=sql start=10 <<SQL',
    '  SELECT 1',
    '  FROM t',
    '  JOIN u ON u.id = t.id',
    '  JOIN u ON u.x = t.x',
    'SQL',
    extra,
  ].join('\n');

describe('code ranges', () => {
  it('never move a box or a line: geometry matches the file without its range lines', () => {
    const bare = fixture
      .split('\n')
      .filter(l => !l.startsWith('range '))
      .join('\n')
      // The note and edge then name the node instead of its ranges.
      .replace(/sql\.copy\d/g, 'sql');
    const doc = projectScene(checkSource(fixture)),
      plain = projectScene(checkSource(bare));
    expect(canonicalGeometry(doc).nodes).toEqual(canonicalGeometry(plain).nodes);
    // Ranges alone, with nothing pointing at them, change no route either.
    const only = bare.replace(/^(note|edge) .*$/gm, ''),
      withRanges =
        only +
        '\n' +
        fixture
          .split('\n')
          .filter(l => l.startsWith('range '))
          .join('\n');
    expect(canonicalGeometry(projectScene(checkSource(withRanges)))).toEqual(
      canonicalGeometry(projectScene(checkSource(only))),
    );
  });

  it('end an edge at the range middle line, on the left or right side', () => {
    const doc = projectScene(checkSource(fixture)),
      { rects } = visibleRects(doc),
      look = resolveAppearance(doc.appearance),
      range = rangeRect(doc, look, rects, 'sql.copy1')!,
      route = canonicalGeometry(doc).routes.find(r => r.id === 'e1')!,
      end = route.points[route.points.length - 1],
      sql = rects.get('sql')!;
    expect([sql.x, sql.x + sql.w]).toContain(end.x);
    expect(Math.abs(end.y - (range.y + range.h / 2))).toBeLessThanOrEqual(1);
  });

  it('place a note beside its range', () => {
    const doc = projectScene(checkSource(fixture)),
      { rects } = visibleRects(doc),
      look = resolveAppearance(doc.appearance),
      range = rangeRect(doc, look, rects, 'sql.copy2')!,
      [note] = placeNotes(doc, look, rects, []);
    expect(note.rect.x).toBeGreaterThan(range.x + range.w);
    expect(note.rect.y).toBeLessThanOrEqual(range.y + range.h);
    expect(note.rect.y + note.rect.h).toBeGreaterThanOrEqual(range.y);
  });

  it('count lines=a-b from start= and match= from the first hit', () => {
    const scene = checkSource(
      code('range sql.from lines=11-12 color=red "from"\nrange sql.join match="JOIN u" span=2'),
    );
    expect(scene.byId.get('sql')!.code!.ranges).toEqual([
      { name: 'from', from: 1, to: 2, color: 'red', label: 'from' },
      { name: 'join', from: 2, to: 3, color: 'amber' },
    ]);
    expect(scene.diagnostics.find(d => d.code === 'range-match')?.message).toMatch(
      /matches 2 lines of sql \(12, 13\)/,
    );
    const laid = codeLayout(scene.byId.get('sql')!.code!, '', resolveAppearance(), {});
    expect(rangeBand(laid, scene.byId.get('sql')!.code!.ranges![0])!.h).toBe(2 * 17);
  });

  it.each([
    ['range sql.x lines=12-14', /runs to line 14, past sql's last line, 13/],
    ['range sql.x lines=9-10', /starts at line 9, before sql's first line, 10/],
    ['range sql.x match="nothing"', /matches no line of sql/],
    ['range sql.x match="JOIN" span=3', /runs past sql's last line/],
    ['range a.x lines=1-1', /a is not a code node/],
    ['range b.x lines=1-1', /Unknown node b in range b.x/],
    ['range sql.x lines=10-10\nedge e a -> sql.y', /Unknown range sql\.y: sql has x/],
    ['note "n" near=sql.y', /Unknown range sql\.y: sql has no ranges/],
    ['state s "S" sql.y', /Unknown range sql\.y.*in state s/],
    ['range sql.x lines=10-10\nedge e a -> sql.x to=top', /left or right side/],
    ['range sql.x lines=10-10 color=nope', /Unknown color nope/],
    ['range sql.x match="^(a+)+$"', /repeats a group that repeats inside/],
    ['range sql.x match="(x*)*"', /repeats a group that repeats inside/],
  ])('check reports %s', (line, message) => {
    expect(() => checkSource(code(line))).toThrow(message);
  });

  it('fade the other ranges of a node when a state lists one, and draw the same in SVG', () => {
    const source =
      code('range sql.a lines=10-10 "a"\nrange sql.b lines=12-13 color=blue "b"') +
      '\nstate s "S" sql.b';
    const doc = projectScene(checkSource(source)),
      drawn = withState(doc, 's'),
      ranges = drawn.graph.nodes.find(n => n.id === 'sql')!.code!.ranges!;
    expect(ranges.map(r => r.spot)).toEqual(['dim', 'focus']);
    expect(drawn.styles.a?.spot).toBe('dim');
    const svg = renderSvg(drawn);
    expect(svg.match(/class="code-range"/g)).toHaveLength(2);
    expect(svg).toContain('class="code-range" opacity="0.35"');
  });

  it('go with their node when it is deleted, with every line that names them', () => {
    const source = code(
      [
        'node sql.x "Not a range"',
        'range sql.copy1 lines=10-11 "c"',
        'note "n" near=sql.copy1',
        'state s1 "S" sql.copy1 a',
        'state s2 "T" sql.x',
        'edge e1 a -> sql.copy1',
      ].join('\n'),
    );
    const { text } = edit(source, d => edits.deleteObjects(d, ['sql']));
    expect(text).not.toMatch(/sql\.copy1|^range|^edge/m);
    expect(text).toMatch(/^note "n"$/m);
    expect(text).toMatch(/^state s1 "S" a$/m);
    // A node whose ID only starts with `sql.` stays, and so does its state.
    expect(text).toMatch(/^node sql\.x "Not a range"$/m);
    expect(text).toMatch(/^state s2 "T" sql\.x$/m);
  });

  it('stay on the original target when a step is inserted on a line to a range', () => {
    const source = code('range sql.copy1 lines=10-11 "c"\nedge e1 a -> sql.copy1');
    const { text, scene } = edit(source, d => {
      edits.insertStep(d, 'e1', undefined, { x: 0, y: 0 });
    });
    const lines = text.split('\n').filter(l => l.startsWith('edge '));
    expect(lines).toHaveLength(2);
    expect(lines.find(l => l.startsWith('edge e1 '))).toMatch(/^edge e1 a -> new-step$/);
    expect(lines.find(l => !l.startsWith('edge e1 '))).toMatch(/ new-step -> sql\.copy1$/);
    expect(scene.edges.map(e => [e.fromRange, e.toRange])).toEqual([
      [undefined, undefined],
      [undefined, 'copy1'],
    ]);
  });

  it('refuse only nested quantifiers in match=', () => {
    expect(['(a+)+', '(a*)*', '((ab)+)+', '(a+){2,}', '(?:x+y)*'].map(nestedQuantifier)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(
      ['COUNT\\(\\*\\)', '(ab)+', 'a+b*', '[(+)]+', 'SUM\\(I\\.QTY\\) AS Q'].map(nestedQuantifier),
    ).toEqual([false, false, false, false, false]);
  });

  it('take a change mark', () => {
    const doc = projectScene(checkSource(code('~range sql.a lines=11-11 "changed"')));
    expect(doc.graph.nodes.find(n => n.id === 'sql')!.code!.ranges![0].status).toBe('changed');
  });
});
