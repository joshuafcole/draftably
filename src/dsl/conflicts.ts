/**
 * Geometry conflicts in a drawn diagram, as `check` warnings: a line through a box or a group
 * title, boxes on top of each other, a label on a box or another label, and a box outside its
 * group's frame. Layout and routing avoid all of these on their own, so each one usually comes
 * from a refinement; the warning names that line and a fix. The rules follow the diagram-quality
 * audit (`scripts/diagram-audit.mjs`), measured on the drawing itself.
 *
 * `hintMoves` compares the drawing with the same file compiled without refinements, so `check
 * --hints` can say how far each refinement moved its target.
 */
import { placeNotes } from '../model/note';
import { covers, segments, segmentInside, shrink } from '../model/geometry';
import { groupHeaderFor } from '../model/labels';
import { groupTitleInk, labelBoxes } from '../model/label-hits';
import { computeRoutes, type DrawnRoute } from '../model/routes';
import type { Diagram, Point, Rect } from '../model/types';
import { compile, type Diagnostic, type Scene } from './compile';
import { flowSideNotes } from './flow-sides';
import { projectScene, visibleRects } from './project';
import type { Hint } from './syntax';

/** Room a fix leaves between the moved box and what it cleared. */
const CLEAR = 16;

type Move = { dx: number; dy: number };
/** The smallest move of `box` that clears `other` by `CLEAR`. */
function clearOf(box: Rect, other: Rect): Move {
  const options: Move[] = [
    { dx: other.x + other.w + CLEAR - box.x, dy: 0 },
    { dx: other.x - CLEAR - box.x - box.w, dy: 0 },
    { dx: 0, dy: other.y + other.h + CLEAR - box.y },
    { dx: 0, dy: other.y - CLEAR - box.y - box.h },
  ];
  return options.sort((p, q) => Math.abs(p.dx + p.dy) - Math.abs(q.dx + q.dy))[0];
}

/** The smallest move that brings `box` inside `frame`'s content area. */
function into(box: Rect, frame: Rect, header: number): Move {
  const pad = 8,
    shift = (lo: number, size: number, from: number, to: number) =>
      lo < from ? from - lo : lo + size > to ? Math.max(from - lo, to - lo - size) : 0;
  return {
    dx: shift(box.x, box.w, frame.x + pad, frame.x + frame.w - pad),
    dy: shift(box.y, box.h, frame.y + header, frame.y + frame.h - pad),
  };
}

const describeMove = ({ dx, dy }: Move) =>
  [
    dx ? `${Math.abs(Math.round(dx))}px ${dx > 0 ? 'right' : 'left'}` : '',
    dy ? `${Math.abs(Math.round(dy))}px ${dy > 0 ? 'down' : 'up'}` : '',
  ]
    .filter(Boolean)
    .join(' and ');

/** Ids a refinement places or sizes. */
export const hintTargets = (h: Hint): string[] => ('ids' in h ? h.ids : [h.id]);

/** Refinements that place or size one object. */
const PLACING = new Set(['pin', 'near', 'nudge', 'stay', 'size', 'align']);

/**
 * The refinement most likely to have caused a conflict among `ids`, in the order given, and how
 * to fix it: remove it, or move its target by `move`. A pin gets the new coordinates.
 */
export function blame(scene: Scene, ids: string[], move?: (id: string) => Move | undefined) {
  for (const id of ids) {
    const h = scene.model.hints.find(h => PLACING.has(h.type) && hintTargets(h).includes(id));
    if (!h) continue;
    const m = move?.(id),
      fix =
        m && (m.dx || m.dy)
          ? h.type === 'pin'
            ? `, or change it to x=${Math.round(h.x + m.dx)} y=${Math.round(h.y + m.dy)}`
            : `, or move ${id} ${describeMove(m)}`
          : '';
    return { line: h.line, text: ` Remove the ${h.type} on line ${h.line}${fix}.` };
  }
  return { text: ' The layout could not avoid it; move or resize a neighbour.' };
}

/**
 * Warnings for conflicts in a drawing. `doc` is the projected scene, `rects` its visible
 * rectangles and `routes` its drawn routes with label boxes.
 */
