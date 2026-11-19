/**
 * How a code node draws its named ranges (`range sql.copy1 lines=3-6`): a band behind the lines,
 * a bar in the left margin and a label tag in the right margin. Every mark sits inside the box
 * and under the text, so a range never changes the node's size or the layout. The canvas and
 * `renderSvg` both draw from `rangeMarks`, so the viewer and every export agree.
 */
import { ensureContrast, swatchFor, type ResolvedAppearance } from './appearance';
import {
  CODE_TYPE,
  codeLayout,
  columnX,
  type CodeBlock,
  type CodeLayout,
  type CodeRange,
} from './code';
import { measureText, truncateText } from './fonts';
import type { Diagram, Rect } from './types';

/** Opacity of a band, so overlapping bands blend into a deeper tint. */
export const BAND_OPACITY = 0.7;
/** Bar width, and the step between the bars of nested or overlapping ranges. */
const BAR = 3;
const BAR_STEP = 4;
/** Bars fit in the left padding: at most this many side by side. */
const BAR_LANES = 3;
/** The label tag's padding and its gap from the box's right edge. */
const TAG_PAD = 4;
const TAG_INSET = 6;
/** Room a tag keeps from the code before it on its row. */
const TAG_GAP = 12;

/** The family a status draws in; a range without a change mark keeps its own color. */
const STATUS_FAMILY: Record<string, string> = { added: 'green', changed: 'amber', removed: 'red' };

export interface RangeMark {
  range: CodeRange;
  /** The band, from the box's top edge. */
  y: number;
  h: number;
  band: string;
  /** The bar: its center x, color, width and dashes (a removed range). */
  barX: number;
  bar: string;
  barW: number;
  dash?: string;
  /** Fade for a dimmed or context range. */
  opacity: number;
  /** The label tag: its box and the text's right edge, from the box's top-left corner. */
  tag?: { x: number; y: number; w: number; h: number; text: string; ink: string };
}

/** The rows of a range that the layout shows, as a band; undefined when all are cut off. */
export function rangeBand(laid: CodeLayout, r: CodeRange) {
  const rows = laid.rows.filter(row => row.line >= r.from && row.line <= r.to);
  if (!rows.length) return undefined;
  return { y: rows[0].y, h: rows[rows.length - 1].y + CODE_TYPE.lineHeight - rows[0].y };
}

/** The bands, bars and tags of a code node's ranges, in file order. */
export function rangeMarks(
  code: CodeBlock,
  laid: CodeLayout,
  look: ResolvedAppearance,
  w: number,
  fill: string,
): RangeMark[] {
  const ranges = code.ranges ?? [];
  if (!ranges.length) return [];
  // Bars of overlapping ranges stand side by side: each takes the first lane none overlapping
  // it holds, the longer ranges first so a nested range sits inside its parent's bar.
  const lanes = new Map<CodeRange, number>();
  for (const r of [...ranges].sort((a, b) => a.from - b.from || b.to - a.to)) {
    const taken = new Set(
      [...lanes].filter(([o]) => o.from <= r.to && r.from <= o.to).map(([, lane]) => lane),
    );
    let lane = 0;
    while (taken.has(lane)) lane++;
    lanes.set(r, lane % BAR_LANES);
  }
  const usedRows = new Set<number>(),
    tagType = look.annotation;
  return ranges.flatMap(r => {
    const band = rangeBand(laid, r);
    if (!band) return [];
    const family = STATUS_FAMILY[r.status ?? ''] ?? r.color,
      bandFill = swatchFor(look, family, look.dark ? 900 : 100).fill,
      bar = ensureContrast(swatchFor(look, family, look.dark ? 400 : 500).fill, fill, 3),
      opacity = r.spot === 'dim' ? 0.35 : r.status === 'context' ? 0.45 : 1,
      focus = r.spot === 'focus' || r.spot === 'ring';
    const mark: RangeMark = {
      range: r,
      ...band,
      band: bandFill,
      barX: 2 + BAR / 2 + lanes.get(r)! * BAR_STEP,
      bar,
      barW: focus ? BAR + 1 : BAR,
      ...(r.status === 'removed' ? { dash: '4 3' } : {}),
      opacity,
    };
    if (r.label) {
      const text = truncateText(r.label, Math.max(40, w / 2), tagType),
        tw = measureText(text, tagType) + 2 * TAG_PAD,
        th = CODE_TYPE.lineHeight - 1,
        x = w - TAG_INSET - tw,
        rows = laid.rows
          .map((row, i) => ({ row, i }))
          .filter(({ row }) => row.line >= r.from && row.line <= r.to),
        // The tag takes the range's first row the code leaves room on, so it covers nothing;
        // a row another tag holds is skipped, so tags of overlapping ranges stack.
        free = rows.filter(({ i }) => !usedRows.has(i)),
        room =
          free.find(({ row }) => columnX(laid, row.col + (row.to - row.from)) + TAG_GAP <= x) ??
          free[0] ??
          rows[0];
      usedRows.add(room.i);
      mark.tag = {
        x,
        y: room.row.y + 0.5,
        w: tw,
        h: th,
        text,
        ink: ensureContrast(swatchFor(look, family, look.dark ? 100 : 800).fill, bandFill, 4.5),
      };
    }
    return [mark];
  });
}

/**
 * The box of a range on its node, in diagram coordinates: the node's width, the range's rows.
 * A note `near=` a range sits beside this box, and a line to it ends at its middle.
 */
export function rangeRect(
  doc: Diagram,
  look: ResolvedAppearance,
  rects: ReadonlyMap<string, Rect>,
  id: string,
): Rect | undefined {
  const found = findRange(doc, id),
    r = found && rects.get(found.node.id);
  if (!r) return undefined;
  const laid = codeLayout(found!.node.code!, found!.node.title, look, { width: r.w, height: r.h }),
    band = rangeBand(laid, found!.range);
  return band ? { x: r.x, y: r.y + band.y, w: r.w, h: band.h } : undefined;
}

/** The node and range an ID such as `sql.copy1` names, if it names one. */
export function findRange(doc: Diagram, id: string) {
  for (const node of doc.graph.nodes) {
    if (!node.code?.ranges || !id.startsWith(node.id + '.')) continue;
    const range = node.code.ranges.find(r => `${node.id}.${r.name}` === id);
    if (range) return { node, range };
  }
  return undefined;
}

/** The range ID of a code range: `<node>.<name>`. */
export const rangeId = (node: string, r: CodeRange) => `${node}.${r.name}`;
