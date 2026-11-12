import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSource, compile } from '../src/dsl/compile';
import { projectScene, visibleRects } from '../src/dsl/project';
import { computeRoutes } from '../src/model/routes';

import {
  PRESETS,
  contrast,
  forScheme,
  resolveAppearance,
  type ThemeId,
} from '../src/model/appearance';
import { drawnSwatch, participantAccent } from '../src/model/colors';
import { edgeLabelLines, edgeLabelSize } from '../src/model/labels';

const login = readFileSync(path.join(__dirname, '../examples/login-sequence.draft'), 'utf8');

describe('sequence diagrams', () => {
  it('put participants across the top and messages on rows in file order', () => {
    const scene = checkSource(login),
      xs = ['user', 'app', 'auth', 'db'].map(id => scene.byId.get(id)!);
    xs.slice(1).forEach((p, i) => expect(p.x).toBeGreaterThan(xs[i].x + xs[i].w));
    expect(new Set(xs.map(p => p.y))).toEqual(new Set([0]));
    const rows = scene.edges.map(e => e.row!);
    rows.slice(1).forEach((r, i) => expect(r).toBeGreaterThan(rows[i]));
    for (const p of xs) expect(p.y + p.h + p.lifeline!).toBeGreaterThan(rows.at(-1)!);
  });

  it('draws each message straight between the two lifelines', () => {
    const doc = projectScene(checkSource(login)),
      { vg, rects } = visibleRects(doc),
      { routes } = computeRoutes(doc, vg, rects),
      mid = (id: string) => rects.get(id)!.x + rects.get(id)!.w / 2,
      verify = routes.find(r => r.id === 'm2')!;
    expect(verify.points).toEqual([
      { x: mid('app'), y: doc.layout.edges.m2.row },
      { x: mid('auth'), y: doc.layout.edges.m2.row },
    ]);
    expect(routes.find(r => r.id === 'm5')!.points).toHaveLength(4);
  });

  it('takes only top-level groups, as bands of participants', () => {
    expect(() =>
      checkSource('group g "G"\ngroup h "H" in=g\nnode a "A" in=h\nlayout root sequence'),
    ).toThrow(/a group is a band of participants/);
  });
});

describe('sequence messages', () => {
  const source = [
    'diagram "S" version=1',
    'node a "Job"',
    'node b "Ledger output"',
    'edge m1 a -> b "Output queue schedule request output worker"',
    'edge m2 b -> b "Upload ledger retry preview result sync"',
    'layout root sequence',
  ].join('\n');

  it('wraps labels, sits them above their line, and keeps participants narrow', async () => {
    const doc = projectScene(await compile(source)),
      look = resolveAppearance(doc.appearance),
      { vg, rects } = visibleRects(doc),
      { routes } = computeRoutes(doc, vg, rects);
    const m1 = routes.find(r => r.id === 'm1')!,
      m2 = routes.find(r => r.id === 'm2')!;
    expect(edgeLabelLines('Output queue schedule request output worker', look, true).length).toBe(
      2,
    );
    // Above the line, centred between the lifelines.
    expect(m1.label!.y + m1.label!.h / 2).toBeLessThanOrEqual(m1.points[0].y);
    expect(m1.label!.x).toBe((m1.points[0].x + m1.points[1].x) / 2);
    // A self-message's label sits beside its loop.
    expect(m2.label!.x - m2.label!.w / 2).toBeGreaterThan(m2.points[1].x);
    // A short title gets a box only as wide as it needs, not the default 164.
    expect(rects.get('a')!.w).toBeLessThan(164);
    // The first message's label clears the participant row.
    expect(m1.label!.y - m1.label!.h / 2).toBeGreaterThan(rects.get('a')!.y + rects.get('a')!.h);
  });
});

