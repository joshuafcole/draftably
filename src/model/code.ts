/**
 * Code nodes: a listing drawn in JetBrains Mono, one source line per row, each character in its
 * own column. Every position comes from column arithmetic on the mono advance, so the compiler,
 * the canvas, `renderSvg`, PNG and PDF place each character at the same spot and nothing depends
 * on how a renderer treats spaces (`xml:space`).
 *
 * `codeLayout` is the one place that decides sizes, wrapping and clipping. Its rows point back
 * into the source lines by index and character range, so later layers (token colors, diff line
 * bands, highlighted line ranges) attach to rows without changing the layout.
 */
import { measureText, typeProfile, type TypeProfile } from './fonts';
import type { ResolvedAppearance } from './appearance';
import type { Spot, Status } from './status';

/** A code node's body and its options, as the file states them. */
export interface CodeBlock {
  /** Body lines after tab expansion, trailing-space removal and dedent. */
  lines: string[];
  /** `lang=`, as written. */
  lang?: string;
  /** `wrap=on` (default): a line wider than the box continues on more rows; off clips it. */
  wrap: boolean;
  /** `numbers=on`: a line-number gutter. */
  numbers: boolean;
  /** `start=`: the first line's number. */
  start: number;
  /** `max-width=`: the widest the box grows before lines wrap or clip. */
  maxWidth: number;
  /** Source line of `lines[0]`, so a note about a body line names the line in the file. */
  sourceLine: number;
  /** Named line ranges from `range` statements, in file order. */
  ranges?: CodeRange[];
  /** `src=`: the body was read from this file, relative to the `.draft`. */
  src?: {
    path: string;
    /** The host could not read it, so `lines` is a placeholder that names it. */
    placeholder?: boolean;
    problem?: { level: 'error' | 'warning'; message: string };
  };
}

/**
 * A named run of body lines (`range sql.copy1 lines=3-6`): a tinted band behind them, a bar in
 * the left margin and an optional label. Its ID is `<node>.<name>`, which edges, notes and states
 * name like any object. A range never changes the node's size.
 */
export interface CodeRange {
  name: string;
  /** First and last body line, as indexes into `CodeBlock.lines`. */
  from: number;
  to: number;
  /** Color family of the band and bar. */
  color: string;
  label?: string;
  /** From a change mark on the `range` line. */
  status?: Status;
  /** How the drawn emphasis state treats it; see `withState`. */
  spot?: Spot;
}

/** The languages `model/highlight.ts` colors; any other `lang=` draws plain text. */
export const CODE_LANGS = ['sql', 'python', 'ts', 'js', 'json', 'yaml', 'sh', 'diff'] as const;
export const CODE_MAX_WIDTH = 960;
export const CODE_TAB = 4;

/** The listing's type: always JetBrains Mono, whatever the theme's fonts. */
export const CODE_TYPE: TypeProfile = typeProfile('mono', true, 12, 17);
/** Width of one column. */
export const CODE_ADVANCE = measureText('M', CODE_TYPE);
export const CODE_PAD = { x: 12, y: 10 };
/** The caption band above the code, when the node has a quoted label. */
export const CAPTION_HEIGHT = 26;
/** Columns between the widest line number and the code. */
const GUTTER_GAP = 2;
/** A continuation row starts this many columns past its line's own indent. */
const HANG = 2;
/** The narrowest box. */
const MIN_WIDTH = 80;

/** Expand tabs to `tab` columns, drop trailing spaces, drop blank lines at both ends, dedent. */
export function codeLines(raw: string[], tab = CODE_TAB): string[] {
  const lines = raw.map(line => {
    let out = '';
    for (const c of line) out += c === '\t' ? ' '.repeat(tab - (out.length % tab)) : c;
    return out.trimEnd();
  });
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const indent = Math.min(
    ...lines.filter(Boolean).map(l => l.length - l.trimStart().length),
    Infinity,
  );
  return Number.isFinite(indent) ? lines.map(l => l.slice(indent)) : lines;
}

