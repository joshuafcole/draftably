/**
 * Footnotes: a block of short entries between the drawing and the key, from `footnote`
 * statements, in file order, at body text size and wrapped to the frame. An entry may carry a
 * marker (`1`, `a`, `*`) that a label can point at, and links in `[label](href)` form. The viewer,
 * `inspect --svg`, PDF and the editor's exports all lay it out here.
 */
import { linkInk, type ResolvedAppearance } from './appearance';
import { measureText } from './fonts';
import { headingTypes } from './heading';
import { richLines, runsMarkup, type Run } from './rich-text';

export interface Footnote {
  text: string;
  /** A short marker drawn before the entry, which labels can point at as `[1]`. */
  mark?: string;
}

/** Room above the block (a short rule, then a gap), between entries, and under the block. */
const RULE = 24,
  ABOVE = 10,
  GAP = 4,
  BELOW = 16;

/** The block's entries, wrapped to `width`, with their offsets from its top-left corner. */
export function footnoteSize(look: ResolvedAppearance, notes: readonly Footnote[], width: number) {
  const type = headingTypes(look).subtitle,
    marks = notes.filter(n => n.mark).map(n => measureText(n.mark!, type)),
    gutter = marks.length ? Math.ceil(Math.max(...marks)) + 10 : 0;
  let y = ABOVE;
  const items = notes.map(note => {
    const lines = richLines(note.text, Math.max(80, width - gutter), type),
      item = { note, lines, y };
    y += lines.length * type.lineHeight + GAP;
    return item;
  });
  return { type, gutter, items, h: items.length ? y - GAP + BELOW : 0 };
}

export type FootnoteLayout = ReturnType<typeof footnoteSize>;

/** Where each line of every entry is drawn, from the block's top-left corner at (x, y). */
export function footnoteLines(layout: FootnoteLayout, x: number, y: number) {
  const { type, gutter } = layout;
  return layout.items.flatMap((item, i) =>
    item.lines.map((runs, j) => ({
      entry: i,
      runs: runs as Run[],
      x: x + gutter,
      y: y + item.y + j * type.lineHeight,
    })),
  );
}

/** SVG markup for the block: a short rule, then each entry's marker and wrapped text. */
export function footnoteMarkup(
  look: ResolvedAppearance,
  layout: FootnoteLayout,
  x: number,
  y: number,
  write: (href: string) => string | null = h => h,
): string {
  if (!layout.items.length) return '';
  const { type } = layout,
    font = `font-family="${type.family.replace(/"/g, '&quot;')}" font-size="${type.size}" font-weight="${type.weight}"`,
    link = linkInk(look, look.canvas),
    mid = (top: number) => top + type.lineHeight / 2;
  const marks = layout.items
    .filter(item => item.note.mark)
    .map(
      item =>
        `<text x="${x}" y="${mid(y + item.y)}" dominant-baseline="central" ${font} fill="${look.muted}">${esc(item.note.mark!)}</text>`,
    );
  const lines = footnoteLines(layout, x, y).map(
    l =>
      `<text x="${l.x}" y="${mid(l.y)}" dominant-baseline="central" ${font} fill="${look.text}">${runsMarkup(l.runs, link, write)}</text>`,
  );
  return (
    `<g class="diagram-footnotes">` +
    `<line x1="${x}" x2="${x + RULE}" y1="${y}" y2="${y}" stroke="${look.muted}" stroke-opacity="0.6"/>` +
    marks.join('') +
    lines.join('') +
    '</g>'
  );
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