describe('sequence groups and phases', () => {
  const source = [
    'diagram "Bands" version=1',
    'group client "Client" color=blue',
    'group server "Server" color=teal',
    'node a "Store" shape=pill',
    'node b "Ledger" in=client',
    'node d "Archive" in=server',
    'node c "Handler" in=client',
    'edge m1 a -> b "load"',
    'edge m2 b -> c "check"',
    'edge m3 c -> d "write"',
    'edge m4 d -> a "done" kind=async',
    'phase preview "Preview" m1 m2',
    'phase apply "Apply" m3 m4',
    'layout root sequence',
  ].join('\n');

  it("keeps a group's participants together under its column band", async () => {
    const scene = await compile(source),
      at = (id: string) => scene.byId.get(id)!;
    // c is declared after d, but sits next to b inside the client band.
    expect(at('c').x).toBeLessThan(at('d').x);
    for (const [g, ids] of [
      ['client', ['b', 'c']],
      ['server', ['d']],
    ] as const)
      for (const id of ids) {
        expect(at(id).x).toBeGreaterThan(at(g).x);
        expect(at(id).x + at(id).w).toBeLessThan(at(g).x + at(g).w);
      }
    expect(at('a').x + at('a').w).toBeLessThan(at('client').x);
  });

  it('draws each phase as a row band over its messages, inside the panel', async () => {
    const scene = await compile(source),
      seq = scene.sequence!,
      row = (id: string) => scene.edges.find(e => e.id === id)!.row!;
    expect(seq.phases.map(p => p.id)).toEqual(['preview', 'apply']);
    const [preview, apply] = seq.phases;
    expect(preview.y).toBeLessThan(row('m1'));
    expect(preview.y + preview.h).toBeGreaterThan(row('m2'));
    expect(preview.y + preview.h).toBeLessThanOrEqual(apply.y + 1);
    for (const p of seq.phases) {
      expect(p.y).toBeGreaterThanOrEqual(seq.panel.y);
      expect(p.y + p.h).toBeLessThanOrEqual(seq.panel.y + seq.panel.h);
    }
  });

  it('refuses a phase that lists something other than a message', () => {
    expect(() => checkSource(source.replace('m3 m4', 'm3 nope'))).toThrow(/Unknown message nope/);
  });
});

describe('sequence lane order', () => {
  const lanes = (...lines: string[]) => {
    const scene = checkSource([...lines, 'layout root sequence'].join('\n'));
    return scene.objects
      .filter(o => o.type === 'node')
      .sort((a, b) => a.x - b.x)
      .map(o => o.id);
  };
  const band = ['group g "G"', 'node a "A" in=g', 'node z "Z"', 'node b "B" in=g'];

  it('applies the root order to groups and participants, then each group its own', () => {
    expect(lanes(...band)).toEqual(['a', 'b', 'z']);
    expect(lanes(...band, 'order root z g')).toEqual(['z', 'a', 'b']);
    expect(lanes(...band, 'order g b a')).toEqual(['b', 'a', 'z']);
    expect(lanes(...band, 'order root z g', 'order g b a')).toEqual(['z', 'b', 'a']);
    expect(lanes(...band, 'order root g z', 'order g b a')).toEqual(['b', 'a', 'z']);
  });

  it('keeps a group whole where the root order puts it', () => {
    const file = ['group g "G"', 'node a "A" in=g', 'node b "B"', 'node c "C" in=g'];
    expect(lanes(...file, 'order root g b')).toEqual(['a', 'c', 'b']);
    expect(lanes(...file, 'order root g b', 'order g c a')).toEqual(['c', 'a', 'b']);
  });
});

describe('sequence validation', () => {
  const nodes = ['node a "A"', 'node b "B"'],
    messages = ['edge m1 a -> b "1"', 'edge m2 b -> a "2"', 'edge m3 a -> b "3"'];
  const check = (...lines: string[]) =>
    checkSource([...nodes, ...messages, ...lines, 'layout root sequence'].join('\n'));

  it('refuses a phase that skips a message, and keeps unphased messages legal', () => {
    expect(() => check('phase outer "Outer" m1 m3', 'phase inner "Inner" m2')).toThrow(
      /Phase outer skips m2.*Include it or split the phase/,
    );
    expect(() => check('phase first "First" m1 m2')).not.toThrow();
    expect(() => check('phase last "Last" m3 m2')).not.toThrow();
  });

  it('draws phases in message order, without overlap', () => {
    const { phases } = check('phase late "Late" m3', 'phase early "Early" m1 m2').sequence!;
    expect(phases.map(p => p.id)).toEqual(['early', 'late']);
    expect(phases[0].y + phases[0].h).toBeLessThanOrEqual(phases[1].y);
  });

  it('refuses a message that ends on a group only in a sequence', () => {
    const file = ['group g "G"', 'node a "A" in=g', 'node b "B"', 'edge m1 g -> b "Wrong"'];
    expect(() => checkSource([...file, 'layout root sequence'].join('\n'))).toThrow(
      /m1 on one of its participants/,
    );
    expect(() => checkSource(file.join('\n'))).not.toThrow();
  });

  it('refuses an empty band, and keeps an empty diagram editable', () => {
    expect(() => checkSource('group empty "Empty"\nnode a "A"\nlayout root sequence')).toThrow(
      /Group empty has no participants/,
    );
    const empty = checkSource('diagram "Empty" version=1\nlayout root sequence');
    expect(empty.sequence).toBeUndefined();
    expect(empty.objects).toEqual([]);
  });
});

