/**
 * `check --metrics` finding `frame-sprawl`: the drawing covers many times the area of its boxes.
 *
 * The footprint F is the drawing's area (`drawingBounds`, without the frame's padding) over the
 * summed area of its boxes. Groups, gaps and long lines all add area; boxes are what a reader
 * came to read. Over the example, bench and quality-corpus files F has a median of 4.4 and a
 * 90th percentile of 7.4, close to the 5.8 and 8.4 Callsheet's maps measured when it set the
 * knee, so the knee carries over: at or under {@link FOOTPRINT_KNEE} costs nothing, and past it
 * the finding carries a cost of {@link FOOTPRINT_SLOPE} points per unit of F for `--score`.
 *
 * A sequence diagram is not measured: its area is its message rows.
 */
import { drawingBounds } from '../model/bounds';
import type { Diagnostic } from './compile';
import type { Drawing } from './metrics';

/** A footprint at or under this costs nothing. */
export const FOOTPRINT_KNEE = 8;
/** Score points per unit of footprint past the knee. */
export const FOOTPRINT_SLOPE = 2;

/** The drawing's area over its boxes' summed area; undefined with no boxes, or for a sequence. */
export function footprint(d: Drawing): number | undefined {
  if (d.doc.layout.sequence) return undefined;
  const boxes = d.vg.nodes.flatMap(n => {
    const r = d.rects.get(n.id);
    return r ? [r] : [];
  });
  const area = boxes.reduce((sum, r) => sum + r.w * r.h, 0);
  if (!area) return undefined;
  const b = drawingBounds(d.doc, d.vg, d.rects, d.routes);
  return (b.w * b.h) / area;
}

/** What a sprawling drawing adds to `--score`: 0 at or under the knee. */
export const sprawlCost = (f: number | undefined) =>
  f === undefined ? 0 : Math.max(0, f - FOOTPRINT_KNEE) * FOOTPRINT_SLOPE;

export function frameSprawlNotes(d: Drawing): Diagnostic[] {
  const f = footprint(d);
  if (f === undefined || f <= FOOTPRINT_KNEE) return [];
  return [
    {
      level: 'warning',
      code: 'frame-sprawl',
      message: `The drawing covers ${f.toFixed(1)} times the area of its boxes (over ${FOOTPRINT_KNEE}): groups, gaps and long lines take most of it. Try draftably vary --prefer compact.`,
      ids: [],
      box: drawingBounds(d.doc, d.vg, d.rects, d.routes),
    },
  ];
}
