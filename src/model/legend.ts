/** The color key drawn under an exported diagram, shared by `inspect --svg` and the editor's export. */
import { NODE_SHADE, swatchFor, type LegendEntry, type ResolvedAppearance } from './appearance';
import { measureText } from './fonts';
import {
  headOf,
  MARKER_SHAPES,
  MARKER_STROKE,
  markerFill,
  tailOf,
  type EndMarker,
} from './markers';
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

/** Width of a row's swatch: a message's line is longer, for the marks at its ends. */
const swatchW = (e?: LegendEntry) =>
  e?.caption ? -8 : e?.message && e.message !== 'action' ? 28 : 16;

/** Width of one entry: its swatch, the gap after it, and its label. */
const entryW = (look: ResolvedAppearance, label: string, e?: LegendEntry) =>
  swatchW(e) + 8 + measureText(label, look.annotation);

/** A mark at one end of a key's line, tip at `x`, as the drawing's `<marker>` draws it. */
function endMark(kind: EndMarker, x: number, y: number, tail: boolean, look: ResolvedAppearance) {
  if (kind === 'none') return '';
  // The mark's own `x` sits where the line stops, as `markerBox` places it.
  const s = MARKER_SHAPES[kind],
    at = tail
      ? `translate(${x + s.stop + s.x} ${y - s.h / 2}) scale(-1 1)`
      : `translate(${x - s.stop - s.x} ${y - s.h / 2})`;
  return `<path transform="${at}" d="${s.d}" fill="${markerFill(kind, look.connection, look.canvas)}" stroke="${look.connection}" stroke-width="${MARKER_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** The mark of a kind of message: its line and ends, or a local action's box. */
function messageSwatch(e: LegendEntry, left: number, mid: number, look: ResolvedAppearance) {
  const ink = look.connection;
  if (e.message === 'action')
    return `<rect x="${left}" y="${mid - 6}" width="16" height="12" rx="3" fill="none" stroke="${ink}" stroke-width="1.4"/>`;
  const ends = { message: e.message },
    [head, tail] = [headOf(ends), tailOf(ends)],
    stop = (k: EndMarker) => (k === 'none' ? 0 : MARKER_SHAPES[k].stop),
    right = left + swatchW(e);
  return (
    `<line x1="${left + stop(tail)}" y1="${mid}" x2="${right - stop(head)}" y2="${mid}" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"${e.message === 'reply' ? ' stroke-dasharray="5 5"' : ''}/>` +
    endMark(tail, left, mid, true, look) +
    endMark(head, right, mid, false, look)
  );
}

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
    const ew = entryW(look, e.label, e.legend);
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
      if (e.legend?.caption)
        return `<text x="${left}" y="${mid}" dominant-baseline="central" font-family="${esc(family)}" font-size="${size}" font-weight="${weight}" fill="${look.muted}">${esc(e.label)}</text>`;
      if (e.legend?.activation)
        // A short lifeline with a bar on it.
        swatch =
          `<line x1="${left + 8}" y1="${mid - 9}" x2="${left + 8}" y2="${mid + 9}" stroke="${look.muted}" stroke-width="1" stroke-dasharray="3 3"/>` +
          `<rect x="${left + 4}" y="${mid - 6}" width="8" height="12" rx="1.5" fill="${look.canvas}" stroke="${look.connection}" stroke-width="1.2"/>`;
      else if (e.legend?.message) swatch = messageSwatch(e.legend, left, mid, look);
      else if (e.legend?.line) {
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
        `<text x="${left + swatchW(e.legend) + 8}" y="${mid}" dominant-baseline="central" font-family="${esc(family)}" font-size="${size}" font-weight="${weight}" fill="${look.text}">${esc(e.label)}</text>`
      );
    })
    .join('');
}

const box = (left: number, top: number, row: number, paint: string) =>
  `<rect x="${left}" y="${top + (row - 12) / 2}" width="16" height="12" rx="3" ${paint}/>`;
