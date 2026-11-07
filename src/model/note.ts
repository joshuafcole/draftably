/**
 * Notes: sentences on a diagram that never move its layout, from `note` statements. An anchored
 * note (`near=`) is placed after layout in free space beside its object or sequence message; a
 * note without one sits in the frame under the subtitle. The viewer, `inspect --svg` and the
 * editor's exports all place and draw them from here.
 */
import { swatchFor, type ResolvedAppearance } from './appearance';
import type { BoundedRoute } from './bounds';
import { richLines, runsMarkup, type Run } from './rich-text';
import { contains, overlaps, rectUnion } from './geometry';
import type { Diagram, Point, Rect } from './types';

export const NOTE_SIDES = ['below', 'above', 'left', 'right'] as const;
export type NoteSide = (typeof NOTE_SIDES)[number];

export interface Note {
  /** What a host or tool calls the note, from `note id "text"`; notes without one have none. */
  id?: string;
  text: string;
  /** The node, group or sequence message the note sits beside; the frame when unset. */
  near?: string;
  /** Which side of `near`; `below` when unset, or `right` for a message. */
  side?: NoteSide;
  /** Wrap width; `NOTE_WIDTH` when unset. */
  width?: number;
  /** The emphasis states the note shows in, from `states=`; every drawing when unset. */
  states?: string[];
}

/**
 * A note with its box and wrapped lines. `inFrame` notes sit under the subtitle; `overlaps` is set
 * on an anchored note when no clear spot was found. A `hidden` note is not in the drawn state: it
 * keeps its place in the list, so a note's index still names it, but takes no room and draws
 * nothing.
 */
export interface PlacedNote {
  note: Note;
  rect: Rect;
  /** Wrapped lines, each as runs of plain text and links. */
  lines: Run[][];
  inFrame?: boolean;
  overlaps?: boolean;
  hidden?: boolean;
}

/**
 * Whether `note` shows in `doc` as drawn: always without `states=`, otherwise only while one of
 * the states it lists is drawn (`withState`).
 */
export const noteShown = (doc: Pick<Diagram, 'drawnState'>, note: Note) =>
  !note.states || (doc.drawnState !== undefined && note.states.includes(doc.drawnState));

/** The side a note sits on: its `side`, or by default right of a message and below anything else. */
export const noteSide = (doc: Diagram, note: Note): NoteSide =>
  note.side ?? (doc.graph.edges.some(e => e.id === note.near) ? 'right' : 'below');

/** Default wrap width, and the room between a note and its object. */
export const NOTE_WIDTH = 280;
/** Room between a note's panel and its text. */
export const NOTE_PAD = { x: 12, y: 8 };
const GAP = 16,
  PAD_X = NOTE_PAD.x,
  PAD_Y = NOTE_PAD.y,
  /** Room between a note and a message's row, and between notes stacked in a margin. */
  ROW_GAP = 8,
  /** How far each try moves a note along its row, away from the message. */
  ROW_STEP = 24;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The note's wrapped lines and box size, at 0,0. */
export function noteBox(look: ResolvedAppearance, note: Note): PlacedNote {
  const type = look.annotation,
    lines = richLines(note.text, (note.width ?? NOTE_WIDTH) - PAD_X * 2, type),
    w = Math.ceil(Math.max(...lines.map(l => l.reduce((x, r) => x + r.w, 0)))) + PAD_X * 2;
  return { note, lines, rect: { x: 0, y: 0, w, h: lines.length * type.lineHeight + PAD_Y * 2 } };
}

/**
 * Spots in a sequence's side margins, by index in `notes`, for notes on the messages in `rows`.
 * `left` and `right` are the margins' inner edges and `top` the highest a note goes. A note is
 * level with its row, or pushed down clear of the note above it. The panel grows round these, so
 * no note here can cover the drawing.
 */
export function marginNotes(
  look: ResolvedAppearance,
  notes: readonly Note[],
  rows: ReadonlyMap<string, number>,
  { left, right, top }: { left: number; right: number; top: number },
) {
  const spots: Array<Rect | null> = notes.map(() => null);
  for (const side of ['left', 'right'] as const) {
    let free = top;
    notes
      .map((note, i) => ({ note, i, row: rows.get(note.near ?? '') }))
      .filter(n => n.row !== undefined && (n.note.side ?? 'right') === side)
      .sort((a, b) => a.row! - b.row!)
      .forEach(({ note, i, row }) => {
        const { w, h } = noteBox(look, note).rect,
          y = Math.max(free, Math.round(row! - h / 2));
        spots[i] = { x: side === 'right' ? right : left - w, y, w, h };
        free = y + h + ROW_GAP;
      });
  }
  return spots;
}

