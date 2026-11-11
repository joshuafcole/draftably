import { describe, expect, it } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { compareDetailed } from '../src/dsl/compare';
import { checkSource } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import { formatSource, parseModel } from '../src/dsl/syntax';
import { normalize } from '../src/model/document';
import { panelDoc } from '../src/model/panels';
import { positionMarks } from '../src/model/position-marks';
import { isDiff, statusLabel, usedStatuses } from '../src/model/status';
import type { Diagram, Rect } from '../src/model/types';

const BOX: Rect = { x: 400, y: 300, w: 160, h: 60 };
// What the drawing covers; the marks frame it `MARK_REACH` (20) wider, at 0,0 to 1000,800.
const BOUNDS: Rect = { x: 20, y: 20, w: 960, h: 760 };

/** One node drawn at `BOX`, with an old corner or size. */
function marks(past: { wasAt?: { x: number; y: number }; wasSize?: { w: number; h: number } }) {
  const doc = {
    graph: { nodes: [{ id: 'a', title: 'A', ...past }], groups: [], edges: [] },
  } as unknown as Diagram;
  return positionMarks(doc, new Map([['a', BOX]]), BOUNDS);
}

describe('position marks: the four hairline rules', () => {
  it('a resize takes a ghost and no hairline, however large', () => {
    const m = marks({ wasSize: { w: 600, h: 300 } });
    expect(m.ghosts).toEqual([{ id: 'a', rect: { x: 400, y: 300, w: 600, h: 300 } }]);
    expect(m.hairlines).toEqual([]);
    expect(m.terminators).toEqual([]);
  });

  it('a ghost that overlaps its own box takes no hairline', () => {
    const m = marks({ wasAt: { x: 440, y: 320 } });
    expect(m.ghosts).toHaveLength(1);
    expect(m.hairlines).toEqual([]);
  });

  it('a clear move takes exactly one hairline, from the ghost to a dot on the box', () => {
    const m = marks({ wasAt: { x: 40, y: 300 } });
    expect(m.ghosts).toEqual([{ id: 'a', rect: { x: 40, y: 300, w: 160, h: 60 } }]);
    // The ghost is level with the box and left of it: right edge to left edge, at mid height.
    expect(m.hairlines).toEqual([{ id: 'a', from: { x: 200, y: 330 }, dot: { x: 400, y: 330 } }]);
    expect(m.terminators).toEqual([]);
  });

  it('an origin off the frame is a line to the frame edge, with no ghost', () => {
    const m = marks({ wasAt: { x: 1400, y: 310 } });
    expect(m.ghosts).toEqual([]);
    expect(m.hairlines).toEqual([]);
    expect(m.terminators).toEqual([
      { id: 'a', dot: { x: 560, y: 330 }, at: { x: 1000, y: 330 }, edge: 'right' },
    ]);
  });

  it('draws nothing where the old box is the box', () => {
    const m = marks({ wasAt: { x: 400, y: 300 }, wasSize: { w: 160, h: 60 } });
    expect(m).toEqual({ ghosts: [], hairlines: [], terminators: [] });
  });
});

describe('was-at and was-size', () => {
  it('read on a ~ line, keep through format, and refuse elsewhere', () => {
    const line = '~node a "A" was-at=10,-20 was-size=160,56\n';
    expect(parseModel(line).objects[0]).toMatchObject({
      wasAt: { x: 10, y: -20 },
      wasSize: { w: 160, h: 56 },
    });
    expect(formatSource(line)).toBe(line);
    expect(parseModel('~group g "G" was-at=4,8\n').objects[0].wasAt).toEqual({ x: 4, y: 8 });
    expect(() => parseModel('+node a "A" was-at=1,2\n')).toThrow(/was-at= belongs on a changed/);
    expect(() => parseModel('-node a "A" was-size=1,2\n')).toThrow(
      /was-size= belongs on a changed/,
    );
    // An old label, shape or count is a change, so it still needs the mark.
    expect(() => parseModel('node a "A" was="B"\n')).toThrow(/was= belongs on a changed/);
    expect(() => parseModel('node a "A" was-count=2\n')).toThrow(/was-count= belongs on a changed/);
    expect(() => parseModel('~group g "G" was-size=1,2\n')).toThrow(/Unknown group attribute/);
    expect(() => parseModel('~node a "A" was-at=1\n')).toThrow(/Expected was-at=a,b/);
    expect(() => parseModel('~node a "A" was-size=0,40\n')).toThrow(/Expected was-size=a,b/);
    expect(() => parseModel('~node a "A" was-at="1,2"\n')).toThrow(/Expected was-at=a,b/);
  });

  it('place the old corner in the parent content area, as pin does, and survive JSON', () => {
    const source = 'group g "G"\n~node a "A" in=g was-at=0,0\nnode b "B" in=g\npin a x=0 y=0\n',
      doc = normalize(JSON.parse(JSON.stringify(projectScene(checkSource(source))))),
      a = doc.layout.nodes.a;
    // The file pins `a` at the corner it says it was at, so the two meet.
    expect(doc.graph.nodes.find(n => n.id === 'a')!.wasAt).toEqual({ x: a.x, y: a.y });
  });

  it('never move anything: the merged geometry is the geometry without them', () => {
    const plain =
        'node a "A"\nnode b "B"\nedge e a -> b\npin a x=300 y=0\nsize b width=200 height=80\n',
      marked = plain
        .replace('node a "A"', '~node a "A" was-at=0,400')
        .replace('node b "B"', '~node b "B" was-size=100,40');
    const at = (s: string) => projectScene(checkSource(s)).layout.nodes;
    expect(at(marked)).toEqual(at(plain));
  });
});

