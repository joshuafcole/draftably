/**
 * Where a drawing's text cannot be read: a connection label on another label, a shape, a group's
 * title or a line, and a shape title too long for its shape. Compare counts these for each
 * candidate and marks them on its card, so this has to stay cheap and read only the drawn scene.
 */
import { resolveAppearance, type ResolvedAppearance } from './appearance';
import { measureText, type TypeProfile } from './fonts';
import { covers, segments, segmentInside, shrink } from './geometry';
import { isCell, styleOf } from './graph';
import {
  diamondMeasure,
  edgeLabelLines,
  edgeLabelType,
  groupTitleLines,
  nodeLabel,
  titleArea,
} from './labels';
import type { DrawnRoute } from './routes';
import type { StaticScene } from './static-scene';
import type { Diagram, DiagramGroup, Rect } from './types';

/** Connection labels as boxes. Labels are centred on their spot. */
export const labelBoxes = (routes: readonly DrawnRoute[]) =>
  routes.flatMap(route =>
    route.label
      ? [
          {
            route,
            box: {
              x: route.label.x - route.label.w / 2,
              y: route.label.y - route.label.h / 2,
              w: route.label.w,
              h: route.label.h,
            },
          },
        ]
      : [],
  );

/** How tall a line of `type` inks: its glyphs' height, within the line's leading. */
const glyphHeight = (type: TypeProfile) => Math.min(type.lineHeight, Math.ceil(type.size * 1.2));

/** One box per line of text centred on `x`, the first line's middle at `y`. */
const lineBoxes = (lines: string[], x: number, y: number, type: TypeProfile): Rect[] =>
  lines.map((line, i) => {
    const w = measureText(line, type),
      h = glyphHeight(type);
    return { x: x - w / 2, y: y + i * type.lineHeight - h / 2, w, h };
  });

/**
 * The line boxes of a connection label's text, as the canvas sets it: each line centred on the
 * label's spot, in the annotation type (a step larger for a sequence message). The label's
 * padding is not in them.
 */
export function labelTextBoxes(
  doc: Diagram,
  route: DrawnRoute,
  text: string,
  look: ResolvedAppearance,
): Rect[] {
  const l = route.label;
  if (!l || !text) return [];
  const message = doc.layout.edges[route.id]?.row !== undefined,
    type = edgeLabelType(look, message),
    lines = edgeLabelLines(text, look, message);
  return lineBoxes(lines, l.x, l.y - ((lines.length - 1) * type.lineHeight) / 2, type);
}

/** The line boxes of a shape's title, where the canvas sets it. */
export function titleLineBoxes(
  doc: Diagram,
  id: string,
  title: string,
  r: Rect,
  look: ResolvedAppearance,
): Rect[] {
  if (!title) return [];
  const l = nodeLabel(doc, id, title, r);
  // Detail lines (after the title's first `\n`) are set a step smaller (`look.detail`).
  return l.lines.map((line, i) => {
    const type = line.detail ? look.detail : look.title,
      w = measureText(line.text, type),
      h = glyphHeight(type);
    return { x: r.x + l.x - w / 2, y: r.y + l.y + l.offsets[i] - h / 2, w, h };
  });
}

/** A group's title: its icon and text, as the canvas draws them. */
export function groupTitleInk(g: DiagramGroup, r: Rect, look: ResolvedAppearance): Rect {
  const lines = groupTitleLines(g.title, r.w, look, g.titleLines),
    mid = r.y + look.groupHeader / 2 - 7,
    half = look.groupTitle.size / 2 + 1;
  return {
    x: r.x + 12,
    y: mid - half,
    w: 21 + Math.max(...lines.map(l => measureText(l, look.groupTitle))),
    h: 2 * half + (lines.length - 1) * look.groupTitle.lineHeight,
  };
}

/** Whether a shape's title is taller than the room its shape has, as `leafSize` reports it. */
function titleFits(scene: StaticScene, id: string, title: string, r: Rect) {
  const { doc } = scene,
    label = nodeLabel(doc, id, title, r);
  if (label.mode !== 'center') return true;
  const look = resolveAppearance(doc.appearance),
    { shape, icon } = styleOf(doc, id);
  if (shape === 'diamond') return !!diamondMeasure(title, Math.min(r.w, r.h), look);
  // A cell's title takes its whole box; its padding is small and part of the design.
  const inset = !!icon && ['box', 'pill'].includes(shape),
    room = isCell(doc, id) ? r.h : titleArea(shape, r.w, r.h, look, inset).maxHeight;
  return label.height <= room + 0.5;
}

export interface LabelHit {
  /** What cannot be read, and where to mark it. */
  box: Rect;
  note: string;
}

export function labelHits(scene: StaticScene): LabelHit[] {
  const { doc, vg, rects, routes } = scene,
    look = resolveAppearance(doc.appearance),
    labels = labelBoxes(routes),
    hits: LabelHit[] = [],
    text = (id: string) => vg.edges.find(e => e.id === id)?.label ?? '';
  const framed = vg.groups.flatMap(g => {
    const r = rects.get(g.id);
    return r && !g.frame ? [{ g, r }] : [];
  });
  const boxes = [
    ...vg.nodes.map(n => ({ title: n.title, r: rects.get(n.id)! })),
    ...framed
      .filter(({ g }) => doc.collapsed.includes(g.id))
      .map(f => ({ ...f, title: f.g.title })),
  ];
  for (const n of vg.nodes) {
    const r = rects.get(n.id)!;
    if (!titleFits(scene, n.id, n.title, r))
      hits.push({ box: r, note: `"${n.title}" does not fit in its shape.` });
  }
  for (const [i, l] of labels.entries()) {
    const name = `The label "${text(l.route.id)}"`,
      seen = (note: string) => hits.push({ box: l.box, note }),
      body = shrink(l.box, 1),
      [start, end] = [l.route.points[0], l.route.points[l.route.points.length - 1]],
      same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
    for (const m of labels.slice(i + 1))
      if (covers(l.box, m.box)) seen(`${name} covers the label "${text(m.route.id)}".`);
    for (const { title, r } of boxes)
      if (covers(l.box, shrink(r, 1))) seen(`${name} covers "${title}".`);
    for (const { g, r } of framed)
      if (!doc.collapsed.includes(g.id) && covers(l.box, groupTitleInk(g, r, look)))
        seen(`${name} covers the title of "${g.title}".`);
    for (const route of routes) {
      // Lines that fan out of or into one port share a trunk with this label's own line.
      if (route === l.route) continue;
      if (same(route.points[0], start) || same(route.points[route.points.length - 1], end))
        continue;
      if (segments(route.points).some(s => segmentInside(s, body) > 1))
        seen(`${name} sits on another line.`);
    }
  }
  return hits;
}