/** A route label's box; a label's `x` and `y` are its center. */
const labelBox = (l: NonNullable<BoundedRoute['label']>) => ({
  ...l,
  x: l.x - l.w / 2,
  y: l.y - l.h / 2,
});

/**
 * Tries above or below a message's row, level with the row so the note still reads as its own:
 * over the message, then at each of its ends, then further along the row to either side.
 */
function rowSpots(row: Rect, lanes: Rect, side: NoteSide, w: number, h: number): Rect[] {
  const x = (at: number) => Math.round(Math.max(lanes.x, Math.min(at, lanes.x + lanes.w - w))),
    mid = x(row.x + (row.w - w) / 2),
    xs = [mid, x(row.x), x(row.x + row.w - w)];
  for (let d = ROW_STEP; d < lanes.w; d += ROW_STEP) xs.push(x(mid - d), x(mid + d));
  const y = side === 'below' ? row.y + row.h + ROW_GAP : row.y - ROW_GAP - h;
  return [...new Set(xs)].map(at => ({ x: at, y: Math.round(y), w, h }));
}

/**
 * Place every anchored note beside its object or message, clear of shapes, group borders, lines
 * and earlier notes when a nearby spot allows it. Frame notes, and notes whose object is not drawn,
 * come back `inFrame` at 0,0 for `diagramFrame` to place. Notes the drawn state leaves out come
 * back `hidden`. Notes shown in every drawing are placed first, so a state's own notes never push
 * one of them to another spot. The result is in file order.
 */
export function placeNotes(
  doc: Diagram,
  look: ResolvedAppearance,
  rects: ReadonlyMap<string, Rect>,
  routes: readonly BoundedRoute[],
): PlacedNote[] {
  const groups = new Set(doc.graph.groups.map(g => g.id)),
    shapes = [...rects].filter(([id]) => !groups.has(id)).map(([, r]) => r),
    frames = [...rects].filter(([id]) => groups.has(id)).map(([, r]) => r),
    lines = routes.flatMap(r =>
      r.points.slice(1).map((p, i) => {
        const a = r.points[i];
        return {
          x: Math.min(a.x, p.x) - 2,
          y: Math.min(a.y, p.y) - 2,
          w: Math.abs(p.x - a.x) + 4,
          h: Math.abs(p.y - a.y) + 4,
        };
      }),
    ),
    seq = doc.layout.sequence,
    // A sequence's labels sit on their rows, in the way of a note; elsewhere nothing changes.
    labels = routes.flatMap(r => (seq && r.label ? [labelBox(r.label)] : [])),
    // A sequence keeps a margin spot for every note, shown or not, so no state moves a lane.
    margins =
      doc.appearance.notes?.flatMap((n, i) => (noteShown(doc, n) ? (seq?.notes?.[i] ?? []) : [])) ??
      [],
    placed: Rect[] = [...margins];
  const clear = (r: Rect) =>
    !shapes.some(s => overlaps(s, r, 4)) &&
    !lines.some(s => overlaps(s, r)) &&
    !labels.some(s => overlaps(s, r)) &&
    !placed.some(s => overlaps(s, r, 8)) &&
    // A note may sit inside a group, but not across its border.
    frames.every(g => !overlaps(g, r) || contains(g, r));
  const place = (note: Note, i: number): PlacedNote => {
    const box = noteBox(look, note),
      at = note.near ? rects.get(note.near) : undefined,
      message = at ? undefined : routes.find(r => r.id === note.near);
    if (message) {
      const margin = seq?.notes?.[i];
      if (margin) return { ...box, rect: margin };
      const row = rectUnion([
          ...message.points.map(p => ({ ...p, w: 0, h: 0 })),
          ...(message.label ? [labelBox(message.label)] : []),
        ]),
        spots = rowSpots(row, rectUnion(shapes), note.side ?? 'below', box.rect.w, box.rect.h),
        spot = spots.find(r => clear(r) && contains(seq!.panel, r));
      placed.push(spot ?? spots[0]);
      return { ...box, rect: spot ?? spots[0], ...(spot ? {} : { overlaps: true }) };
    }
    if (!at) return { ...box, inFrame: true };
    const { w, h } = box.rect,
      side = note.side ?? 'below',
      across = side === 'below' || side === 'above';
    // Along the side: start-aligned, centered, end-aligned; then the same a little further out.
    const spots = [GAP, GAP + 24, GAP + 56].flatMap(d =>
      [0, 0.5, 1].map(t => {
        const x = across
            ? at.x + (at.w - w) * t
            : side === 'right'
              ? at.x + at.w + d
              : at.x - d - w,
          y = across ? (side === 'below' ? at.y + at.h + d : at.y - d - h) : at.y + (at.h - h) * t;
        return { x: Math.round(x), y: Math.round(y), w, h };
      }),
    );
    const spot = spots.find(clear);
    placed.push(spot ?? spots[0]);
    return { ...box, rect: spot ?? spots[0], ...(spot ? {} : { overlaps: true }) };
  };
  const notes = doc.appearance.notes ?? [],
    out: PlacedNote[] = notes.map(note => ({
      note,
      rect: { x: 0, y: 0, w: 0, h: 0 },
      lines: [],
      hidden: true,
    }));
  for (const always of [true, false])
    notes.forEach((note, i) => {
      if (!note.states === always && noteShown(doc, note)) out[i] = place(note, i);
    });
  return out;
}

