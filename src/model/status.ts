/**
 * Change status: how an object or connection differs between two versions of a diagram, drawn
 * the same way by the canvas, `inspect --svg` and the exports.
 *
 * A file with change marks is a diff, and in a diff color means change and nothing else:
 * unchanged shapes turn neutral, containers become quiet outlines, unchanged lines go grey, and
 * only added (green), changed (amber) and removed (red) objects keep a hue, as a tinted fill with
 * a strong border. Each status also has a border weight, dash, fade or marker, so a diff still
 * reads in grayscale. A removed title stays readable; `config strike-removed=on` strikes it.
 */
import {
  ensureContrast,
  swatchFor,
  type LegendEntry,
  type ResolvedAppearance,
  type Shade,
  type Swatch,
} from './appearance';
import { descendants, pastRect, styleOf } from './graph';
import type { Diagram, DiagramEdge } from './types';

export type Status = 'same' | 'added' | 'removed' | 'changed' | 'context';

/**
 * How an emphasis state draws an object or connection: in focus (a heavier border or line),
 * ringed (in focus where nothing else fades, so it also takes an accent ring or line), or dimmed
 * (faded and neutral, like a `.` context line). Unset means it draws as usual.
 */
export type Spot = 'focus' | 'ring' | 'dim';
export const STATUSES: Status[] = ['same', 'added', 'removed', 'changed', 'context'];

/**
 * A changed object drawn with a ghost where it was (`was-at=`) or at its old size (`was-size=`).
 * The legend counts these apart from `changed`, which counts them too.
 */
export type PlaceChange = 'moved' | 'resized';

/** Legend order and wording, after a count; `same` needs no entry. */
export const STATUS_LABELS: Partial<Record<Status | PlaceChange, string>> = {
  added: 'added',
  changed: 'changed',
  moved: 'moved',
  resized: 'resized',
  removed: 'removed',
  context: 'shown for context',
};

export interface StatusCount {
  status: Status | PlaceChange;
  /** Objects with the mark. */
  count: number;
  /** Connections with the mark. */
  lines: number;
}

const linesText = (n: number) => `${n} line${n === 1 ? '' : 's'}`;

/**
 * A legend entry's text: how many objects carry the mark and what it means, then how many
 * connections, so five added boxes and their five lines read "5 added · 5 lines", not "10 added".
 */
export const statusLabel = ({ status, count, lines }: StatusCount) =>
  count
    ? `${count} ${STATUS_LABELS[status]}${lines ? ` · ${linesText(lines)}` : ''}`
    : `${linesText(lines)} ${STATUS_LABELS[status]}`;

/** The color family each status is drawn in. */
const HUES: Partial<Record<Status, string>> = { added: 'green', changed: 'amber', removed: 'red' };
/**
 * The shade of a status's border in light themes. The marks differ in lightness as well as hue,
 * so added and removed stay apart for red-green color blindness.
 */
const STROKE_SHADES: Partial<Record<Status, Shade>> = { added: 500, changed: 500, removed: 700 };
const strokeOf = (look: ResolvedAppearance, status: Status) =>
  look.dark
    ? swatchFor(look, HUES[status], 400).fill
    : ensureContrast(swatchFor(look, HUES[status], STROKE_SHADES[status]).fill, look.canvas, 3);

export interface StatusPaint {
  /** Line color for connections; shapes take theirs from `statusSwatch`. */
  stroke?: string;
  width?: number;
  dash?: string;
  opacity: number;
  /** Strike the title through. */
  strike: boolean;
  /** Fade of the title text alone, on top of `opacity`. */
  inkFade?: number;
  /** Draw the removed marker, a minus in a disc, on the shape's top-right corner. */
  marker?: boolean;
  /** Draw an accent ring around the shape (`haloInk`). */
  halo?: boolean;
}

/** The removed marker's radius and its inset from a shape's top-right corner. */
export const MARKER = { r: 7, inset: 2 };

/** Room between a shape and its focus ring. */
export const HALO_GAP = 4;

/** The accent a ringed object or connection is drawn with: the theme's second accent. */
export const haloInk = (look: ResolvedAppearance) =>
  ensureContrast(swatchFor(look, 'secondary', look.dark ? 300 : 500).fill, look.canvas, 3);

const PLAIN: StatusPaint = { opacity: 1, strike: false };

/** Focus weight: a node border, and 0.5 more than a connection's line. */
const FOCUS_WIDTH = 2.4;

/** The paint for a change status, with an emphasis state's weight or fade on top. */
export function statusPaint(look: ResolvedAppearance, status?: Status, spot?: Spot): StatusPaint {
  const p = changePaint(look, status);
  if (spot === 'focus' || spot === 'ring')
    return { ...p, width: Math.max(p.width ?? 0, FOCUS_WIDTH), halo: spot === 'ring' };
  if (spot === 'dim') return { ...p, opacity: Math.min(p.opacity, CONTEXT_FADE) };
  return p;
}

const CONTEXT_FADE = 0.45;

function changePaint(look: ResolvedAppearance, status?: Status): StatusPaint {
  const stroke = status && HUES[status] ? strokeOf(look, status) : undefined;
  switch (status) {
    case 'added':
    case 'changed':
      return { stroke, width: 2, opacity: 1, strike: false };
    case 'removed':
      return {
        stroke,
        width: 2,
        dash: '6 4',
        opacity: 1,
        strike: look.strikeRemoved,
        inkFade: 0.8,
        marker: true,
      };
    case 'context':
      return { ...PLAIN, opacity: CONTEXT_FADE };
    default:
      return PLAIN;
  }
}

