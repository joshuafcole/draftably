import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ExplorerLab } from '../src/engines/explorer-engine';
import { compile } from '../src/dsl/compile';
import { sceneConflicts } from '../src/dsl/conflicts';
import {
  applyEdits,
  autoVariants,
  draw,
  grid,
  improves,
  neighbors,
  parseTry,
  shapeOf,
  sweep,
  vary,
  type Edit,
  type Metrics,
} from '../src/cli/variants';

const SOURCE = `diagram "Orders"

# Intake
group intake "Intake" color=blue
node web "Web" in=intake
node api "API" in=intake
node queue "Queue"
node worker "Worker"
node db "Database"

edge a web -> api
edge b api -> queue
edge c queue -> worker
edge d worker -> db
edge e api -> db

layout root flow gap=48 # keep this note
stay worker x=400 y=0
`;

const auto = async (lines: string[]) => {
  const scene = await compile(['diagram "Auto" version=1', ...lines].join('\n'));
  return autoVariants(scene, sceneConflicts(scene));
};

describe('vary', () => {
  it('changes only the layout line it names and keeps comments and refinements', () => {
    const { source, changes } = applyEdits(SOURCE, [
      { kind: 'layout', scope: 'root', attrs: { engine: 'layered', direction: 'down' } },
    ]);
    expect(changes).toEqual([
      {
        line: 17,
        before: 'layout root flow gap=48 # keep this note',
        after: 'layout root engine=layered direction=down # keep this note',
      },
    ]);
    const before = SOURCE.split('\n'),
      after = source.split('\n');
    expect(after.filter((l, i) => l !== before[i])).toEqual([changes[0].after]);
  });

  it('adds a routing line after the layout lines', () => {
    const { source, changes } = applyEdits(SOURCE, [
      { kind: 'routing', attrs: { 'crossing-penalty': '900' } },
    ]);
    expect(changes).toEqual([{ line: 0, after: 'routing crossing-penalty=900' }]);
    expect(source.split('\n')[17]).toBe('routing crossing-penalty=900');
  });

  it('gives the same variants twice and never recommends one worse than the file', async () => {
    const a = await vary(SOURCE),
      b = await vary(SOURCE);
    const strip = (r: typeof a) =>
      r.variants.map(({ id, title, edits, metrics }) => ({ id, title, edits, metrics }));
    expect(strip(a)).toEqual(strip(b));
    expect(a.variants.length).toBeLessThanOrEqual(5);
    expect(a.variants[0].id).toBe('v0');
    const pick = a.variants.find(v => v.id === a.recommended)!;
    if (pick.id !== 'v0') expect(improves(pick.metrics!, a.variants[0].metrics!)).toBe(true);
  });

  it("keeps each variant's drawing with `drawings`, and changes nothing else", async () => {
    const plain = await vary(SOURCE),
      kept = await vary(SOURCE, { drawings: true });
    expect(kept.variants).toEqual(plain.variants);
    expect(kept.recommended).toBe(plain.recommended);
    expect([...kept.drawn.keys()]).toEqual([...plain.drawn.keys()]);
    for (const [id, measured] of plain.drawn) {
      expect(measured.drawing).toBeUndefined();
      const { drawing, ...rest } = kept.drawn.get(id)!;
      expect(rest).toEqual(measured);
      // The drawing is the one the source draws: the same picture as drawing it again.
      const again = await draw(measured.source);
      expect(drawing!.svg).toBe(measured.svg);
      expect(drawing!.key).toBe(again.key);
      expect([...drawing!.rects]).toEqual([...again.rects]);
      expect(drawing!.routes.map(r => [r.id, r.points])).toEqual(
        again.routes.map(r => [r.id, r.points]),
      );
    }
  });

  it('takes --try steps from the viewer Compare parameters', () => {
    expect(parseTry('rank-gap').values).toEqual(
      ExplorerLab.layoutParams.rankGap.values.map(String),
    );
    expect(parseTry('edge-gap').values).toEqual(ExplorerLab.routeParams.edgeGap.values.map(String));
    expect(() => parseTry('rank-gap=999')).toThrow('use 12 to 220');
  });

  it('sweeps direction on a file with no layout line', async () => {
    const result = await vary('node a "A"\nnode b "B"\nedge e a -> b\n', {
      axes: [parseTry('direction')],
    });
    expect(result.failed).toEqual([]);
    expect(result.drawn.get('v2')!.source).toContain('layout root flow direction=down');
  });

  it('does not call a cell marker an overlap', async () => {
    const scene = await compile(
      `group req "Request"
layout req cells
node a "First part" in=req
node cp "cache point" in=req shape=marker
node b "Second part" in=req`,
    );
    expect(sceneConflicts(scene)).toEqual([]);
  });

  it('gives a built-in recipe an engine when a sweep sets an engine setting', async () => {
    const shape = shapeOf(await compile(SOURCE));
    const [first] = sweep(shape, [parseTry('rank-gap=52'), parseTry('crossing-penalty=900')]);
    expect(first.edits).toEqual([
      { kind: 'layout', scope: 'root', attrs: { engine: 'compound-flow', 'rank-gap': '52' } },
      { kind: 'routing', attrs: { 'crossing-penalty': '900' } },
    ]);
    expect(() => sweep(shape, [parseTry('engine'), parseTry('direction')])).toThrow('12 or fewer');
  });

  it('tries engines on a lanes root and keeps the lanes as v0', async () => {
    const shape = shapeOf(await compile(fs.readFileSync('examples/support-lanes.draft', 'utf8')));
    expect(shape.fixed).toBe('lanes');
    expect(grid(shape).length).toBe(6);
    expect(sweep(shape, [parseTry('engine=layered,flow')]).length).toBe(2);
    const seq = shapeOf(
      await compile(
        'diagram "S"\nnode a "A"\nnode b "B"\nedge e a -> b "go"\nlayout root sequence',
      ),
    );
    expect(() => grid(seq)).toThrow('--grid varies engines');
  });

  it('stops at --budget, keeps v0 and reports what it skipped', async () => {
    const seen: string[] = [];
    let elapsed = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsed);
    try {
      const result = await vary(SOURCE, {
        grid: true,
        budget: 0,
        progress: d => {
          seen.push(d.title);
          elapsed = 1;
        },
      });
      expect(result.variants.map(v => v.id)).toEqual(['v0', 'v1']);
      expect(result.skipped).toBe(5);
      expect(seen).toEqual([result.variants[1].title]);
    } finally {
      clock.mockRestore();
    }
  });

  it('lets --fit trade area for the target shape, never crossings', () => {
    const m = (width: number, height: number, crossings = 0): Metrics => ({
      width,
      height,
      crossings,
      bends: 0,
      length: 0,
      warnings: 0,
      moved: 0,
    });
    const tall = m(700, 1000);
    expect(improves(m(1200, 700), tall)).toBe(false);
    expect(improves(m(1200, 700), tall, 'slide')).toBe(true);
    expect(improves(m(1200, 700, 1), tall, 'slide')).toBe(false);
    // Sprawl: the right shape, but three times the room.
    expect(improves(m(1800, 1000), m(900, 600), 'slide')).toBe(false);
  });

  it('searches around a variant while keeping its own edits', async () => {
    const shape = shapeOf(await compile(SOURCE));
    const pick = [
      { kind: 'layout' as const, scope: 'root', attrs: { engine: 'layered', 'rank-gap': '52' } },
    ];
    const list = neighbors(shape, { id: 'v2', edits: pick });
    expect(list[0]).toEqual({ edits: pick, why: 'the earlier v2 as it was' });
    const attrs = (e: Edit) => ('attrs' in e ? e.attrs : {});
    expect(list.map(n => attrs(n.edits[0])['rank-gap'])).toContain('88');
    expect(list.map(n => attrs(n.edits[0])['rank-gap'])).toContain('28');
    for (const n of list) expect(attrs(n.edits[0]).engine).toBe('layered');
  });

  it('drops the refinement check blames for a conflict', async () => {
    const found = await auto([
      'node src "Source"',
      'node dst "Target"',
      'node n "North"',
      'node s "South"',
      'node e "East"',
      'node w "West"',
      'edge go src -> dst',
      'pin src x=0 y=200',
      'pin dst x=400 y=200',
      'pin n x=400 y=140',
      'pin s x=400 y=260',
      'pin w x=230 y=200',
      'pin e x=570 y=200',
    ]);
    expect(found[0].edits).toEqual([{ kind: 'drop', line: 13 }]);
  });

  it('softens groups that have no layout or position of their own', async () => {
    const found = await auto([
      'group big "Platform"',
      'group a "A" in=big',
      'node a1 "A1" in=a',
      'node a2 "A2" in=a',
      'group b "B" in=big',
      'node b1 "B1" in=b',
      'node x "Outside"',
      'edge e1 a1 -> a2',
      'edge e2 a2 -> b1',
      'edge e3 b1 -> x',
      'layout b column gap=20',
    ]);
    // `big` holds most of the drawing and `b` has its own layout line.
    expect(found.map(f => f.edits)).toEqual([
      [{ kind: 'group', id: 'a', attrs: { frame: 'soft' } }],
    ]);
  });

  it('offers compare panels for a marked file', async () => {
    const found = await auto(['node a "A"', '+node b "B"', '+edge e a -> b']);
    expect(found.map(f => f.edits)).toEqual([
      [{ kind: 'compare', attrs: { direction: 'right' } }],
      [{ kind: 'compare', attrs: { direction: 'down' } }],
    ]);
    const { source } = applyEdits('node a "A"\n+node b "B"\n', found[0].edits);
    expect(source).toContain('compare direction=right');
  });
});