/**
 * SVG markup for placed notes: a quiet panel with a bar on its left edge, then the text. Links
 * are `<a>` elements with `href` as `write` gives it. A note with an ID carries it as `data-note`.
 */
export function noteMarkup(
  look: ResolvedAppearance,
  notes: readonly PlacedNote[],
  write: (href: string) => string | null = h => h,
): string {
  const { family, size, weight, lineHeight } = look.annotation,
    panel = swatchFor(look, 'slate', 50, 'group'),
    link = swatchFor(look, 'primary', 700).fill;
  return notes
    .filter(n => !n.hidden)
    .map(({ note, rect: r, lines }) => {
      const text = lines
        .map(
          (line, i) =>
            `<text x="${r.x + PAD_X}" y="${r.y + PAD_Y + (i + 0.5) * lineHeight}" dominant-baseline="central" font-family="${esc(family)}" font-size="${size}" font-weight="${weight}" fill="${look.text}">${runsMarkup(line, link, write)}</text>`,
        )
        .join('');
      return (
        `<g class="diagram-note"${note.id ? ` data-note="${esc(note.id)}"` : ''}>` +
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="4" fill="${panel.fill}"/>` +
        `<rect x="${r.x}" y="${r.y}" width="3" height="${r.h}" rx="1.5" fill="${look.muted}"/>` +
        text +
        '</g>'
      );
    })
    .join('');
}

/** How far from an object a dropped note still anchors to it. */
const ANCHOR_REACH = 160;

/**
 * Where a note dropped at `p` belongs: beside the closest object or (in a sequence) message, on
 * the side of it `p` is on. Inside several objects the smallest wins, so a note dropped on a
 * shape in a group goes to the shape. Undefined when nothing is within reach.
 */
export function noteAnchor(
  p: Point,
  rects: ReadonlyMap<string, Rect>,
  messages: readonly BoundedRoute[] = [],
): { near: string; side: NoteSide } | undefined {
  const boxes = [
    ...rects,
    ...messages.flatMap(m =>
      m.id ? [[m.id, rectUnion(m.points.map(q => ({ ...q, w: 0, h: 0 })))] as const] : [],
    ),
  ];
  let best: { id: string; r: Rect; d: number; area: number } | undefined;
  for (const [id, r] of boxes) {
    const d = Math.hypot(
        Math.max(r.x - p.x, 0, p.x - r.x - r.w),
        Math.max(r.y - p.y, 0, p.y - r.y - r.h),
      ),
      area = r.w * r.h;
    if (d > ANCHOR_REACH) continue;
    if (!best || d < best.d || (d === best.d && area < best.area)) best = { id, r, d, area };
  }
  if (!best) return;
  const { r } = best,
    // A message is a thin row, so its height counts as a short shape's.
    dx = (p.x - r.x - r.w / 2) / Math.max(r.w / 2, 20),
    dy = (p.y - r.y - r.h / 2) / Math.max(r.h / 2, 20);
  const side: NoteSide =
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'below' : 'above';
  return { near: best.id, side };
}
