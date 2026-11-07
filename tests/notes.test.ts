import { describe, expect, it } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { checkSource } from '../src/dsl/compile';
import { sceneConflicts } from '../src/dsl/conflicts';
import { projectScene, visibleRects } from '../src/dsl/project';
import { removeEdge, removeReferences, removeWhere } from '../src/dsl/source-edits';
import { printSource, readSource } from '../src/dsl/syntax';
import { contains, overlaps } from '../src/model/geometry';
import { placeNotes } from '../src/model/note';
import { translateEdit } from '../src/dsl/translate';
import { clone } from '../src/model/geometry';
import { normalize } from '../src/model/document';
import type { Diagram } from '../src/model/types';
import { setTextValue, textId } from '../src/state/session/canvas-text';
import { computeRoutes } from '../src/model/routes';

const SOURCE = `diagram "Plans" version=1
node ws "Workspace"
node plan "Plan"
node seat "Seat"
edge e1 ws -> plan
edge e2 ws -> seat
`;

describe('notes', () => {
  it('draws notes without moving anything, beside their object clear of the drawing', () => {
    const noted =
      SOURCE + 'note "A plan is one pricing tier."\nnote "Billed monthly." near=seat side=below\n';
    const at = (s: string) => checkSource(s).objects.map(o => [o.id, o.x, o.y]);
    expect(at(noted)).toEqual(at(SOURCE));
    const scene = checkSource(noted),
      doc = projectScene(scene),
      { rects } = visibleRects(doc),
      [frame, beside] = placeNotes(doc, scene.look, rects, []);
    expect(frame.inFrame).toBe(true);
    expect(beside.overlaps).toBeUndefined();
    expect(beside.rect.y).toBeGreaterThan(rects.get('seat')!.y + rects.get('seat')!.h);
    expect([...rects.values()].some(r => overlaps(r, beside.rect))).toBe(false);
    expect(renderSvg(doc)).toContain('Billed monthly.');
    expect(sceneConflicts(scene).some(d => d.code === 'note-overlap')).toBe(false);
  });

  it('rejects a note beside an unknown object', () => {
    expect(() => checkSource(SOURCE + 'note "x" near=nope\n')).toThrow(/Unknown node\/group nope/);
  });

  it('anchors a note to a message only in a sequence', () => {
    expect(() => checkSource(SOURCE + 'note "x" near=e1\n')).toThrow(/Only a sequence diagram/);
  });
});

const SEQ = `diagram "Sign-in" version=1
node user "User"
node app "Web app"
node auth "Auth"
edge m1 user -> app "sign in"
edge m2 app -> auth "verify"
edge m3 auth -> app "token" kind=async
edge m4 app -> user "welcome"
phase p1 "Check" m2 m3
layout root sequence
`;

const placed = (source: string) => {
  const scene = checkSource(source),
    doc = projectScene(scene),
    { vg, rects } = visibleRects(doc),
    { routes } = computeRoutes(doc, vg, rects, { previous: [] });
  return { scene, doc, routes, notes: placeNotes(doc, scene.look, rects, routes) };
};

