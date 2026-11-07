/**
 * The frame round a diagram: the heading above the drawing and the key under it. `inspect --svg`,
 * the editor's exports and the viewer canvas all place them from here, so what the viewer shows is
 * what an export draws.
 */
import type { Heading, LegendEntry, ResolvedAppearance } from './appearance';
import { headingSize, subtitleMeasure } from './heading';
import { footnoteSize, type Footnote } from './footnote';
import { legendSize } from './legend';
import type { PlacedNote } from './note';
import { rectUnion } from './geometry';
import type { Rect } from './types';
import type { StatusCount } from './status';

/** Space between the frame's edge and the drawing; the heading and the key align to it. */
export const FRAME_PAD = 40;
/** Narrowest frame a `diagram width=` line or a drag can set. */
export const MIN_FRAME_WIDTH = 160;

/** Space between the heading and the first frame note, and between notes. */
const NOTE_GAP = 8;

/**
 * Lay out the frame round `area`, the drawing with `FRAME_PAD` already round it. The heading sits
 * above the area and the key at its bottom, both left-aligned with the drawing; footnotes sit
 * between the drawing and the key, wrapped to the frame. Frame notes stack
 * under the heading, and the area grows to hold anchored notes (`placeNotes`). The frame is at
 * least as wide as the heading, the notes, the key and the heading's `width`; extra width goes to
 * the right.
 */
export function diagramFrame(
  look: ResolvedAppearance,
  heading: Heading | undefined,
  legend: LegendEntry[],
  statuses: StatusCount[],
  drawing: Rect,
  notes: readonly PlacedNote[] = [],
  footnotes: readonly Footnote[] = [],
) {
  const anchored = notes.filter(n => !n.inFrame && !n.hidden).map(n => n.rect),
    area = anchored.length ? rectUnion([drawing, rectUnion(anchored, FRAME_PAD)]) : drawing,
    inFrame = notes.filter(n => n.inFrame && !n.hidden),
    // The subtitle wraps to the drawing, or to the frame a `width=` sets.
    wrap = subtitleMeasure(look, (heading?.width ?? area.w) - FRAME_PAD * 2),
    lines = headingSize(look, heading, wrap),
    block = inFrame.reduce((h, n) => h + n.rect.h + NOTE_GAP, lines.h ? 0 : -NOTE_GAP),
    head = inFrame.length
      ? { w: Math.max(lines.w, ...inFrame.map(n => n.rect.w)), h: (lines.h || 20) + block }
      : lines,
    // The key flows left to right and wraps to the frame the drawing and heading set.
    inner = Math.max(area.w, head.w + FRAME_PAD * 2, heading?.width ?? 0) - FRAME_PAD * 2,
    key = legendSize(look, legend, statuses, inner),
    foot = footnoteSize(look, footnotes, inner),
    // With no key under them, footnotes need the frame's bottom margin themselves.
    footH = foot.h && !key.h ? foot.h + FRAME_PAD / 2 : foot.h,
    natural = Math.max(area.w, head.w + FRAME_PAD * 2, key.w + FRAME_PAD * 2),
    y = area.y - head.h,
    left = area.x + FRAME_PAD;
  // Frame notes start under the title and subtitle, which take the heading's height less its gap.
  let top = y + 28 + (lines.h ? lines.h - 20 + NOTE_GAP : 0);
  const placed = notes.map(n => {
    if (!n.inFrame || n.hidden) return n;
    const rect = { ...n.rect, x: left, y: top };
    top += n.rect.h + NOTE_GAP;
    return { ...n, rect };
  });
  return {
    x: area.x,
    y,
    w: Math.max(natural, heading?.width ?? 0),
    h: area.h + head.h + footH + key.h,
    /** Width without the heading's `width`, which a drag never narrows past. */
    natural,
    head,
    key,
    heading: { x: left, y: y + 28, wrap },
    legend: { x: left, y: area.y + area.h - 12 + foot.h },
    /** The footnote block's top-left corner and layout. */
    foot: { ...foot, x: left, y: area.y + area.h - 12 },
    /** Every note, placed, in file order; a `hidden` one takes no room. */
    notes: placed,
  };
}

export type DiagramFrame = ReturnType<typeof diagramFrame>;
