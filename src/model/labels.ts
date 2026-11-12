import { resolveAppearance, type ResolvedAppearance } from './appearance';
import { GROUP_TITLE_CHROME } from '../dsl/frame';
import { measureText, truncateText, wrapLines, type TypeProfile } from './fonts';
import { rectUnion } from './geometry';
import type { Diagram, LabelMode, Rect, ShapeKind } from './types';
import { styleOf } from './graph';

/**
 * Room for a shape's title. Every size, wrap and overflow decision goes through these functions,
 * in the compiler, the canvas and the CLI alike.
 */
export interface TitleArea {
  /** Line width available to the title. */
  width: number;
  /** Tallest text block that fits inside the shape at its current height. */
  maxHeight: number;
}

export function titleArea(
  shape: ShapeKind,
  w: number,
  h: number,
  r: ResolvedAppearance,
  icon = false,
): TitleArea {
  // A diamond's text block sits in its middle: at 45% of its height the outline is 55% wide.
  if (shape === 'diamond') return { width: Math.max(40, w * 0.55), maxHeight: h * 0.45 };
  // An ellipse is 71% wide at 70% of its height.
  if (shape === 'circle') return { width: Math.max(40, w * 0.7), maxHeight: h * 0.7 };
  const padY = shape === 'text' ? Math.min(r.paddingY, 11) : r.paddingY;
  return {
    width: Math.max(40, w - 2 * r.paddingX - (icon ? 30 : 0) - (shape === 'pill' ? 8 : 0)),
    maxHeight: h - 2 * padY,
  };
}

/** Height a shape needs for a title block `text` px tall; never less than `base`. */
export function titleHeight(shape: ShapeKind, text: number, base: number, r: ResolvedAppearance) {
  if (shape === 'circle') return Math.max(base, Math.ceil(text / 0.7));
  if (shape === 'text') return text + 2 * Math.min(r.paddingY, 11);
  return text + 2 * r.paddingY;
}

/** One line of a shape's title: part of its name, or of its detail. */
export interface TitleLine {
  text: string;
  /** A detail line, from the text after the title's first `\n`, drawn in `r.detail`. */
  detail: boolean;
}

/**
 * A shape's title in balanced lines no wider than `width` (see `wrapLines`). The text before the
 * first `\n` is the name, in the title type; the rest is detail, in the smaller detail type.
 */
export function wrapTitle(text: string, width: number, r: ResolvedAppearance): TitleLine[] {
  const cut = text.indexOf('\n'),
    name = cut < 0 ? text : text.slice(0, cut);
  const lines = wrapLines(name, width, r.title, true).map(t => ({ text: t, detail: false }));
  if (cut >= 0)
    for (const t of wrapLines(text.slice(cut + 1), width, r.detail, true))
      lines.push({ text: t, detail: true });
  return lines;
}

/** The type a title line is set in. */
export const lineType = (l: TitleLine, r: ResolvedAppearance) => (l.detail ? r.detail : r.title);

/** Height of a block of title lines. */
export const textHeight = (lines: TitleLine[], r: ResolvedAppearance) =>
  lines.reduce((h, l) => h + lineType(l, r).lineHeight, 0);

/** Each line's centre, measured from the middle of the block. */
export function lineOffsets(lines: TitleLine[], r: ResolvedAppearance) {
  let y = -textHeight(lines, r) / 2;
  return lines.map(l => {
    const lh = lineType(l, r).lineHeight,
      at = y + lh / 2;
    y += lh;
    return at;
  });
}

/** Room kept between a diamond's title and its outline. */
const DIAMOND_PAD = 6;

/**
 * Line width for a diamond's title, `s` its side. A text block W wide and H tall fits inside a
 * square diamond when W + H <= s, so this takes the widest measure whose wrapped lines still fit:
 * the title reads in as few lines as the shape allows. Undefined when no measure fits.
 */
export function diamondMeasure(title: string, s: number, r: ResolvedAppearance) {
  const room = s - 2 * DIAMOND_PAD;
  for (let n = 1; n * r.title.lineHeight < room; n++) {
    const width = room - n * r.title.lineHeight;
    if (width >= 40 && textHeight(wrapTitle(title, width, r), r) <= n * r.title.lineHeight)
      return width;
  }
}

/** Most lines a group title wraps to; past that the frame widens instead. */
export const GROUP_TITLE_LINES = 3;

/** A group's header height when its title takes `lines` lines. */
export const groupHeaderFor = (r: ResolvedAppearance, lines = 1) =>
  r.groupHeader + (lines - 1) * r.groupTitle.lineHeight;

/**
 * A group title as drawn in a frame `w` wide: wrapped to at most `lines` lines (the compiler
 * reserves that many), the last shortened with an ellipsis if the text runs on.
 */