/** One drawn row: all of a source line, or one piece of a long one. */
export interface CodeRow {
  /** Index into `CodeBlock.lines`. */
  line: number;
  /** The characters `[from, to)` of that line this row shows (UTF-16 offsets). */
  from: number;
  to: number;
  /** Column of the row's first character: 0, or the hanging indent of a continuation. */
  col: number;
  /** Top of the row, from the box's top edge. */
  y: number;
  /** The line continues on the next row: a ↩ mark in the right margin. */
  wraps?: boolean;
  /** `wrap=off`: the line was cut after `to`, and a `…` sits in the next column. */
  clipped?: boolean;
}

export interface CodeLayout {
  /** The size the listing needs, or the size it was given. */
  w: number;
  h: number;
  /** x of column 0 of the code, from the box's left edge. */
  left: number;
  /** x of column 0 of the line numbers; with `numbers=off` there are none. */
  gutter: number;
  /** Columns the numbers take, right-aligned. */
  numberCols: number;
  /** Columns of code a row holds. */
  cols: number;
  /** Height of the caption band; 0 without a caption. */
  caption: number;
  rows: CodeRow[];
  /** Source lines a fixed height left out: drawn as "… N more lines" on the last row. */
  more: number;
  /** y of the "… N more lines" row, when `more` > 0. */
  moreY: number;
  /** The "… N more lines" row fits inside the box; a very short box draws no row for it. */
  moreShown: boolean;
  /** Source lines that wrapped or were clipped. */
  long: number[];
}

const columns = (s: string) => s.length;
const indentOf = (s: string) => s.length - s.trimStart().length;

/**
 * Split a line into rows `cols` wide. A continuation starts at its line's indent plus two, and a
 * break falls after the last space of the window when one sits in its second half, past the
 * line's indent.
 */
function wrapLine(text: string, cols: number): Array<{ from: number; to: number; col: number }> {
  if (columns(text) <= cols) return [{ from: 0, to: text.length, col: 0 }];
  const indent = indentOf(text),
    hang = Math.min(indent + HANG, Math.floor(cols / 2)),
    out: Array<{ from: number; to: number; col: number }> = [];
  let from = 0,
    col = 0;
  while (from < text.length) {
    const room = cols - col;
    if (text.length - from <= room) {
      out.push({ from, to: text.length, col });
      break;
    }
    let to = from + room;
    const space = text.lastIndexOf(' ', to - 1);
    // A space in the line's own indent is no break: it would leave a row of nothing.
    if (space >= Math.max(from + Math.ceil(room / 2), indent)) to = space + 1;
    out.push({ from, to, col });
    from = to;
    // A continuation never starts on spaces: they sit at the end of the row before.
    while (text[from] === ' ' && from < text.length) from++;
    col = hang;
  }
  return out;
}

/**
 * Size and rows of a code node. Without a size, the box fits its longest line, up to
 * `maxWidth`; past that, lines wrap (or clip with `wrap=off`). A given width wraps at that
 * width, and a given height keeps the rows that fit and ends with "… N more lines".
 */