/** Whether the document is a diff: any object or connection carries a change mark. */
export const isDiff = (doc: Diagram) =>
  !!doc.appearance.compare ||
  Object.values(doc.styles).some(s => s.status) ||
  doc.graph.edges.some(e => e.status);

/**
 * In a diff, the swatch a status draws a shape with: a pale tint of its hue with a strong border
 * and dark ink, or the neutral surface (a quiet outline for containers) when unchanged.
 */
export function statusSwatch(
  look: ResolvedAppearance,
  status: Status | undefined,
  kind: 'node' | 'group',
): Swatch {
  const hue = HUES[status ?? 'same'];
  if (!hue)
    return kind === 'group' ? { fill: look.canvas, stroke: look.muted, ink: look.text } : look.node;
  // A removed object takes a paler tint, and a removed container none, so its text reads.
  const removed = status === 'removed',
    fill =
      removed && kind === 'group' && !look.dark
        ? look.canvas
        : swatchFor(look, hue, look.dark ? 900 : kind === 'group' || removed ? 50 : 100).fill;
  return {
    fill,
    stroke: strokeOf(look, status!),
    ink: swatchFor(look, hue, look.dark ? 100 : 900).fill,
  };
}

/** A connection's color: its status hue, or quiet grey for an unchanged line in a diff. */
export const edgeInk = (look: ResolvedAppearance, edge: DiagramEdge, diff: boolean) =>
  statusPaint(look, edge.status).stroke ??
  (edge.spot === 'ring'
    ? haloInk(look)
    : diff || edge.spot === 'dim'
      ? look.muted
      : look.connection);

/**
 * The states a reader picks from, in file order: every state but those with `chips=hidden`. The
 * chips, the grid, `[` and `]` and `--states` list these; a hidden state is drawn only on request.
 */
export const listedStates = (doc: Diagram) => (doc.appearance.states ?? []).filter(s => !s.hidden);

/**
 * The document drawn in emphasis state `id`. Listed objects (a group with all its members) and
 * listed connections are in focus, and so is a connection between two focused nodes. With
 * `rest=dim`, everything else fades, except the containers that hold something in focus, so the
 * context still reads, and the state's `context=`, which draws as usual: so does a connection
 * whose ends are both in focus or context. With `rest=plain` nothing fades, so focus also takes an
 * accent ring. Nothing moves.
 */
export function withState(doc: Diagram, id: string): Diagram {
  const state = doc.appearance.states?.find(s => s.id === id);
  if (!state) return doc;
  /** The IDs listed, with every member of a listed group. */
  const expand = (ids: readonly string[]) => {
    const out = new Set<string>();
    for (const x of ids) {
      out.add(x);
      if (doc.graph.groups.some(g => g.id === x)) for (const d of descendants(doc, x)) out.add(d);
    }
    return out;
  };
  const focus = expand(state.ids),
    context = expand(state.context ?? []);
  const parent = new Map(
    [...doc.graph.nodes, ...doc.graph.groups].map(o => [o.id, o.parentId] as const),
  );
  // The containers of anything in focus or context draw plain too, but bring no connections.
  const frames = new Set<string>();
  for (const x of [...focus, ...context])
    for (let p = parent.get(x); p; p = parent.get(p)) frames.add(p);
  const rest = state.rest === 'dim' ? ('dim' as const) : undefined,
    on = state.rest === 'dim' ? ('focus' as const) : ('ring' as const),
    spotOf = (x: string) =>
      focus.has(x) ? on : context.has(x) || frames.has(x) ? undefined : rest,
    styles = { ...doc.styles },
    near = (x: string) => focus.has(x) || context.has(x);
  for (const o of [...doc.graph.nodes, ...doc.graph.groups]) {
    const spot = spotOf(o.id);
    if (spot) styles[o.id] = { ...styleOf(doc, o.id), spot };
  }
  const edges = doc.graph.edges.map(e => {
    const spot =
      focus.has(e.id) || (focus.has(e.from) && focus.has(e.to))
        ? on
        : context.has(e.id) || (near(e.from) && near(e.to))
          ? undefined
          : rest;
    return spot ? { ...e, spot } : e;
  });
  return { ...doc, styles, graph: { ...doc.graph, edges } };
}

/**
 * The marks a document uses that the legend explains, in legend order, each with how many
 * objects and connections carry it, so the key doubles as the change's size.
 */
export function usedStatuses(doc: Diagram): StatusCount[] {
  const ids = new Set([...doc.graph.nodes, ...doc.graph.groups].map(o => o.id)),
    marks = Object.entries(doc.styles)
      .filter(([id]) => ids.has(id))
      .map(([, s]) => s.status);
  const places = placeChanges(doc);
  return (Object.keys(STATUS_LABELS) as (Status | PlaceChange)[])
    .map(status => ({
      status,
      count:
        status === 'moved' || status === 'resized'
          ? places[status]
          : marks.filter(m => m === status).length,
      lines: doc.graph.edges.filter(e => e.status === status).length,
    }))
    .filter(c => c.count || c.lines);
}

/** How many objects the drawing shows a ghost for at another place, and at another size only. */
export function placeChanges(doc: Diagram): Record<PlaceChange, number> {
  const out = { moved: 0, resized: 0 };
  for (const o of [...doc.graph.nodes, ...doc.graph.groups]) {
    const now = doc.layout.nodes[o.id],
      was = now && pastRect(doc, o.id, now);
    if (!was) continue;
    if (was.x !== now.x || was.y !== now.y) out.moved++;
    else if (was.w !== now.w || was.h !== now.h) out.resized++;
  }
  return out;
}

/** The color key's rows: a diff draws no family colors, so it lists only its statuses. */
export const drawnLegend = (doc: Diagram): LegendEntry[] =>
  isDiff(doc) ? [] : (doc.appearance.legend ?? []);