describe('compare writes position marks', () => {
  it('writes was-at when a pin or stay moved, and carries the line it replaces', () => {
    const { merged, unshown } = compareDetailed(
      'node a "A"\nnode b "B"\npin a x=10 y=20\nstay b x=0 y=0\n',
      'node a "A"\nnode b "B"\npin a x=300 y=20\n',
    );
    expect(merged).toBe('~node a "A" was-at=10,20\n~node b "B" was-at=0,0\npin a x=300 y=20\n');
    expect(unshown).toEqual([]);
  });

  it('writes was-size when an explicit size changed', () => {
    const { merged, unshown } = compareDetailed(
      'node a "A"\nsize a width=160 height=56\n',
      'node a "A" color=red\nsize a width=240 height=80\n',
    );
    expect(merged).toBe('~node a "A" color=red was-size=160,56\nsize a width=240 height=80\n');
    expect(unshown).toEqual(['a (color)']);
  });

  it('writes was-at for a group and leaves its members alone', () => {
    const { merged } = compareDetailed(
      'group g "G"\nnode a "A" in=g\npin g x=0 y=0\n',
      'group g "G"\nnode a "A" in=g\npin g x=500 y=0\n',
    );
    expect(merged).toBe('~group g "G" was-at=0,0\nnode a "A" in=g\npin g x=500 y=0\n');
  });

  it('still reports a place the older file never gave', () => {
    const { merged, unshown } = compareDetailed(
      'node a "A"\nnode b "B"\nsize b width=160 height=auto\n',
      'node a "A"\nnode b "B"\npin a x=40 y=40\nsize b width=200 height=auto\n',
    );
    expect(merged).not.toContain('was-');
    expect(unshown).toEqual(['size b', 'pin a']);
  });

  it('draws a ghost and a hairline, and keys them in the legend', () => {
    const { merged } = compareDetailed(
      'node a "A"\nnode b "B"\npin a x=0 y=0\npin b x=0 y=120\nsize b width=160 height=56\n',
      'node a "A"\nnode b "B"\npin a x=400 y=0\npin b x=0 y=120\nsize b width=240 height=90\n',
    );
    const doc = projectScene(checkSource(merged)),
      svg = renderSvg(doc);
    expect(svg.match(/<rect data-was="a"/g)).toHaveLength(1);
    expect(svg.match(/<rect data-was="b"/g)).toHaveLength(1);
    expect(svg.match(/<g data-was="a"><line/g)).toHaveLength(1);
    expect(svg).not.toContain('<g data-was="b">');
    expect(usedStatuses(doc).map(statusLabel)).toEqual(['2 changed', '1 moved', '1 resized']);
  });
});

describe('a move with no change mark', () => {
  const SRC = 'node a "A"\nnode b "B"\nedge e a -> b\npin a x=300 y=0\n',
    compile = (source: string) => projectScene(checkSource(source)),
    key = (doc: Diagram) => usedStatuses(doc).map(c => `${c.status}:${c.count}/${c.lines}`);

  it('parses without a mark and keeps no status', () => {
    const line = 'node a "A" was-at=10,20 was-size=160,56\n',
      [a] = parseModel(line).objects;
    expect(a).toMatchObject({ wasAt: { x: 10, y: 20 }, wasSize: { w: 160, h: 56 } });
    expect(a.status).toBeUndefined();
    expect(formatSource(line)).toBe(line);
    expect(parseModel('group g "G" was-at=4,8\n').objects[0].wasAt).toEqual({ x: 4, y: 8 });
  });

  it('makes the document a diff, and a document with neither mark nor place is not one', () => {
    expect(isDiff(compile(SRC.replace('node a "A"', 'node a "A" was-at=0,0')))).toBe(true);
    expect(isDiff(compile(SRC.replace('node b "B"', 'node b "B" was-size=100,40')))).toBe(true);
    expect(isDiff(compile(SRC.replace('node a "A"', '~node a "A"')))).toBe(true);
    expect(isDiff(compile(SRC))).toBe(false);
  });

  it('counts as moved and not as changed, and draws its ghost', () => {
    const doc = compile(SRC.replace('node a "A"', 'node a "A" was-at=0,0'));
    expect(key(doc)).toEqual(['moved:1/0']);
    expect(doc.styles.a?.status).toBeUndefined();
    expect(renderSvg(doc)).toContain('stroke-dasharray="2 3"');
    expect(key(compile(SRC.replace('node b "B"', 'node b "B" was-size=100,40')))).toEqual([
      'resized:1/0',
    ]);
  });

  it('a ~ line with was-at still counts under both', () => {
    const doc = compile(SRC.replace('node a "A"', '~node a "A" was-at=0,0'));
    expect(key(doc)).toEqual(['changed:1/0', 'moved:1/0']);
  });

  it('stays in both panels, with its ghost', () => {
    const doc = compile(SRC.replace('node a "A"', 'node a "A" was-at=0,0'));
    for (const side of ['before', 'after'] as const) {
      const panel = panelDoc(doc, side);
      expect(panel.graph.nodes.map(n => n.id)).toEqual(['a', 'b']);
      expect(panel.graph.nodes.find(n => n.id === 'a')!.wasAt).toEqual({ x: 0, y: 0 });
      expect(isDiff(panel)).toBe(true);
      expect(key(panel)).toEqual(['moved:1/0']);
    }
  });
});