export function codeLayout(
  code: CodeBlock,
  caption: string,
  look: ResolvedAppearance,
  size: { width?: number; height?: number } = {},
): CodeLayout {
  const adv = CODE_ADVANCE,
    lh = CODE_TYPE.lineHeight,
    lines = code.lines.length ? code.lines : [''],
    last = code.start + lines.length - 1,
    numberCols = code.numbers ? String(last).length : 0,
    gutterW = code.numbers ? (numberCols + GUTTER_GAP) * adv : 0,
    band = caption ? CAPTION_HEIGHT : 0,
    longest = Math.max(...lines.map(columns)),
    captionW = caption ? measureText(caption, look.annotation) + 2 * CODE_PAD.x : 0,
    natural = Math.ceil(
      Math.max(MIN_WIDTH, captionW, 2 * CODE_PAD.x + gutterW + longest * adv + 0.01),
    ),
    w =
      size.width ??
      Math.min(natural, Math.max(code.maxWidth, Math.ceil(2 * CODE_PAD.x + gutterW + 8 * adv))),
    // A small tolerance, so rounding a fitted width never costs the last column.
    cols = Math.max(4, Math.floor((w - 2 * CODE_PAD.x - gutterW) / adv + 0.05));
  const rows: CodeRow[] = [],
    long: number[] = [],
    top = band + CODE_PAD.y;
  lines.forEach((text, line) => {
    const pieces = code.wrap
      ? wrapLine(text, cols)
      : columns(text) > cols
        ? [{ from: 0, to: cols - 1, col: 0 }]
        : [{ from: 0, to: text.length, col: 0 }];
    if (pieces.length > 1 || pieces[0].to < text.length) long.push(line);
    pieces.forEach((p, i) =>
      rows.push({
        line,
        ...p,
        y: top + rows.length * lh,
        ...(i < pieces.length - 1 ? { wraps: true } : {}),
        ...(!code.wrap && p.to < text.length ? { clipped: true } : {}),
      }),
    );
  });
  const auto = band + 2 * CODE_PAD.y + rows.length * lh;
  let more = 0,
    moreY = 0,
    moreShown = false;
  if (size.height !== undefined && auto > size.height + 0.5) {
    // Keep the rows that fit with one row to spare for "… N more lines".
    const fit = Math.max(0, Math.floor((size.height - band - 2 * CODE_PAD.y) / lh) - 1);
    let kept = rows.slice(0, fit);
    // Never end on part of a wrapped line: drop its earlier rows too.
    const cut = rows[fit];
    if (cut && kept.length && kept[kept.length - 1].line === cut.line)
      kept = kept.filter(r => r.line !== cut.line);
    more = lines.length - (kept.length ? kept[kept.length - 1].line + 1 : 0);
    rows.length = 0;
    rows.push(...kept);
    moreY = top + kept.length * lh;
    moreShown = moreY + lh <= size.height + 0.5;
  }
  return {
    w,
    h: size.height ?? auto,
    left: CODE_PAD.x + gutterW,
    gutter: CODE_PAD.x,
    numberCols,
    cols,
    caption: band,
    rows,
    more,
    moreY,
    moreShown,
    long,
  };
}

/**
 * A run of text at its column; a row draws as its runs. A run holds single spaces, which every
 * renderer keeps and which take one mono column. Leading spaces and runs of two or more are
 * never drawn: the next run starts at its own column instead.
 */
export interface CodeRun {
  col: number;
  text: string;
}

/**
 * A row's text as runs that each start at their own column, so no renderer has to keep a run of
 * spaces. Token colors split these runs again at token edges.
 */
export function codeRuns(row: CodeRow, text: string): CodeRun[] {
  const out: CodeRun[] = [],
    part = text.slice(row.from, row.to);
  for (const m of part.matchAll(/\S+(?: \S+)*/g)) out.push({ col: row.col + m.index!, text: m[0] });
  if (row.clipped) out.push({ col: row.col + part.length, text: '…' });
  return out;
}

/** x of a column, from the box's left edge. */
export const columnX = (layout: CodeLayout, col: number) => layout.left + col * CODE_ADVANCE;

/** The line number drawn on a row, or '' on a continuation row. */
export function rowNumber(code: CodeBlock, layout: CodeLayout, row: CodeRow, i: number) {
  if (!code.numbers || (i > 0 && layout.rows[i - 1].line === row.line)) return '';
  return String(code.start + row.line);
}

/** The vertical extent of a source line's rows, for a band behind it; undefined when hidden. */
export function lineBand(layout: CodeLayout, line: number) {
  const rows = layout.rows.filter(r => r.line === line);
  if (!rows.length) return undefined;
  return { y: rows[0].y, h: rows.length * CODE_TYPE.lineHeight };
}

/** The ↩ that marks a wrapped row: a hook arrow in the right margin, as a path. */
export function wrapMarkPath(x: number, y: number) {
  const s = CODE_TYPE.lineHeight;
  // Centered in an 8px square at the middle of the row.
  const cx = x,
    cy = y + s / 2;
  return `M${cx + 3},${cy - 3.5} v2.5 a1.5,1.5 0 0 1 -1.5,1.5 h-4.5 m1.8,-1.8 l-1.8,1.8 l1.8,1.8`;
}

/** "… 12 more lines". */
export const moreText = (n: number) => `… ${n} more line${n === 1 ? '' : 's'}`;