describe('notes on messages', () => {
  it('sits level with the row in a margin, inside the panel, and moves nothing', () => {
    const long = 'A long note wraps over several lines in the margin and stays inside the frame.',
      noted = `${SEQ}note "${long}" near=m4\nnote "Over TLS." near=m1 side=left\n`,
      lanes = (s: string) =>
        checkSource(s).objects.map(o => [o.id, o.x, o.y, o.w, o.h, o.lifeline]),
      rows = (s: string) => checkSource(s).edges.map(e => [e.id, e.row]);
    expect(lanes(noted)).toEqual(lanes(SEQ));
    expect(rows(noted)).toEqual(rows(SEQ));
    const { doc, notes, routes } = placed(noted),
      seq = doc.layout.sequence!,
      row = (id: string) => routes.find(r => r.id === id)!.points[0].y,
      [right, left] = notes,
      boxes = checkSource(SEQ).objects;
    expect(right.overlaps).toBeUndefined();
    expect(right.rect.x).toBeGreaterThan(Math.max(...boxes.map(o => o.x + o.w)));
    expect(left.rect.x + left.rect.w).toBeLessThan(Math.min(...boxes.map(o => o.x)));
    expect(left.rect.y + left.rect.h / 2).toBeCloseTo(row('m1'), -0.5);
    for (const n of notes) expect(contains(seq.panel, n.rect)).toBe(true);
    // The tall note on the last row reaches past the rows, so the panel grows down round it.
    expect(right.rect.y + right.rect.h).toBeGreaterThan(row('m4'));
  });

  it('keeps a phase label out of a left margin note', () => {
    const before = projectScene(checkSource(SEQ)).layout.sequence!,
      { doc, notes } = placed(`${SEQ}note "Over TLS." near=m1 side=left\n`),
      seq = doc.layout.sequence!;
    expect(seq.phaseX).toBe(before.panel.x);
    expect(notes[0].rect.x + notes[0].rect.w).toBeLessThanOrEqual(before.panel.x);
  });

  it('stacks margin notes that would touch, in row order', () => {
    const { notes } = placed(`${SEQ}note "On two." near=m2\nnote "On one." near=m1\n`);
    expect(notes[1].rect.y + notes[1].rect.h).toBeLessThanOrEqual(notes[0].rect.y);
  });

  it('finds a clear spot above or below a row, or reports that it has none', () => {
    const free = placed(`${SEQ}note "Retry." near=m4 side=below\n`),
      taken = `${SEQ}note "Nowhere to go for this note." near=m1 side=above\n`,
      codes = sceneConflicts(checkSource(taken)).map(d => d.code);
    expect(free.notes[0].overlaps).toBeUndefined();
    expect(free.notes[0].inFrame).toBeUndefined();
    expect(free.notes[0].rect.y).toBeGreaterThan(checkSource(SEQ).edges[3].row!);
    expect(codes).toContain('note-overlap');
  });

  it('keeps the words of a note when its message or participant is deleted', () => {
    const edit = (change: (d: ReturnType<typeof readSource>) => void) => {
      const d = readSource(`${SEQ}note "Over TLS." near=m1 side=left width=200\n`);
      change(d);
      const out = printSource(d);
      expect(projectScene(checkSource(out)).appearance.notes).toEqual([
        { text: 'Over TLS.', width: 200 },
      ]);
    };
    edit(d => removeEdge(d, 'm1'));
    edit(d => {
      removeReferences(d, 'user');
      removeWhere(d, s => s.command === 'node' && s.args[0]?.value === 'user');
    });
  });

  it('saves canvas edits to notes, legend rows and phase labels on their own lines', () => {
    const source = `diagram "Sign in" version=1
node app "App"
node auth "Auth"
edge m1 app -> auth "verify"
edge m2 auth -> app "token"
# Why the token is short.
note "Lasts 15 minutes." near=m2
note "Second note." near=app
phase check "Check" m1
legend violet "Owns credentials"
layout root sequence
`;
    const edit = (fn: (d: Diagram) => void) => {
      const scene = checkSource(source),
        before = projectScene(scene),
        after = clone(before);
      fn(after);
      return printSource(
        translateEdit({
          source: readSource(source),
          scene,
          before: normalize(JSON.parse(JSON.stringify(before))),
          after: normalize(JSON.parse(JSON.stringify(after))),
          label: 'Edit',
          selection: [],
        }).source,
      );
    };
    expect(
      edit(d => {
        setTextValue(d, textId('note', 0), 'Lasts 5 minutes.');
        Object.assign(d.appearance.notes![1], { near: 'auth', side: 'left' });
        setTextValue(d, textId('legend', 0), 'Holds credentials');
        setTextValue(d, textId('phase', 'check'), 'Checks');
      }),
    ).toBe(
      source
        .replace('"Lasts 15 minutes."', '"Lasts 5 minutes."')
        .replace('near=app', 'near=auth side=left')
        .replace('"Owns credentials"', '"Holds credentials"')
        .replace('"Check"', '"Checks"'),
    );
    // An emptied note is removed; the comment above the next line stays where it was.
    expect(edit(d => setTextValue(d, textId('note', 0), ''))).toBe(
      source.replace('note "Lasts 15 minutes." near=m2\n', ''),
    );
  });
});

describe('note ids', () => {
  const NOTED = SOURCE + 'note billing "Billed monthly." near=seat\nnote "A plan is one tier."\n';

  it('takes an optional ID before the text, and an old note parses as before', () => {
    const notes = projectScene(checkSource(NOTED)).appearance.notes!;
    expect(notes).toEqual([
      { id: 'billing', text: 'Billed monthly.', near: 'seat' },
      { text: 'A plan is one tier.' },
    ]);
    expect(printSource(readSource(NOTED))).toBe(NOTED);
  });

  it('rejects a duplicate ID, or one an object or connection has', () => {
    expect(() => checkSource(SOURCE + 'note n "One."\nnote n "Two."\n')).toThrow(/Duplicate/);
    expect(() => checkSource(SOURCE + 'note seat "One." near=seat\n')).toThrow(/its own/);
    expect(() => checkSource(SOURCE + 'note e1 "One."\n')).toThrow(/its own/);
  });

  it('draws the ID on the note, and a canvas edit keeps it', () => {
    const scene = checkSource(NOTED),
      before = projectScene(scene);
    expect(renderSvg(before)).toContain('<g class="diagram-note" data-note="billing">');
    const after = clone(before);
    setTextValue(after, textId('note', 0), 'Billed yearly.');
    const saved = translateEdit({
      source: readSource(NOTED),
      scene,
      before: normalize(JSON.parse(JSON.stringify(before))),
      after: normalize(JSON.parse(JSON.stringify(after))),
      label: 'Edit',
      selection: [],
    }).source;
    expect(printSource(saved)).toContain('note billing "Billed yearly." near=seat\n');
  });
});