export function groupTitleLines(title: string, w: number, r: ResolvedAppearance, lines = 1) {
  const width = Math.max(40, w - GROUP_TITLE_CHROME),
    all = wrapLines(title, width, r.groupTitle, true);
  if (all.length <= lines) return all;
  const kept = all.slice(0, lines);
  kept[lines - 1] = truncateText(all.slice(lines - 1).join(' '), width, r.groupTitle);
  return kept;
}

export interface NodeLabel {
  /** Center of the label, relative to the shape's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  lines: TitleLine[];
  /** Each line's centre, relative to `y`. */
  offsets: number[];
  mode: LabelMode;
  leader: boolean;
}

/** Where a shape's title is drawn, relative to the shape. */
export function nodeLabel(doc: Diagram, id: string, title: string, r: Rect): NodeLabel {
  const style = styleOf(doc, id),
    cfg = doc.layout.labels[id] || {};
  const mode: LabelMode =
    cfg.mode ||
    (style.shape === 'icon' || style.shape === 'image' || (style.shape === 'circle' && style.icon)
      ? 'bottom'
      : 'center');
  const look = resolveAppearance(doc.appearance);
  const iconInside = mode === 'center' && !!style.icon && ['box', 'pill'].includes(style.shape);
  let x = r.w / 2 + (iconInside ? 15 : 0),
    y = r.h / 2,
    width =
      cfg.width ||
      (style.shape === 'diamond' && diamondMeasure(title, Math.min(r.w, r.h), look)) ||
      titleArea(style.shape, r.w, r.h, look, iconInside).width;
  if (mode !== 'center') width = cfg.width || Math.max(142, r.w);
  const lines = wrapTitle(title, width, look),
    height = textHeight(lines, look);
  if (mode === 'top') y = -16 - height / 2;
  if (mode === 'bottom') y = r.h + 15 + height / 2;
  if (mode === 'left') x = -20 - width / 2;
  if (mode === 'right') x = r.w + 20 + width / 2;
  if (mode === 'detached') {
    x = r.w / 2 + (cfg.dx ?? 130);
    y = r.h / 2 + (cfg.dy ?? -65);
  } else {
    x += cfg.dx || 0;
    y += cfg.dy || 0;
  }
  return {
    x,
    y,
    width,
    height,
    lines,
    offsets: lineOffsets(lines, look),
    mode,
    leader: cfg.leader ?? mode === 'detached',
  };
}

/** Bounds of a shape together with its label. */
export function visualBounds(doc: Diagram, id: string, title: string, r: Rect): Rect {
  const l = nodeLabel(doc, id, title, r);
  return rectUnion([
    r,
    { x: r.x + l.x - l.width / 2, y: r.y + l.y - l.height / 2, w: l.width, h: l.height },
  ]);
}

/** Text width a sequence message's label wraps to; the gap between participants follows it. */
export const MESSAGE_WRAP = 168;

/**
 * The type a connection label is set in: the annotation type, or a step larger for a sequence
 * message (`message`), whose label is the main thing to read.
 */
export const edgeLabelType = (r: ResolvedAppearance, message = false): TypeProfile =>
  message
    ? { ...r.annotation, size: r.annotation.size + 1.5, lineHeight: r.annotation.lineHeight + 2 }
    : r.annotation;

/**
 * Text width a flow line's label wraps to: about 24 characters of the annotation type, so a short
 * phrase stays on one line and a sentence stacks instead of widening its gap.
 */
export const LABEL_WRAP = 140;

/**
 * A connection label's lines: split at each `\n` and wrapped to `LABEL_WRAP`, or a sequence
 * message's to `MESSAGE_WRAP`.
 */
export const edgeLabelLines = (label: string, r: ResolvedAppearance, message = false) =>
  wrapLines(label, message ? MESSAGE_WRAP : LABEL_WRAP, edgeLabelType(r, message));

/**
 * A self-message's loop: its run out to the right of the lifeline and its drop. Its label sits
 * `label` past the loop, centred on the drop.
 */
export const SELF_LOOP = { out: 36, down: 22, label: 4 };

/** Box for a connection label in the diagram's annotation type. */
export function edgeLabelSize(
  label: string,
  r: ResolvedAppearance = resolveAppearance(),
  message = false,
) {
  const type = edgeLabelType(r, message),
    lines = edgeLabelLines(label, r, message);
  const w = Math.max(...lines.map(l => measureText(l, type))) + 16;
  return {
    w: Math.round(Math.max(36, w)),
    h: Math.round(lines.length * type.lineHeight + 6),
  };
}

/**
 * What a self-message draws, measured from where its row meets the lifeline: how far right, how
 * far above the row and how far below it.
 */
export function selfMessageInk(label: string | undefined, r: ResolvedAppearance) {
  if (!label) return { right: SELF_LOOP.out, above: 0, below: SELF_LOOP.down };
  const { w, h } = edgeLabelSize(label, r, true);
  return {
    right: SELF_LOOP.out + SELF_LOOP.label + w,
    above: Math.max(0, h / 2 - SELF_LOOP.down / 2),
    below: Math.max(SELF_LOOP.down, SELF_LOOP.down / 2 + h / 2),
  };
}