export function findConflicts(
  scene: Scene,
  doc: Diagram,
  rects: Map<string, Rect>,
  routes: DrawnRoute[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const parent = new Map(
    [...doc.graph.nodes, ...doc.graph.groups].map(o => [o.id, o.parentId ?? 'root']),
  );
  const groups = new Set(doc.graph.groups.map(g => g.id));
  const ancestors = (id: string) => {
    const list: string[] = [];
    for (let p = parent.get(id); p && p !== 'root'; p = parent.get(p)) list.push(p);
    return list;
  };
  const related = (a: string, b: string) => ancestors(a).includes(b) || ancestors(b).includes(a);
  // A soft or frameless group draws a tint (or nothing) that lines cross freely; `compile`
  // reports a tint over other objects as `soft-overlap`. Only boxes are checked here.
  const tinted = new Set(doc.graph.groups.filter(g => scene.byId.get(g.id)?.frame).map(g => g.id));
  const boxes = [...rects].filter(([id]) => !tinted.has(id)).map(([id, r]) => ({ id, r }));
  const leaves = boxes.filter(b => !groups.has(b.id));
  // A marker takes no room: its bar sits on a seam and runs past the cells on purpose.
  const solid = boxes.filter(b => scene.byId.get(b.id)?.shape !== 'marker');
  const edges = new Map(doc.graph.edges.map(e => [e.id, e]));
  const look = scene.look;
  const warn = (code: string, ids: string[], message: string, cause: ReturnType<typeof blame>) =>
    out.push({
      level: 'warning',
      code,
      message: message + cause.text,
      ...(cause.line ? { line: cause.line } : {}),
      ids,
    });
  const name = (r: DrawnRoute) => {
    const e = edges.get(r.id);
    return e ? `${r.id} (${e.from} -> ${e.to})` : r.id;
  };

  // Boxes on top of each other. `refine` already reports siblings it could not separate.
  const reported = new Set(
    scene.diagnostics.filter(d => d.code === 'overlap').map(d => [...d.ids].sort().join(' ')),
  );
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i],
        b = solid[j];
      if (related(a.id, b.id) || !covers(a.r, b.r)) continue;
      if (reported.has([a.id, b.id].sort().join(' '))) continue;
      warn(
        'node-overlap',
        [a.id, b.id],
        `${a.id} overlaps ${b.id}.`,
        blame(scene, [a.id, b.id], id => (id === a.id ? clearOf(a.r, b.r) : clearOf(b.r, a.r))),
      );
    }

  // A box outside its group's frame.
  for (const { id, r } of solid) {
    const p = parent.get(id),
      frame = p && !tinted.has(p) && rects.get(p);
    if (!frame) continue;
    const out = Math.max(
      frame.x - r.x,
      r.x + r.w - frame.x - frame.w,
      frame.y - r.y,
      r.y + r.h - frame.y - frame.h,
    );
    if (out <= 0.5) continue;
    warn(
      'outside-group',
      [id, p!],
      `${id} sits ${Math.round(out)}px outside its group ${p}.`,
      blame(scene, [id, p!], k =>
        k === id ? into(r, frame, groupHeaderFor(look, scene.byId.get(p!)?.titleLines)) : undefined,
      ),
    );
  }

  for (const route of routes) {
    const segs = segments(route.points);
    const ends = [route.from, route.to];
    // A line through a box that is not one of its ends, or a group inside one of them.
    for (const { id, r } of leaves) {
      if (ends.includes(id)) continue;
      const body = shrink(r, 2),
        hit = segs.find(s => segmentInside(s, body) > 1);
      if (!hit) continue;
      const upright = Math.abs(hit[0].x - hit[1].x) < 0.5;
      const clear = (): Move => {
        if (upright) {
          const right = hit[0].x + CLEAR - r.x,
            left = hit[0].x - CLEAR - r.x - r.w;
          return { dx: Math.abs(right) < Math.abs(left) ? right : left, dy: 0 };
        }
        const down = hit[0].y + CLEAR - r.y,
          up = hit[0].y - CLEAR - r.y - r.h;
        return { dx: 0, dy: Math.abs(down) < Math.abs(up) ? down : up };
      };
      warn(
        'edge-through-node',
        [route.id, id],
        `Edge ${name(route)} runs through ${id}.`,
        blame(scene, [id, ...ends], k => (k === id ? clear() : undefined)),
      );
    }
    // A line through a group's title: its icon and text, as the canvas draws them.
    for (const g of doc.graph.groups) {
      const r = rects.get(g.id);
      if (!r || tinted.has(g.id)) continue;
      const ink = groupTitleInk(g, r, look);
      if (!segs.some(s => segmentInside(s, ink) > 1)) continue;
      warn(
        'edge-through-title',
        [route.id, g.id],
        `Edge ${name(route)} crosses the title of ${g.id}.`,
        blame(scene, [g.id, ...ends]),
      );
    }
  }

  // Labels on a box or on each other. Labels are centred on their spot.
  const labels = labelBoxes(routes);
  for (const [i, l] of labels.entries()) {
    const text = edges.get(l.route.id)?.label ?? '';
    for (const { id, r } of leaves) {
      if (!covers(l.box, shrink(r, 1))) continue;
      warn(
        'label-collision',
        [l.route.id, id],
        `The label "${text}" on ${name(l.route)} covers ${id}.`,
        blame(scene, [id, l.route.from, l.route.to], k =>
          k === id ? clearOf(r, l.box) : undefined,
        ),
      );
    }
    for (const m of labels.slice(i + 1)) {
      if (!covers(l.box, m.box)) continue;
      warn(
        'label-collision',
        [l.route.id, m.route.id],
        `The labels on ${l.route.id} and ${m.route.id} overlap.`,
        blame(scene, [l.route.from, l.route.to, m.route.from, m.route.to]),
      );
    }
  }
  return out;
}

