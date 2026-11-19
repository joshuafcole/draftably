import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LayoutLab } from '../src/engines/layout-engine';
import { RouteLab } from '../src/engines/routing-engine';
import { checkSource, compile } from '../src/dsl/compile';
import { sceneConflicts } from '../src/dsl/conflicts';
import { writeArrangement } from '../src/dsl/layout-edits';
import { projectScene, visibleRects } from '../src/dsl/project';
import { printSource, readSource } from '../src/dsl/syntax';
import { contains } from '../src/model/geometry';
import { computeRoutes } from '../src/model/routes';

// Issue #457: a `direction=right` release flow across three groups.
const repro = readFileSync(path.join(__dirname, 'fixtures/flow-sides.draft'), 'utf8');

async function drawn(text: string) {
  const doc = projectScene(await compile(text)),
    { vg, rects } = visibleRects(doc),
    { routes } = computeRoutes(doc, vg, rects, { previous: [] });
  return { rects, routes: new Map(routes.map(r => [r.id, r])) };
}

/** The viewer's Tidy in file mode: a layout pass saved back to the file as stays. */
async function tidy(text: string) {
  const scene = await compile(text),
    doc = projectScene(scene),
    { document } = await LayoutLab.compute(doc, { ...doc.settings, scope: 'all', mode: 'pass' }),
    source = readSource(text);
  writeArrangement(source, scene, document);
  return printSource(source);
}

/** Segments that run along a box or group border, within 2px of it. */
function onBorders(d: Awaited<ReturnType<typeof drawn>>) {
  const hits: string[] = [];
  for (const r of d.routes.values())
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1],
        b = r.points[i],
        vertical = Math.abs(a.x - b.x) < 0.01;
      for (const [id, box] of d.rects) {
        const [at, lo, hi, edges, from, to] = vertical
          ? [
              a.x,
              Math.min(a.y, b.y),
              Math.max(a.y, b.y),
              [box.x, box.x + box.w],
              box.y,
              box.y + box.h,
            ]
          : [
              a.y,
              Math.min(a.x, b.x),
              Math.max(a.x, b.x),
              [box.y, box.y + box.h],
              box.x,
              box.x + box.w,
            ];
        if (edges.some(v => Math.abs(at - v) < 2) && Math.min(hi, to) - Math.max(lo, from) > 1)
          hits.push(`${r.id} on ${id}`);
      }
    }
  return hits;
}

function expectForward(d: Awaited<ReturnType<typeof drawn>>) {
  const t = d.routes.get('t_latest')!;
  expect([t.fromSide, t.toSide]).toEqual(['right', 'left']);
  expect(d.routes.get('s_any')!.toSide).toBe('left');
  for (const id of ['a_latest', 'a_staging', 'a_prod'])
    expect(d.routes.get(id)!.blocked).toBe(false);
  expect(onBorders(d)).toEqual([]);
}

describe('flow edges keep to the reading direction (#457)', () => {
  it('leaves right, enters left, and keeps legs off box borders on first layout', async () => {
    expectForward(await drawn(repro));
  });

  it('keeps doing so after repeated Tidy', async () => {
    let text = repro;
    for (let i = 0; i < 3; i++) {
      text = await tidy(text);
      expectForward(await drawn(text));
    }
  });

  it('keeps a label too long for its gap inside its group and off every line (#471)', async () => {
    const d = await drawn(repro),
      label = d.routes.get('promote1')!.label!,
      box = { x: label.x - label.w / 2, y: label.y - label.h / 2, w: label.w, h: label.h },
      frame = d.rects.get('branches')!;
    expect(contains(frame, box)).toBe(true);
    const crossing = [...d.routes.values()].filter(r =>
      r.points.some((b, i) => {
        const a = r.points[i - 1];
        return (
          i &&
          Math.max(a.x, b.x) > box.x &&
          Math.min(a.x, b.x) < box.x + box.w &&
          Math.max(a.y, b.y) > box.y &&
          Math.min(a.y, b.y) < box.y + box.h
        );
      }),
    );
    expect(crossing.map(r => r.id)).toEqual([]);
  });

  it('honours a pinned side with a forward route', async () => {
    const pinned = repro.replace('"every merge"', '"every merge" from=right');
    const t = (await drawn(pinned)).routes.get('t_latest')!;
    expect(t.toSide).toBe('left');
    // Up beside main, never back under it to leave its group on the left.
    expect(Math.min(...t.points.map(p => p.x))).toBeGreaterThanOrEqual(235);
  });

  it('warns in check when no forward route is clear', () => {
    // A wall over the gap and the target's left: only a backward side reaches it.
    const scene = checkSource(`diagram "t"
node a "A"
node b "B"
node c "Wall"
edge e a -> b
layout root engine=layered direction=right
pin a x=0 y=100
pin c x=200 y=0
pin b x=260 y=100
size c width=40 height=400
`);
    const notes = sceneConflicts(scene).filter(d => d.code === 'backward-side');
    expect(notes.map(d => d.ids)).toEqual([['e']]);
    expect(notes[0].message).toMatch(/against direction=right/);
  });

  it('prices a backward side above one across the flow', () => {
    // The target's left is boxed in; entering from the top beats entering from the right.
    const box = (id: string, x: number, y: number, w = 100, h = 40) => ({
      id,
      x,
      y,
      w,
      h,
      shape: 'box' as const,
    });
    const { routes } = RouteLab.compute(
      {
        nodes: [box('a', 0, 0), box('b', 300, 120), box('wall', 270, 60, 20, 160)],
        groups: [],
        edges: [{ id: 'e', from: 'a', to: 'b', cfg: { flow: 'right' } }],
      },
      {},
    );
    expect(routes[0].toSide).toBe('top');
  });
});
