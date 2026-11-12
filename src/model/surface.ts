import { bandSwatch, panelSwatch, type ResolvedAppearance } from './appearance';
import { drawnSwatch } from './colors';
import { visibleRects } from '../dsl/project';
import type { Diagram, Point, Rect } from './types';

/** What is drawn at a point: an opaque fill, and a phase band's tint over it. */
export interface Surface {
  fill: string;
  tint?: { fill: string; opacity: number };
}

const within = (p: Point, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** The tint of each sequence phase band: alternate bands are stronger, so neighbours read apart. */
export const phaseOpacity = (i: number) => (i % 2 ? 0.03 : 0.12);

/**
 * A sequence's panel border only when its lanes leave a participant outside them. Lanes that
 * hold every participant already bound the exchange, and a second frame around them is cruft.
 */
export function panelDrawn(doc: Diagram) {
  if (!doc.layout.sequence) return false;
  const framed = new Set(doc.graph.groups.filter(g => g.frame !== 'none').map(g => g.id));
  return doc.graph.nodes.some(n => n.lifeline && !(n.parentId && framed.has(n.parentId)));
}

/**
 * The surface under a point, as the scene paints it: the canvas, the sequence panel, the
 * innermost group fill, then a phase band's tint. Halos and label cards take it, so a break in a
 * line reads as the lane it sits on, not a patch of canvas. A label card is one piece with the
 * surface under its center, so a label over a group's edge never reads as a half-tinted box. The
 * group rects are read once here and
 * not cached on `doc`: the editor's store keeps one `doc` object and updates it in place.
 */
export function surfaces(doc: Diagram, look: ResolvedAppearance) {
  const { vg, rects } = visibleRects(doc),
    seq = doc.layout.sequence,
    panel = !!seq && panelDrawn(doc);
  return (p: Point): Surface => {
    let fill = look.canvas;
    if (seq && panel && within(p, seq.panel)) fill = panelSwatch(look).fill;
    for (const g of vg.groups) {
      const r = rects.get(g.id);
      if (!r || g.frame === 'none') continue;
      const hull = g.frame === 'soft' && g.hull?.length ? g.hull : [{ x: 0, y: 0, w: r.w, h: r.h }];
      if (hull.some(h => within(p, { x: r.x + h.x, y: r.y + h.y, w: h.w, h: h.h })))
        fill = drawnSwatch(doc, look, g.id, 'group').fill;
    }
    const i = seq ? seq.phases.findIndex(ph => p.y >= ph.y && p.y <= ph.y + ph.h) : -1;
    return i < 0 || !within(p, seq!.panel)
      ? { fill }
      : {
          fill,
          tint: { fill: bandSwatch(look).stroke, opacity: phaseOpacity(i) },
        };
  };
}

/** A halo path's pieces, grouped by the surface under each piece's middle. */
export function haloPieces(under: (p: Point) => Surface, halo: string) {
  const out = new Map<string, { surface: Surface; d: string }>();
  for (const m of halo.matchAll(/M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)/g)) {
    const [x1, y1, x2, y2] = m.slice(1).map(Number),
      surface = under({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 }),
      key = JSON.stringify(surface),
      piece = out.get(key);
    if (piece) piece.d += m[0];
    else out.set(key, { surface, d: m[0] });
  }
  return [...out.values()];
}