/** Project a compiled scene, route it as the CLI draws it, and report its conflicts. */
export function sceneConflicts(scene: Scene): Diagnostic[] {
  const doc = projectScene(scene);
  const { vg, rects } = visibleRects(doc);
  const { routes } = computeRoutes(doc, vg, rects, { previous: [] });
  return [
    ...findConflicts(scene, doc, rects, routes),
    ...noteConflicts(scene, doc, rects, routes),
    ...flowSideNotes(scene, doc, rects, routes),
  ];
}

/** An anchored note with no clear spot beside its object, so it covers part of the drawing. */
function noteConflicts(
  scene: Scene,
  doc: Diagram,
  rects: Map<string, Rect>,
  routes: DrawnRoute[],
): Diagnostic[] {
  return placeNotes(doc, scene.look, rects, routes).flatMap((n, i) =>
    n.overlaps
      ? [
          {
            level: 'warning' as const,
            code: 'note-overlap',
            message: `The note beside ${n.note.near} covers part of the drawing. Try another side=, a smaller width=, or a note without near= in the frame.`,
            line: scene.model.noteLines[i],
            ids: [n.note.near!],
          },
        ]
      : [],
  );
}

export interface HintMove {
  id: string;
  hint: Hint['type'];
  line: number;
  raw: Point;
  final: Point;
  delta: number;
}

/**
 * How far each refinement moved its targets from where layout alone put them: the file compiled
 * again without its refinement lines. Also lists objects no refinement names that moved anyway.
 */
export async function hintMoves(source: string, scene: Scene) {
  const hints = scene.model.hints;
  const drop = new Set(hints.map(h => h.line));
  const raw = await compile(
    source
      .split(/\r?\n/)
      .map((text, i) => (drop.has(i + 1) ? '' : text))
      .join('\n'),
  );
  const move = (id: string) => {
    const a = raw.byId.get(id),
      b = scene.byId.get(id);
    if (!a || !b) return undefined;
    return {
      raw: { x: a.x, y: a.y },
      final: { x: b.x, y: b.y },
      delta: Math.round(Math.hypot(b.x - a.x, b.y - a.y)),
    };
  };
  const rows: HintMove[] = hints.flatMap(h =>
    hintTargets(h).flatMap(id => {
      const m = move(id);
      return m ? [{ id, hint: h.type, line: h.line, ...m }] : [];
    }),
  );
  const named = new Set(rows.map(r => r.id));
  const pushed = scene.objects
    .filter(o => !named.has(o.id))
    .flatMap(o => {
      const m = move(o.id);
      return m && m.delta > 0 ? [{ id: o.id, ...m }] : [];
    });
  return { rows, pushed };
}