describe('sequence spacing', () => {
  const look = resolveAppearance();
  const centres = (scene: ReturnType<typeof checkSource>, ...ids: string[]) =>
    ids.map(id => scene.byId.get(id)!).map(o => o.x + o.w / 2);

  it("holds a distant message's lanes apart by its whole label", () => {
    const scene = checkSource(
      [
        'theme drafting padding-y=4',
        'node a "A"',
        'node b "B"',
        'node c "C"',
        'size a width=40 height=32',
        'size b width=40 height=32',
        'size c width=40 height=32',
        'edge e a -> c "MMMMMMMMMMMMMMMMMMM"',
        'order root a b c',
        'layout root sequence',
      ].join('\n'),
    );
    expect(centres(scene, 'a', 'b', 'c')).toEqual([36, 116, 228]);
  });

  const self = (label: string, ...rest: string[]) =>
    [
      'node a "A"',
      'node b "B"',
      'node c "C"',
      `edge m1 b -> b "${label}"`,
      ...rest,
      'layout root sequence',
    ].join('\n');
  const labels = (source: string) => {
    const doc = projectScene(checkSource(source)),
      { vg, rects } = visibleRects(doc);
    return new Map(computeRoutes(doc, vg, rects).routes.map(r => [r.id, r]));
  };

  it("keeps a self-message's loop and label clear of the next lane", () => {
    const text = 'check password hash and more',
      source = self(text),
      scene = checkSource(source),
      [, b, c] = centres(scene, 'a', 'b', 'c'),
      m1 = labels(source).get('m1')!;
    expect(c).toBeGreaterThanOrEqual(b + 36 + 4 + edgeLabelSize(text, look, true).w + 8);
    expect(c - (m1.label!.x + m1.label!.w / 2)).toBeGreaterThanOrEqual(8);
  });

  it("grows the panel for a self-message on the last lane, and its band's edge", () => {
    const text = 'check password hash and more',
      source = ['group g "G"', 'node a "A"', 'node c "C" in=g', `edge m1 c -> c "${text}"`];
    const file = [...source, 'layout root sequence'].join('\n'),
      scene = checkSource(file),
      { label } = labels(file).get('m1')!,
      { panel } = scene.sequence!,
      group = scene.byId.get('g')!;
    expect(panel.x + panel.w).toBeGreaterThanOrEqual(label!.x + label!.w / 2 + 20);
    expect(group.x + group.w).toBeGreaterThanOrEqual(label!.x + label!.w / 2);
  });

  it('puts the row after a self-message below its label', () => {
    const long = 'load the account row then verify the salted password hash against it twice',
      source = self(long, 'edge m2 a -> c "next"'),
      routes = labels(source),
      m1 = routes.get('m1')!.label!,
      m2 = routes.get('m2')!.label!;
    expect(edgeLabelSize(long, look, true).h).toBeGreaterThan(40);
    expect(m2.y - m2.h / 2).toBeGreaterThanOrEqual(m1.y + m1.h / 2 + 8);
  });

  it('keeps the lifelines past a tall last self-message', () => {
    const long = 'load the account row then verify the salted password hash against it twice',
      source = self(long),
      m1 = labels(source).get('m1')!.label!,
      b = checkSource(source).byId.get('b')!;
    expect(b.y + b.h + b.lifeline!).toBeGreaterThan(m1.y + m1.h / 2);
  });
});

describe('sequence headers', () => {
  it('outlines a participant with no color in every theme', () => {
    for (const theme of Object.keys(PRESETS) as ThemeId[]) {
      // The dark default has no theme line: a dark page draws a file without one in it.
      const dark = theme === 'drafting-dark',
        line = dark ? '' : `theme ${theme}\n`,
        doc = projectScene(
          checkSource(`${line}node a "A"\nnode b "B" color=blue\nlayout root sequence`),
        ),
        look = resolveAppearance(forScheme(doc.appearance, dark)),
        plain = drawnSwatch(doc, look, 'a', 'node');
      expect(contrast(plain.stroke, plain.fill)).toBeGreaterThan(1.5);
      expect(participantAccent(doc, look, 'a')).toBeUndefined();
      expect(participantAccent(doc, look, 'b')).toBe(drawnSwatch(doc, look, 'b', 'node').stroke);
    }
  });
});
