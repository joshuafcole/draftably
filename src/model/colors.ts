/**
 * The colors an object is drawn in. A file names a family and maybe a shade; drawing adds one
 * rule on top, so nesting stays readable without the author doing shade arithmetic:
 *
 * - A container inside a container of the same family steps one shade toward emphasis per level
 *   (lighter frames underneath, smaller and stronger ones on top), instead of repeating the fill.
 * - A shape whose shade is within two steps of its container's, in the same family, moves three
 *   steps past the container, so a member never melts into its frame.
 *
 * The canvas, the CLI's SVG and exports all draw through `drawnSwatch`.
 */
import {
  groupShadeFor,
  NODE_SHADE,
  SHADES,
  shadesOf,
  swatchFor,
  type ResolvedAppearance,
  type Shade,
  type Swatch,
} from './appearance';
import { findGroup, findObject, isGroup, styleOf } from './graph';
import { isDiff, statusSwatch } from './status';
import type { Diagram } from './types';

/** Steps a nested container keeps from its parent, and a shape from its container. */
const GROUP_STEP = 1,
  NODE_STEP = 3;

/** The shade an object is drawn at, or undefined for the theme's neutral surface. */
export function drawnShade(doc: Diagram, look: ResolvedAppearance, id: string): Shade | undefined {
  const style = styleOf(doc, id),
    group = isGroup(doc, id),
    family = style.color;
  if (!family || family === 'auto') return style.shade;
  const own = style.shade ?? (group ? groupShadeFor(look.theme, look.dark) : NODE_SHADE);
  const parentId = findObject(doc, id)?.parentId,
    parent = parentId ? findGroup(doc, parentId) : undefined;
  if (!parent || styleOf(doc, parent.id).color !== family) return own;
  const outer = drawnShade(doc, look, parent.id);
  if (outer === undefined) return own;
  const need = group ? GROUP_STEP : NODE_STEP,
    toward = look.dark ? -1 : 1,
    at = SHADES.indexOf(own),
    from = SHADES.indexOf(outer);
  // Far enough from the frame already, on the emphasis side or well past it on the other.
  if ((at - from) * toward >= need || (from - at) * toward > 2) return own;
  return nearestShade(look, family, SHADES[clampIndex(from + need * toward)]);
}

/** The swatch an object is drawn with. */
export function drawnSwatch(
  doc: Diagram,
  look: ResolvedAppearance,
  id: string,
  kind: 'node' | 'group',
): Swatch {
  // In a diff, color means change: the status decides the swatch, not the author's family.
  if (isDiff(doc)) return statusSwatch(look, styleOf(doc, id).status, kind);
  // Dimmed by an emphasis state: the neutral surface, so only what is in focus keeps a hue.
  if (styleOf(doc, id).spot === 'dim') return statusSwatch(look, undefined, kind);
  const swatch = swatchFor(look, styleOf(doc, id).color, drawnShade(doc, look, id), kind);
  // A sequence participant is outlined rather than filled, so the row of headers stays quiet: in
  // its color, which reads as an accent (see `participantAccent`), or else the theme's outline.
  // Its fill is the lane under it, so the header is not a patch of canvas on the lane's tint.
  if (kind === 'node' && doc.layout.sequence) {
    const lane = findObject(doc, id)?.parentId,
      framed = lane && findGroup(doc, lane)?.frame !== 'none';
    return {
      fill: framed ? drawnSwatch(doc, look, lane!, 'group').fill : look.canvas,
      stroke: participantAccent(doc, look, id) ?? swatch.stroke,
      ink: look.text,
    };
  }
  return swatch;
}

/**
 * A sequence participant's accent: the fill its color would have, drawn as a thin stripe along
 * its top. Undefined for anything else, and for a participant with no color of its own.
 */
export function participantAccent(
  doc: Diagram,
  look: ResolvedAppearance,
  id: string,
): string | undefined {
  if (!doc.layout.sequence || !findObject(doc, id) || isGroup(doc, id)) return undefined;
  if (isDiff(doc) || styleOf(doc, id).spot === 'dim') return undefined;
  const shade = drawnShade(doc, look, id),
    family = styleOf(doc, id).color;
  if ((!family || family === 'auto') && shade === undefined) return undefined;
  return swatchFor(look, family, shade, 'node').fill;
}

const clampIndex = (i: number) => Math.max(0, Math.min(SHADES.length - 1, i));

/** A custom family may define only some shades; take the closest one it has. */
function nearestShade(look: ResolvedAppearance, family: string, shade: Shade): Shade {
  const have = shadesOf(look, family);
  if (!have.length || have.includes(shade)) return shade;
  return have.reduce((best, s) => (Math.abs(s - shade) < Math.abs(best - shade) ? s : best));
}
