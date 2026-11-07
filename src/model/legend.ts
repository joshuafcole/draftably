/** The color key drawn under an exported diagram, shared by `inspect --svg` and the editor's export. */
import { NODE_SHADE, swatchFor, type LegendEntry, type ResolvedAppearance } from './appearance';
import { measureText } from './fonts';
import { GHOST_DASH } from './position-marks';
import {
  MARKER,
  statusLabel,
  statusPaint,
  statusSwatch,
  type Status,
  type StatusCount,
} from './status';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The removed marker, a minus in a disc of radius `r`, centred at (x, y). */
export const markerMarkup = (x: number, y: number, ink: string, canvas: string, r = MARKER.r) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}" stroke="${canvas}" stroke-width="${r / 4.5}"/>` +
  `<path d="M${x - r / 2},${y} h${r}" stroke="${canvas}" stroke-width="${r / 4}" stroke-linecap="round"/>`;

/** Space between entries that share a row. */
const GAP = 24;

/** Width of one entry: its swatch, the gap after it, and its label. */
const entryW = (look: ResolvedAppearance, label: string) =>
  24 + measureText(label, look.annotation);

/**
 * Lay out the key: every `legend` entry, then every change mark used with its count, left to
 * right, starting a new row only where the next entry would pass `max`. A short key is one row
 * under the drawing. Zero size when there is nothing to show.
 */
export function legendSize(
  look: ResolvedAppearance,
  legend: LegendEntry[] = [],
  statuses: StatusCount[] = [],
  max = Infinity,
) {
  const row = Math.round(look.annotation.lineHeight + 8),
    entries: { legend?: LegendEntry; status?: StatusCount; label: string }[] = [
      ...legend.map(e => ({ legend: e, label: e.label })),
      ...statuses.map(s => ({ status: s, label: statusLabel(s) })),
    ];
  let x = 0,
    y = 0,
    w = 0;
  const items = entries.map(e => {
    const ew = entryW(look, e.label);
    if (x && x + ew > max) {
      x = 0;
      y += row;
    }
    const at = { ...e, x, y };
    w = Math.max(w, x + ew);
    x += ew + GAP;
    return at;
  });
  return { w, h: items.length ? y + row + 12 : 0, row, items };
}

export type LegendLayout = ReturnType<typeof legendSize>;

/** SVG markup for the key laid out by `legendSize`, with its top-left corner at (x, y). */
export function legendMarkup(look: ResolvedAppearance, key: LegendLayout, x: number, y: number) {
  const { row } = key,
    { family, size, weight } = look.annotation;
  return key.items
    .map(e => {
      const left = x + e.x,
        top = y + 12 + e.y,
        mid = top + row / 2;
      let swatch: string;
      if (e.legend?.line) {
        // A line row draws a short connection in the style it explains.
        swatch = `<line x1="${left}" y1="${mid}" x2="${left + 16}" y2="${mid}" stroke="${look.connection}" stroke-width="1.4"${e.legend.line === 'dashed' ? ' stroke-dasharray="5 5"' : ''}/>`;
      } else if (e.legend) {
        const c = swatchFor(look, e.legend.family!, e.legend.shade ?? NODE_SHADE, 'node');
        swatch = box(left, top, row, `fill="${c.fill}" stroke="${c.stroke}"`);
      } else if (e.status!.status === 'moved' || e.status!.status === 'resized') {
        // A ghost where the box was; a move also takes its hairline to a dot.
        const ink = statusPaint(look, 'changed').stroke!,
          ghost = `fill="none" stroke="${ink}" stroke-width="1.4" stroke-dasharray="${GHOST_DASH}"`;
        swatch =
          e.status!.status === 'resized'
            ? box(left, top, row, ghost)
            : `<rect x="${left}" y="${mid - 4}" width="8" height="8" rx="2" ${ghost}/>` +
              `<line x1="${left + 8}" y1="${mid}" x2="${left + 14}" y2="${mid}" stroke="${ink}" stroke-width="1"/>` +
              `<circle cx="${left + 14}" cy="${mid}" r="2" fill="${ink}"/>`;
      } else {
        // A change entry draws a box with that mark's fill, border, dash, fade and marker.
        const s = e.status!.status as Status,
          p = statusPaint(look, s),
          c = statusSwatch(look, s, 'node');
        swatch =
          box(
            left,
            top,
            row,
            `fill="${c.fill}" stroke="${c.stroke}" stroke-width="${p.width ?? 1}"${p.dash ? ` stroke-dasharray="3 2"` : ''} opacity="${p.opacity}"`,
          ) +
          (p.marker ? markerMarkup(left + 16, top + (row - 12) / 2, c.stroke, look.canvas, 4) : '');
      }
      return (
        swatch +
        `<text x="${left + 24}" y="${mid}" dominant-baseline="central" font-family="${esc(family)}" font-size="${size}" font-weight="${weight}" fill="${look.text}">${esc(e.label)}</text>`
      );
    })
    .join('');
}

const box = (left: number, top: number, row: number, paint: string) =>
  `<rect x="${left}" y="${top + (row - 12) / 2}" width="16" height="12" rx="3" ${paint}/>`;
