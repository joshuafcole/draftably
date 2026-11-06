/**
 * Compile a `.draft` model into geometry. Adapted from Meld 0.1's layout and refinement pass.
 *
 * Geometry is a pure function of the source and one fixed render context: no DOM measurement,
 * randomness, clocks or previous output. The browser and the CLI therefore agree exactly.
 *
 * A scope whose `layout` names an engine is arranged by the editor's layout engine, run cold
 * (`rebuild` without a warm start). A cold rebuild depends only on structure and sizes, never on
 * starting positions, so it is as repeatable as the built-in recipes. Refinements then apply on
 * top of the engine's arrangement exactly as they do on top of `flow`.
 */
import { LayoutLab } from '../engines/layout-engine.js';
import { DEFAULT_THEME, resolveAppearance, type ResolvedAppearance } from '../model/appearance';
import { measureText, widestPiece, wrapLines } from '../model/fonts';
import { rectUnion } from '../model/geometry';
import {
  edgeLabelSize,
  GROUP_TITLE_LINES,
  groupHeaderFor,
  diamondMeasure,
  SELF_LOOP,
  selfMessageInk,
  titleArea,
  titleHeight,
  wrapTitle,
} from '../model/labels';
import { cellsBandFor, layoutCells, layoutUnits } from './cells';
import { marginNotes } from '../model/note';
import { defaultShapeSize } from '../model/styles';
import type { CellsChrome, Diagram, Direction, Lane, Rect, SequenceLayout } from '../model/types';
import { planChannels, trimChannels, type Channel } from './channels';
import { returnLanes, type FlowScope } from './lanes';
import {
  CELLS_TITLE_CHROME,
  GROUP_HEADER,
  GROUP_INSET,
  GROUP_TITLE_CHROME,
  SOFT_LABEL,
  SOFT_PAD,
  contentOrigin,
} from './frame';
import { projectScene } from './project';
import { legendNotes } from './legend-notes';
import {
  DslError,
  FITS,
  layoutParent,
  nearAnchor,
  parseModel,
  POSITION_HINTS,
  type Hint,
  type Model,
  type ModelEdge,
  type ModelLayout,
  type ModelObject,
} from './syntax';

/** The single render context. Browser window size changes the camera, never the layout. */
export const RENDER_CONTEXT = { width: 1100, height: 720 } as const;
export { GROUP_HEADER, GROUP_INSET, contentOrigin };
const MIN_GAP = 12;
/** Swim lanes: the least gap between ranks, between objects stacked in one rank, and between lanes. */
const LANE_RANK_GAP = 56,
  LANE_STACK_GAP = 24,
  LANE_GAP = 0;
/** Depth of a lane with nothing in it. */
const EMPTY_LANE = 56;
/** Size of a group with nothing in it yet; groups with content fit it exactly. */
const EMPTY_GROUP = { w: 260, h: 110 };

export interface SceneObject extends ModelObject {
  /** World (diagram) coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Position relative to the parent's content origin; `pin` and `stay` use these. */
  localX: number;
  localY: number;
  /** Local position from the automatic recipe alone, before refinements; `nudge` offsets this. */
  baseX: number;
  baseY: number;
  depth: number;
  /** Sequence participants: how far the dashed lifeline runs below the box. */
  lifeline?: number;
  /** Soft groups: the tint's rectangles, relative to the group's top left; the first holds the label. */
  hull?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Groups: lines the title wraps to, when more than one. */
  titleLines?: number;
}

export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** Source line of the rule involved, when there is one. */
  line?: number;
  ids: string[];
  /** Where on the drawing a finding about its geometry is, to frame or mark it. */
  box?: Rect;
}

/** A connection as the file declares it, plus the lane a fold's wrap edge returns along. */
export interface SceneEdge extends ModelEdge {
  lane?: Lane;
  /** A sequence message: the height of its row; it is drawn straight between lifelines there. */
  row?: number;
}

export interface Scene {
  model: Model;
  title: string;
  objects: SceneObject[];
  byId: Map<string, SceneObject>;
  edges: SceneEdge[];
  diagnostics: Diagnostic[];
  /** The file's resolved appearance: the spacing and type every size above was computed with. */
  look: ResolvedAppearance;
  /** Rulers and run-on pieces of byte and bit layouts, by group. */
  cells: Map<string, CellsChrome>;
  /** Sequence diagrams: the panel they are drawn on and their phases' row bands. */
  sequence?: SequenceLayout;
}

type Item = ModelObject & { w: number; h: number };
type Size = { w: number; h: number };

/** Space between two boxes: the larger of their gaps across either axis (negative if they overlap). */
const clearance = (a: Size & Pos, b: Size & Pos) =>
  Math.max(b.x - a.x - a.w, a.x - b.x - b.w, b.y - a.y - a.h, a.y - b.y - b.h);
type Pos = { x: number; y: number };

const round = (n: number) => Math.round(n);

export async function compile(source: string): Promise<Scene> {
  const m = parseModel(source),
    root = m.layouts.find(l => l.scope === 'root' && l.fit);
  if (!root?.fit) return compileModel(m);
  // `fit=`: lay the drawing out each way it can read and fold, and keep the one whose shape is
  // closest to the target. The file as written goes first, so it wins a tie.
  const target = FITS[root.fit],
    tried: Array<{ scene: Scene; label: string; off: number }> = [];
  for (const variant of fitVariants(root)) {
    const scene = await compileModel({
      ...m,
      layouts: m.layouts.map(l => (l === root ? { ...l, ...variant.layout } : l)),
    });
    tried.push({ scene, label: variant.label, off: Math.abs(Math.log(aspectOf(scene) / target)) });
  }
  const best = tried.reduce((a, b) => (b.off < a.off - 0.01 ? b : a));
  best.scene.diagnostics.push({
    level: 'info',
    code: 'fit',
    message: `fit=${root.fit} (aspect ${target}): drawn ${best.label}, aspect ${aspectOf(best.scene).toFixed(2)}; ${tried.length} layouts tried.`,
    line: root.line,
    ids: [],
  });
  // A stated direction holds, so fit= can only fold. Say so when that leaves the drawing much
  // wider than the target; taller is fine in a page column.
  if (root.direction !== 'auto' && aspectOf(best.scene) > target * 1.5)
    best.scene.diagnostics.push({
      level: 'warning',
      code: 'fit-direction',
      message: `direction=${root.direction} keeps fit=${root.fit} from turning the drawing, so it stays wide. Remove direction= to let fit= try both directions.`,
      line: root.line,
      ids: [],
    });
  return best.scene;
}

function compileModel(m: Model) {
  const flat = dissolved(m),
    room = widestLabels(flat);
  return engineArrangement(room).then(arranged =>
    withOldOrder(sequenced(withSoftGroups(ownLabels(layoutModel(room, arranged), flat), m))),
  );
}

/**
 * In a comparison, each line's label as the wider of its new and old text. Before draws the old
 * one at the same positions, so the layout holds room for both.
 */
function widestLabels(m: Model): Model {
  if (!m.appearance.compare || !m.edges.some(e => e.was)) return m;
  const look = resolveAppearance(m.appearance),
    wide = (l: string) => (l ? edgeLabelSize(l, look).w : 0);
  return {
    ...m,
    edges: m.edges.map(e => (e.was && wide(e.was) > wide(e.label) ? { ...e, label: e.was } : e)),
  };
}

/** The scene with the file's own labels back after `widestLabels` sized it. */
function ownLabels(scene: Scene, m: Model): Scene {
  if (scene.model.edges === m.edges) return scene;
  const label = new Map(m.edges.map(e => [e.id, e.label]));
  return {
    ...scene,
    model: { ...scene.model, edges: m.edges },
    edges: scene.edges.map(e => ({ ...e, label: label.get(e.id)! })),
  };
}

/** Width over height of a scene's top-level objects. */
function aspectOf(scene: Scene) {
  const top = scene.objects.filter(o => o.parent === 'root');
  return (
    (Math.max(...top.map(o => o.x + o.w)) - Math.min(...top.map(o => o.x))) /
    (Math.max(...top.map(o => o.y + o.h)) - Math.min(...top.map(o => o.y)))
  );
}

/** The ways `fit=` tries a root layout: as written, then each reading direction, folding or not. */
function fitVariants(root: ModelLayout) {
  const reads = (l: Partial<ModelLayout>) =>
    `reading ${l.direction === 'auto' ? 'as the engine picks' : l.direction}`;
  const out: Array<{ label: string; layout: Partial<ModelLayout> }> = [
    { label: `as written (${reads(root)})`, layout: {} },
  ];
  if (['lanes', 'sequence', 'cells'].includes(root.algorithm) && !root.engine) return out;
  // A stated direction holds, so the search has only folding left to try.
  const directions = root.direction === 'auto' ? (['right', 'down'] as const) : [root.direction];
  for (const direction of directions)
    for (const fold of ['auto', 'never'] as const) {
      const layout: Partial<ModelLayout> = root.engine
        ? {
            direction,
            engine: { ...root.engine, params: { ...root.engine.params, fold } },
          }
        : { direction, fold };
      out.push({ label: `${reads({ direction })}${fold === 'never' ? ', unfolded' : ''}`, layout });
    }
  return out;
}

/**
 * Check source synchronously: every error `compile` can report, without running layout engines
 * (they never add errors). Engine-governed scopes keep their built-in recipe in the result.
 */
export function checkSource(source: string): Scene {
  const m = parseModel(source);
  const flat = dissolved(m);
  return withOldOrder(
    sequenced(withSoftGroups(ownLabels(layoutModel(widestLabels(flat)), flat), m)),
  );
}

/**
 * Sequence diagrams: room under the last message, least height of a message row (the first row
 * sits one row under the participants, less `SEQ_LIFT`), and the least gap between participants.
 */
const SEQ_TOP = 24,
  SEQ_LIFT = 0,
  SEQ_ROW = 36,
  SEQ_GAP = 40,
  /** Room beside a message label inside its gap: an arrowhead's worth. */
  SEQ_LABEL_RUN = 16,
  /** Room between a self-message's ink and the next lifeline, or the next message's label. */
  SEQ_SELF_CLEAR = 8,
  /** Room a column band leaves round its participants, and a phase tab round its label. */
  SEQ_BAND_PAD = 16,
  /** Room between the panel's border and what it holds. */
  SEQ_PANEL_PAD = 20,
  /** Room between the drawing and a note in a side margin. */
  SEQ_NOTE_PAD = 8,
  /** Narrowest participant box; a short title no longer takes a full default-width box. */
  SEQ_MIN_W = 104;

/**
 * A participant box only as wide as its title on one line needs (at least `SEQ_MIN_W`), so short
 * names don't each take a full default-width box. A title that already wraps keeps its width.
 */
function participantWidth(o: SceneObject, look: ResolvedAppearance) {
  const text = Math.ceil(measureText(o.label, look.title));
  if (o.label.includes('\n') || titleArea(o.shape, o.w, o.h, look).width < text) return o.w;
  let w = SEQ_MIN_W;
  while (w < o.w && titleArea(o.shape, w, o.h, look).width < text) w += 4;
  return Math.min(w, o.w);
}

/**
 * A sequence diagram: the participants (every node) in a row across the top, in file order or
 * the root `order`, and each connection a message on its own row below them, in file order, so
 * the file reads top to bottom as the exchange does. Participants are spaced so each message's
 * label fits between them, and each draws a lifeline down to the last row.
 */
function sequenced(scene: Scene): Scene {
  if (!scene.model.layouts.some(l => l.scope === 'root' && l.algorithm === 'sequence'))
    return scene;
  const look = scene.look,
    sized = new Set(scene.model.hints.flatMap(h => (h.type === 'size' ? [h.id] : []))),
    nodes = scene.objects.filter(o => o.type === 'node'),
    groups = scene.objects.filter(o => o.type === 'group');
  // Nothing to draw yet: the empty drawing stays until a participant arrives.
  if (!nodes.length) return scene;
  /** The ids in a scope's `order`, then the rest as they came. */
  const inOrder = (scope: string, ids: string[]) => {
    const order = scene.model.hints.find(h => h.type === 'order' && h.scope === scope),
      listed = order?.type === 'order' ? order.ids : [];
    return [...listed, ...ids.filter(id => !listed.includes(id))];
  };
  // Lanes: the root's slots, each a participant or a group where its first participant falls, so
  // a group is one band. The root `order` places the slots, and a group's `order` its members.
  const slots = [...new Set(nodes.map(o => (o.parent === 'root' ? o.id : o.parent)))],
    ordered = inOrder('root', slots).flatMap(slot =>
      scene.byId.get(slot)!.type === 'node'
        ? [slot]
        : inOrder(
            slot,
            nodes.filter(o => o.parent === slot).map(o => o.id),
          ),
    );
  const parts = ordered
      .map(id => scene.byId.get(id)!)
      .map(o => (sized.has(o.id) ? o : { ...o, w: participantWidth(o, look) })),
    at = new Map(parts.map((o, i) => [o.id, i]));
  // Phases: a tab on the left holds each label, so the drawing starts past the widest.
  const tab = scene.model.phases.length
      ? Math.max(...scene.model.phases.map(p => measureText(p.label, look.annotation))) +
        2 * SEQ_BAND_PAD
      : 0,
    top = groups.length ? look.groupHeader : 0;
  // Lanes stand across a band's edge from each other with room for both bands' padding.
  const across = (i: number) => parts[i - 1].parent !== parts[i].parent;
  // The labels a message makes room for. Before draws an older one on the same lanes and rows, so
  // a comparison holds both.
  const compared = !!scene.model.appearance.compare,
    labelsOf = (e: SceneEdge) => [e.label, compared ? e.was : ''].filter((l): l is string => !!l),
    labelBox = (e: SceneEdge) => {
      const sizes = labelsOf(e).map(l => edgeLabelSize(l, look, true));
      return { w: Math.max(0, ...sizes.map(s => s.w)), h: Math.max(0, ...sizes.map(s => s.h)) };
    },
    selfInk = (e: SceneEdge) => {
      const inks = labelsOf(e).map(l => selfMessageInk(l, look));
      return inks.length
        ? {
            right: Math.max(...inks.map(i => i.right)),
            above: Math.max(...inks.map(i => i.above)),
            below: Math.max(...inks.map(i => i.below)),
          }
        : selfMessageInk(undefined, look);
    };
  // What holds each lane away from an earlier one, by the lane it ends on: a message's label fits
  // between its two lifelines, and a self-message's ink clears the next lifeline or band.
  const reach = new Map<string, number>(),
    holds: Array<Array<{ from: number; room: number }>> = parts.map(() => []);
  for (const e of scene.edges) {
    const [a, b] = [at.get(e.source)!, at.get(e.target)!].sort((p, q) => p - q);
    if (a < b) {
      const { w } = labelBox(e);
      if (w) holds[b].push({ from: a, room: w + SEQ_LABEL_RUN });
      continue;
    }
    const { right } = selfInk(e);
    reach.set(e.source, Math.max(reach.get(e.source) ?? 0, right));
    if (a + 1 < parts.length)
      holds[a + 1].push({
        from: a,
        room: right + SEQ_SELF_CLEAR + (across(a + 1) ? 2 * SEQ_BAND_PAD + parts[a + 1].w / 2 : 0),
      });
  }
  // Centres: each lane takes the header gap from its neighbour, or what holds it, if that is more.
  const centre: number[] = [];
  parts.forEach((o, i) => {
    if (!i) return void centre.push(tab + SEQ_BAND_PAD + o.w / 2);
    const gap = parts[i - 1].w / 2 + SEQ_GAP + (across(i) ? 2 * SEQ_BAND_PAD : 0) + o.w / 2;
    centre.push(Math.max(centre[i - 1] + gap, ...holds[i].map(h => centre[h.from] + h.room)));
  });
  let y = top + Math.max(0, ...parts.map(o => o.h)) - SEQ_LIFT,
    /** The bottom of a self-message's ink, which the row after it must clear. */
    ink = 0;
  const rows = new Map<string, number>(),
    spans = new Map<string, { from: number; to: number }>();
  for (const e of scene.edges) {
    // The label sits above its line, so a row is the label's height and a little air.
    const label = labelBox(e).h,
      self = e.source === e.target ? selfInk(e) : undefined,
      above = self ? self.above : label && label + 1;
    y = Math.ceil(
      Math.max(y + Math.max(SEQ_ROW, label ? label + 8 : 0), ink + SEQ_SELF_CLEAR + above),
    );
    rows.set(e.id, y);
    ink = self ? y + self.below : 0;
    spans.set(e.id, { from: y - Math.max(label, SEQ_ROW / 2) - 4, to: Math.max(y, ink) + 8 });
    if (self) y += SELF_LOOP.down;
  }
  const end = Math.max(y, ink) + SEQ_TOP;
  const placed = new Map(
    parts.map(o => {
      const x = round(centre[at.get(o.id)!] - o.w / 2);
      return [o.id, { x, w: o.w }] as const;
    }),
  );
  /** The right edge of a participant, or of a self-message drawn past it. */
  const inkRight = (o: SceneObject) =>
    Math.max(placed.get(o.id)!.x + o.w, centre[at.get(o.id)!] + (reach.get(o.id) ?? 0));
  const objects = scene.objects.map(o => {
    if (o.type === 'group') {
      // A group is a column band behind its participants' lifelines, its title above them.
      const members = parts.filter(p => p.parent === o.id),
        x = round(Math.min(...members.map(p => placed.get(p.id)!.x)) - SEQ_BAND_PAD),
        w = round(Math.max(...members.map(p => inkRight(p))) + SEQ_BAND_PAD - x);
      // Paler than a group's usual tint, so the bands stay quieter than the headers' accents.
      return {
        ...o,
        shade: o.shade ?? 50,
        x,
        y: 0,
        w,
        h: end + SEQ_BAND_PAD,
        localX: x,
        localY: 0,
        baseX: x,
        baseY: 0,
      };
    }
    const { x, w } = placed.get(o.id)!;
    return {
      ...o,
      w,
      x,
      y: top,
      localX: x,
      localY: top,
      baseX: x,
      baseY: top,
      lifeline: end - top - o.h,
    };
  });
  const left = Math.min(0, ...objects.map(o => o.x)) - (tab ? 0 : SEQ_BAND_PAD),
    right = Math.max(
      ...objects.map(o => o.x + o.w + SEQ_BAND_PAD),
      ...parts.map(o => centre[at.get(o.id)!] + (reach.get(o.id) ?? 0)),
    ),
    panel = {
      x: left - SEQ_PANEL_PAD,
      y: -SEQ_PANEL_PAD,
      w: right - left + 2 * SEQ_PANEL_PAD,
      h: end + SEQ_BAND_PAD + 2 * SEQ_PANEL_PAD,
    };
  // Notes on messages take the margins past the outer lanes. The panel grows round them and
  // nothing inside it moves. A left note also stays clear of the phase labels.
  const notes = scene.model.appearance.notes ?? [],
    anchors = new Map([...rows].filter(([id]) => !scene.byId.has(id))),
    margins = marginNotes(look, notes, anchors, {
      left: left - (tab ? SEQ_PANEL_PAD : SEQ_NOTE_PAD),
      right: right + SEQ_NOTE_PAD,
      top: 0,
    }),
    drawn = margins.filter(r => r !== null),
    framed = drawn.length ? rectUnion([panel, rectUnion(drawn, SEQ_PANEL_PAD)]) : panel,
    phaseX = framed.x < panel.x ? panel.x : undefined;
  // Phases top to bottom, so tinting alternates down the drawing, each ending where the next begins.
  const runs = scene.model.phases
    .map(p => {
      const ofPhase = p.ids.map(id => spans.get(id)!);
      return {
        id: p.id,
        label: p.label,
        from: round(Math.min(...ofPhase.map(r => r.from))),
        to: round(Math.max(...ofPhase.map(r => r.to))),
      };
    })
    .sort((a, b) => a.from - b.from);
  const phases = runs.map(({ id, label, from, to }, i) => ({
    id,
    label,
    y: from,
    h: Math.min(to, runs[i + 1]?.from ?? to) - from,
  }));
  return {
    ...scene,
    objects,
    byId: new Map(objects.map(o => [o.id, o])),
    edges: scene.edges.map(e => ({ ...e, lane: undefined, row: rows.get(e.id) })),
    sequence: {
      panel: framed,
      phases,
      ...(phaseX !== undefined ? { phaseX } : {}),
      ...(drawn.length ? { notes: margins, inner: panel } : {}),
    },
  };
}

/**
 * With `was-order`: the rows and phase bands of the older message order, for the older panel. The
 * listed messages take each other's places, and the same run of `sequenced` keeps one rule for
 * rows and bands. Neighbours set a row's height, so `grow` is how much longer that order draws.
 */
function withOldOrder(scene: Scene): Scene {
  const listed = scene.model.wasOrder?.ids.flatMap(id => scene.edges.filter(e => e.id === id));
  if (!listed || !scene.sequence) return scene;
  const rest = [...listed],
    old = sequenced({
      ...scene,
      edges: scene.edges.map(e => (listed.includes(e) ? rest.shift()! : e)),
    }),
    lifeline = (s: Scene) => s.objects.find(o => o.type === 'node')?.lifeline ?? 0;
  return {
    ...scene,
    sequence: {
      ...scene.sequence,
      before: {
        rows: Object.fromEntries(old.edges.map(e => [e.id, e.row!])),
        phases: old.sequence!.phases,
        grow: Math.max(0, lifeline(old) - lifeline(scene)),
      },
    },
  };
}

/**
 * The model layout sees: soft and frameless groups removed, and their members handed to the
 * nearest framed container, so each member ranks with its own connections.
 */
function dissolved(m: Model): Model {
  if (!m.objects.some(o => o.frame)) return m;
  const by = new Map(m.objects.map(o => [o.id, o]));
  const chain = (id: string) => {
    const out: string[] = [];
    for (let p = by.get(id)!.parent; p !== 'root' && by.get(p)!.frame; p = by.get(p)!.parent)
      out.unshift(p);
    return out;
  };
  return {
    ...m,
    objects: m.objects
      .filter(o => !o.frame)
      .map(o => ({ ...o, parent: layoutParent(by, o.id), soft: chain(o.id) })),
  };
}

/**
 * A rank with the members of each soft group side by side, outermost group first: a group's
 * members take the place of their mean position in the rank, and everything else keeps its order.
 */
function clustered(
  layer: string[],
  chainOf: (id: string) => string[] | undefined,
  depth = 0,
): string[] {
  if (!layer.some(id => chainOf(id)?.[depth])) return layer;
  const blocks = new Map<string, { at: number; ids: string[] }>();
  layer.forEach((id, i) => {
    const key = chainOf(id)?.[depth] ?? `\0${id}`,
      block = blocks.get(key) ?? { at: 0, ids: [] };
    block.at += i;
    block.ids.push(id);
    blocks.set(key, block);
  });
  return [...blocks]
    .sort(([, a], [, b]) => a.at / a.ids.length - b.at / b.ids.length)
    .flatMap(([key, b]) => (key.startsWith('\0') ? b.ids : clustered(b.ids, chainOf, depth + 1)));
}

/**
 * The scene as layout sees it, for edits that write positions: soft and frameless groups left
 * out, and each object under the container that lays it out, which its local position is
 * relative to.
 */
export function layoutView(scene: Scene): Scene {
  if (!scene.objects.some(o => o.frame)) return scene;
  const by = new Map(scene.model.objects.map(o => [o.id, o])),
    objects = scene.objects
      .filter(o => !o.frame)
      .map(o => ({ ...o, parent: layoutParent(by, o.id) }));
  return { ...scene, objects, byId: new Map(objects.map(o => [o.id, o])) };
}

/** Space kept between two soft tints, or a tint and a box, that would otherwise touch. */
const SOFT_GAP = 8;

/**
 * Room two neighbouring boxes need between them for the soft tints round them: a pad for each
 * tint that ends or starts between them, and the label of each that starts after a gap below.
 */
function softRoom(a: string[] = [], b: string[] = [], below: boolean) {
  const leaving = a.filter(g => !b.includes(g)).length,
    entering = b.filter(g => !a.includes(g)).length;
  if (!leaving && !entering) return 0;
  return (leaving + entering) * SOFT_PAD + (below && entering ? SOFT_LABEL : 0) + SOFT_GAP;
}

/** Room between two ranks for the tints that end in one or start in the other. */
function rankRoom(
  from: string[],
  to: string[],
  chainOf: (id: string) => string[] | undefined,
  below: boolean,
) {
  const inFrom = new Set(from.flatMap(id => chainOf(id) ?? [])),
    across = (id: string, other: Set<string>) => (chainOf(id) ?? []).filter(g => !other.has(g));
  const inTo = new Set(to.flatMap(id => chainOf(id) ?? []));
  let room = 0;
  for (const a of from)
    for (const b of to) room = Math.max(room, softRoom(across(a, inTo), across(b, inFrom), below));
  return room;
}

type Box = { x: number; y: number; w: number; h: number };
const hits = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const padded = (o: Box, p: number): Box => ({
  x: o.x - p,
  y: o.y - p,
  w: o.w + 2 * p,
  h: o.h + 2 * p,
});

/**
 * The rectangle that joins two boxes: the strip across the gap where they face each other, or,
 * when they sit diagonally, the box round both.
 */
function bridge(a: Box, b: Box): Box {
  const x0 = Math.max(a.x, b.x),
    x1 = Math.min(a.x + a.w, b.x + b.w),
    y0 = Math.max(a.y, b.y),
    y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 > x0) {
    const top = Math.min(a.y + a.h, b.y + b.h);
    return { x: x0, y: top, w: x1 - x0, h: Math.max(a.y, b.y) - top };
  }
  if (y1 > y0) {
    const left = Math.min(a.x + a.w, b.x + b.w);
    return { x: left, y: y0, w: Math.max(a.x, b.x) - left, h: y1 - y0 };
  }
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * Put soft and frameless groups back into a scene laid out without them. Members keep their
 * place and get their declared parent back. A soft group's tint is the members' boxes, padded,
 * joined along a shortest tree by bridges that cover nothing else, with room for the label above
 * its top member; innermost groups first, so an outer tint wraps an inner one. A tint that still
 * covers another object, or that could not join all its members, is noted.
 */
function withSoftGroups(scene: Scene, m: Model): Scene {
  const soft = m.objects.filter(o => o.frame);
  if (!soft.length) return scene;
  const by = new Map(m.objects.map(o => [o.id, o])),
    placed = new Map<string, SceneObject>(
      scene.objects.map(o => [o.id, { ...o, parent: by.get(o.id)!.parent, soft: undefined }]),
    ),
    diagnostics = [...scene.diagnostics];
  const within = (id: string, group: string) => {
    for (let p = by.get(id)?.parent; p && p !== 'root'; p = by.get(p)?.parent)
      if (p === group) return true;
    return false;
  };
  const depthOf = (id: string) => {
    let d = 0;
    for (let p = by.get(id)!.parent; p !== 'root'; p = by.get(p)!.parent) d++;
    return d;
  };
  /** What a member adds to a tint: its box, or an inner soft group's whole tint. */
  const parts = (o: SceneObject): Box[] =>
    o.frame === 'soft'
      ? (o.hull ?? []).map(r => ({ ...r, x: r.x + o.x, y: r.y + o.y }))
      : o.frame
        ? []
        : [o];
  for (const g of [...soft].sort((a, b) => depthOf(b.id) - depthOf(a.id))) {
    const members = [...placed.values()].filter(o => within(o.id, g.id)),
      frame = placed.get(layoutParent(by, g.id)),
      origin = frame
        ? contentOrigin(frame, groupHeaderFor(scene.look, frame.titleLines))
        : { x: 0, y: 0 },
      others = [...placed.values()].filter(
        o => !o.frame && !within(o.id, g.id) && !within(g.id, o.id),
      );
    const boxes = members.flatMap(o => parts(o).map(b => padded(b, SOFT_PAD)));
    let rects: Box[] = [],
      split = 0;
    if (boxes.length) {
      // The label sits above the top member (the leftmost of a row).
      const top = boxes.reduce((t, b) => (b.y < t.y || (b.y === t.y && b.x < t.x) ? b : t));
      top.y -= SOFT_LABEL;
      top.h += SOFT_LABEL;
      rects = [top, ...boxes.filter(b => b !== top)];
      const x = Math.min(...rects.map(r => r.x)),
        y = Math.min(...rects.map(r => r.y)),
        whole = {
          x,
          y,
          w: Math.max(...rects.map(r => r.x + r.w)) - x,
          h: Math.max(...rects.map(r => r.y + r.h)) - y,
        };
      // One rectangle round them all when it covers nothing else; otherwise the boxes themselves,
      // joined along a shortest tree (Prim) by gap between them.
      if (!others.some(o => hits(o, whole))) rects = [whole];
      const gapOf = (a: Box, b: Box) =>
        Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
      const joined = [rects[0]],
        rest = rects.slice(1),
        bridges: Box[] = [];
      while (rest.length) {
        let best = { gap: Infinity, a: rects[0], i: 0 };
        for (const a of joined)
          rest.forEach((b, i) => {
            const d = gapOf(a, b);
            if (d < best.gap) best = { gap: d, a, i };
          });
        const [b] = rest.splice(best.i, 1);
        joined.push(b);
        if (hits(best.a, b)) continue;
        const r = bridge(best.a, b);
        if (others.some(o => hits(o, r))) split++;
        else bridges.push(r);
      }
      rects.push(...bridges);
    }
    const x0 = rects.length ? Math.min(...rects.map(r => r.x)) : origin.x,
      y0 = rects.length ? Math.min(...rects.map(r => r.y)) : origin.y,
      x1 = rects.length ? Math.max(...rects.map(r => r.x + r.w)) : origin.x,
      y1 = rects.length ? Math.max(...rects.map(r => r.y + r.h)) : origin.y,
      local = { x: x0 - origin.x, y: y0 - origin.y };
    placed.set(g.id, {
      ...g,
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      localX: local.x,
      localY: local.y,
      baseX: local.x,
      baseY: local.y,
      depth: depthOf(g.id),
      hull: rects.map(r => ({ x: r.x - x0, y: r.y - y0, w: r.w, h: r.h })),
    });
    if (g.frame !== 'soft') continue;
    const covered = others.filter(o => rects.some(r => hits(o, r)));
    if (covered.length)
      diagnostics.push({
        level: 'warning',
        code: 'soft-overlap',
        message: `${g.id}'s tint covers ${covered.map(o => o.id).join(', ')}, which ${covered.length > 1 ? 'are' : 'is'} not in it. Place its members together, or use frame=box.`,
        line: g.line,
        ids: [g.id, ...covered.map(o => o.id)],
      });
    if (split)
      diagnostics.push({
        level: 'info',
        code: 'soft-split',
        message: `${g.id}'s members are apart, so its tint is drawn in ${split + 1} pieces. Place its members together, or use frame=box.`,
        line: g.line,
        ids: [g.id],
      });
  }
  const index = new Map(m.objects.map((o, i) => [o.id, i])),
    objects = [...placed.values()].sort((a, b) => index.get(a.id)! - index.get(b.id)!);
  return { ...scene, model: m, objects, byId: new Map(objects.map(o => [o.id, o])), diagnostics };
}

/** More accent families than this reads as decoration rather than meaning. */
const MANY_FAMILIES = 4;
const NEUTRALS = new Set(['slate', 'stone']);

/**
 * Color advice for agents: many families with nothing to say what they mean, or a member drawn
 * in its own container's family (drawing steps the shade apart, but the color then says nothing).
 */
function paletteNotes(m: Model): Diagnostic[] {
  const notes: Diagnostic[] = [];
  const named = m.objects.filter(o => o.color !== 'auto');
  // Neutrals frame things; only accent families compete for meaning.
  const families = [...new Set(named.map(o => o.color))].filter(f => !NEUTRALS.has(f));
  if (families.length > MANY_FAMILIES)
    notes.push({
      level: 'info',
      code: 'many-colors',
      message: `${families.length} accent colors (${families.join(', ')}). Use two to four, each for one role, with slate or stone for the rest, and say what each one means with legend lines.`,
      line: named.find(o => o.color === families[MANY_FAMILIES])?.line,
      ids: named.filter(o => families.includes(o.color)).map(o => o.id),
    });
  const byId = new Map(m.objects.map(o => [o.id, o]));
  const same = named.filter(o => byId.get(o.parent)?.color === o.color);
  if (same.length)
    notes.push({
      level: 'info',
      code: 'color-matches-container',
      message: `${same.map(o => o.id).join(', ')} ${same.length > 1 ? 'repeat their containers’ colors' : 'repeats its container’s color'}. Drop the color to inherit it, or give the member a family of its own.`,
      line: same[0].line,
      ids: same.map(o => o.id),
    });
  return notes;
}

/** The reading direction a scope's layout asks for, resolved against the render context. */
function axisOf(layout: ModelLayout): 'right' | 'down' {
  if (layout.direction !== 'auto') return layout.direction;
  const { width, height } = RENDER_CONTEXT;
  return width >= 700 && width / height > 1.12 ? 'right' : 'down';
}

/** The explicit layout line that arranges a scope: its own, or the nearest engine above it. */
function governingLayout(m: Model, scope: string): ModelLayout | undefined {
  const parent = new Map(m.objects.map(o => [o.id, o.parent]));
  for (let s: string | undefined = scope; s; s = s === 'root' ? undefined : parent.get(s)) {
    const l = m.layouts.find(x => x.scope === s);
    if (l) return s === scope || l.engine ? l : undefined;
  }
  return undefined;
}

/**
 * World positions from the layout engines named in the file, outermost scope first. The engines
 * start from the built-in recipes with sizes but no position refinements.
 */
async function engineArrangement(m: Model): Promise<Map<string, Pos & Size> | undefined> {
  const engines = m.layouts.filter(l => l.engine);
  if (!engines.length) return undefined;
  const depth = (scope: string) => {
    let d = 0;
    for (
      let o = m.objects.find(x => x.id === scope);
      o;
      o = m.objects.find(x => x.id === o!.parent)
    )
      d++;
    return d;
  };
  engines.sort((a, b) => depth(a.scope) - depth(b.scope));
  // The engines arrange slots (see `layoutModel`), so a theme switch hands them the same boxes.
  const plain = layoutModel(
    {
      ...m,
      hints: m.hints.filter(h => h.type === 'size' || h.type === 'order'),
    },
    undefined,
    true,
  );
  // The engines break ties by id, so a renamed node could land somewhere else. They see ids that
  // sort in authored order instead: file order, with each scope's `order` line applied. Ids are
  // names; only the file steers layout.
  const alias = new Map(authoredOrder(m).map((id, i) => [id, `o${String(i).padStart(6, '0')}`])),
    original = new Map([...alias].map(([id, a]) => [a, id]));
  const loose = new Set(m.edges.filter(e => e.constraint === false).map(e => e.id));
  let doc = renamed(projectScene(plain), alias);
  // `constraint=false` edges are drawn, but the engines neither rank nor pull by them.
  doc = { ...doc, graph: { ...doc.graph, edges: doc.graph.edges.filter(e => !loose.has(e.id)) } };
  for (const l of engines) {
    const settings = LayoutLab.settings({
      ...doc.settings,
      algorithm: l.engine!.algorithm,
      direction: (axisOf(l) === 'right' ? 'RIGHT' : 'DOWN') as Direction,
      ...l.engine!.params,
      ...(l.engine!.params.rootId ? { rootId: alias.get(l.engine!.params.rootId) } : {}),
      // The compiler sizes groups to their content afterwards, so frames never constrain it.
      growContainers: true,
    });
    const result = await LayoutLab.compute(doc, {
      ...settings,
      mode: 'rebuild',
      warmStart: false,
      settle: true,
      maxIterations: ENGINE_ITERATIONS,
      scope: l.scope === 'root' ? 'all' : 'container',
      ...(l.scope === 'root' ? {} : { containerId: alias.get(l.scope) }),
      viewport: { w: RENDER_CONTEXT.width, h: RENDER_CONTEXT.height },
    });
    doc = result.document;
  }
  return new Map(
    Object.entries(doc.layout.nodes).map(([id, r]) => [
      original.get(id) ?? id,
      { x: r.x, y: r.y, w: r.w, h: r.h },
    ]),
  );
}

/** Object ids in file order, each scope's children reordered by its `order` line. */
function authoredOrder(m: Model): string[] {
  const out: string[] = [];
  const visit = (scope: string) => {
    let kids = m.objects.filter(o => o.parent === scope);
    const order = m.hints.find(h => h.type === 'order' && h.scope === scope);
    if (order?.type === 'order')
      kids = [
        ...order.ids.flatMap(id => kids.filter(k => k.id === id)),
        ...kids.filter(k => !order.ids.includes(k.id)),
      ];
    for (const k of kids) {
      out.push(k.id);
      visit(k.id);
    }
  };
  visit('root');
  // Anything the walk missed keeps its file position after the rest.
  return [...out, ...m.objects.map(o => o.id).filter(id => !out.includes(id))];
}

/**
 * A copy of `doc` with object ids replaced by their aliases, and nodes listed in alias order (the
 * engines read list position as declaration order).
 */
function renamed(doc: Diagram, alias: Map<string, string>): Diagram {
  const id = (k: string) => alias.get(k) ?? k,
    keys = <T>(r: Record<string, T>) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [id(k), v]));
  const parent = <T extends { parentId?: string }>(o: T) =>
    o.parentId === undefined ? o : { ...o, parentId: id(o.parentId) };
  return {
    ...doc,
    graph: {
      nodes: doc.graph.nodes
        .map(n => parent({ ...n, id: id(n.id) }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      groups: doc.graph.groups.map(g => parent({ ...g, id: id(g.id) })),
      edges: doc.graph.edges.map(e => ({ ...e, from: id(e.from), to: id(e.to) })),
    },
    layout: {
      ...doc.layout,
      nodes: keys(doc.layout.nodes),
      containers: keys(doc.layout.containers),
      intent: Object.fromEntries(
        Object.entries(doc.layout.intent).map(([role, hint]) => [
          role,
          hint && { ...hint, id: id(hint.id) },
        ]),
      ),
    },
    styles: keys(doc.styles),
    collapsed: doc.collapsed.map(id),
    settings: { ...doc.settings, rootId: doc.settings.rootId && id(doc.settings.rootId) },
  };
}

/** Narrowest frame a wrapped group title sets; a narrower group's title wraps to this width. */
const GROUP_TITLE_WIDTH = 240;

/**
 * Width a group's title asks of a frame whose content needs `inner`, and its line count. A title
 * that fits on one line beside the content keeps one line; a longer one wraps to the content
 * width (at least `GROUP_TITLE_WIDTH`), and the frame widens only as far as it takes to keep the
 * title to `GROUP_TITLE_LINES` lines. The header grows a line for each extra line instead.
 */
function titleFit(title: string, inner: number, look: ResolvedAppearance) {
  const full = Math.ceil(measureText(title, look.groupTitle)) + GROUP_TITLE_CHROME;
  let w = Math.max(inner, GROUP_TITLE_WIDTH);
  if (full <= w) return { w: full, lines: 1 };
  const lines = () => wrapLines(title, w - GROUP_TITLE_CHROME, look.groupTitle, true).length;
  while (lines() > GROUP_TITLE_LINES && w < full) w += 8;
  return { w: Math.min(w, full), lines: Math.min(lines(), GROUP_TITLE_LINES) };
}

/** How far a soft refinement may give way before `check` warns that it no longer holds. */
export const RELAXED_WARNING = 16;

/** A group folds when its chain runs this many times as long as the next longest column. */
const TALL_GROUP = 1.5;

/** Solver budget for engine recipes; the same budget Compare and the timeline use. */
export const ENGINE_ITERATIONS = 640;

/** Line left showing on each side of an edge label, so the label reads as part of its edge. */
const LABEL_RUN = 14;

/** A labelled edge between two siblings, with the room its label needs across and down a gap. */
interface LabelRoom {
  a: string;
  b: string;
  w: number;
  h: number;
}

function labelRoom(a: string, b: string, label: string, look: ResolvedAppearance): LabelRoom {
  const size = edgeLabelSize(label, look);
  return { a, b, w: size.w + 2 * LABEL_RUN, h: size.h + 2 * LABEL_RUN };
}

/** Gap between two siblings: `gap`, or more when a labelled edge between them needs it. */
function roomBetween(rooms: LabelRoom[], a: string, b: string, gap: number, across: boolean) {
  let room = gap;
  for (const r of rooms)
    if ((r.a === a && r.b === b) || (r.a === b && r.b === a))
      room = Math.max(room, across ? r.w : r.h);
  return room;
}

export function layoutFor(m: Model, scope: string): ModelLayout {
  return (
    m.layouts.find(l => l.scope === scope) ?? {
      scope,
      algorithm: scope === 'root' ? 'flow' : 'column',
      direction: 'auto',
      fold: 'auto',
      gap: scope === 'root' ? 48 : 24,
      minWidth: 0,
      minHeight: 0,
      line: 0,
    }
  );
}

/** A default-sized node grows at most this much wider so its longest word piece fits whole. */
const MAX_GROW = 2;

/**
 * Width of a node with no requested size: the shape's default, or wider (in 4px steps, up to
 * `MAX_GROW` times) when a word piece of its title would otherwise break by character, as
 * `Maintenanceverificationreport` or `installed?` in a diamond would. A title with explicit
 * breaks also grows the box until each of its lines fits on one row; a line too long for that
 * rewraps in balanced lines.
 */
function fitWidth(o: ModelObject, base: { w: number; h: number }, look: ResolvedAppearance) {
  const rows = o.label.includes('\n') && o.shape !== 'circle' ? o.label.split('\n') : [],
    need = Math.max(widestPiece(o.label, look.title), ...rows.map(l => measureText(l, look.title)));
  let w = base.w;
  while (titleArea(o.shape, w, base.h, look).width < need && w < base.w * MAX_GROW) w += 4;
  return Math.min(w, base.w * MAX_GROW);
}

/**
 * Size of a node: its requested size, or the default width with a height that fits the title in
 * the theme's type and padding. A requested size is kept exactly; `overflow` reports a title that
 * no longer fits in it. With `height=auto`, a `min-height` is a floor under the title's height.
 */
export function leafSize(
  o: ModelObject,
  size: { width: number; height?: number; minHeight?: number } | undefined,
  look: ResolvedAppearance,
) {
  const base = defaultShapeSize(o.shape);
  if (o.shape === 'diamond') return diamondSize(o, size, base, look);
  const w = size?.width ?? fitWidth(o, base, look);
  const area = titleArea(o.shape, w, size?.height ?? base.h, look),
    lines = wrapTitle(o.label, area.width, look).length;
  if (size?.height !== undefined)
    return { w, h: size.height, overflow: lines * look.title.lineHeight > area.maxHeight + 0.5 };
  return {
    w,
    h: Math.max(
      titleHeight(o.shape, lines, o.shape === 'circle' ? base.h : 0, look),
      size?.minHeight ?? 0,
    ),
    overflow: false,
  };
}

/**
 * A diamond is square. A requested size keeps its larger side; otherwise the default side grows
 * in 4px steps until the title, wrapped to the wider measure the larger square gives, fits.
 */
function diamondSize(
  o: ModelObject,
  size: { width: number; height?: number } | undefined,
  base: { w: number; h: number },
  look: ResolvedAppearance,
) {
  const need = widestPiece(o.label, look.title),
    fits = (s: number) => (diamondMeasure(o.label, s, look) ?? 0) >= need;
  if (size) {
    const s = Math.max(size.width, size.height ?? 0);
    return { w: s, h: s, overflow: !fits(s) };
  }
  let s = base.w;
  while (!fits(s)) s += 4;
  return { w: s, h: s, overflow: false };
}

/** A diamond grown past this many times its default side reads as much larger than its neighbours. */
const BIG_DIAMOND = 1.4;

/**
 * Longest-path ranks, in declaration order. Cycles are broken first: a depth-first walk from the
 * sources (then any node not yet reached), in declaration order, sets aside each edge that returns
 * to a node still on the walk. A loop therefore keeps its path along the reading direction and
 * only its return edge runs backwards.
 */
export function rankLayers(ids: string[], pairs: Array<[string, string]>): string[][] {
  const adj = new Map(ids.map(id => [id, [] as string[]]));
  for (const [a, b] of pairs)
    if (a !== b && adj.has(a) && adj.has(b) && !adj.get(a)!.includes(b)) adj.get(a)!.push(b);
  const targets = new Set([...adj.values()].flat()),
    state = new Map<string, 'open' | 'done'>(),
    back = new Set<string>();
  const visit = (v: string) => {
    state.set(v, 'open');
    for (const w of adj.get(v)!)
      if (state.get(w) === 'open') back.add(v + '\0' + w);
      else if (!state.has(w)) visit(w);
    state.set(v, 'done');
  };
  for (const id of [...ids.filter(id => !targets.has(id)), ...ids]) if (!state.has(id)) visit(id);
  const indegree = new Map(ids.map(id => [id, 0])),
    rank = new Map(ids.map(id => [id, 0]));
  const forward = (v: string) => adj.get(v)!.filter(w => !back.has(v + '\0' + w));
  for (const id of ids) for (const w of forward(id)) indegree.set(w, indegree.get(w)! + 1);
  const queue = ids.filter(id => !indegree.get(id));
  while (queue.length) {
    const a = queue.shift()!;
    for (const b of forward(a)) {
      rank.set(b, Math.max(rank.get(b)!, rank.get(a)! + 1));
      indegree.set(b, indegree.get(b)! - 1);
      if (!indegree.get(b)) queue.push(b);
    }
  }
  const layers: string[][] = [];
  for (const id of ids) (layers[rank.get(id)!] ||= []).push(id);
  return layers.filter(Boolean);
}

/** A long run folds once it is this many times longer than it is deep. */
const FOLD_ASPECT = 3;
/**
 * A packed scope (a drawing or group holding groups, under a packing engine) wraps its run into
 * rows once it is this many times longer than it is deep, like a line of text: groups are wide
 * words, so the cap is looser than a plain run's.
 */
const PACKED_FOLD_ASPECT = 5;
/** How far past fitting a relabelled fold may grow before it takes another band. */
const HOLD_SLACK = 1.25;

/** Space between the lanes that a fold's wrap edges return along. */
const LANE_PITCH = 20;

/** What a cut costs, in crossing edges, for each decision or loop it splits. */
const SPLIT_DECISION = 3,
  SPLIT_LOOP = 2;
/** What a cut costs, in crossing edges, for each band's length its new edges run back. */
const WRAP_WEIGHT = 1;

/** A folded run: each band's ids in reading order, and the axis the bands read along. */
export interface Fold {
  bands: string[][];
  axis: 'right' | 'down';
}

/** Sets of two or more ids that reach one another: the loops a fold should not split. */
function loops(ids: string[], pairs: Array<[string, string]>): string[][] {
  const adj = new Map(ids.map(id => [id, [] as string[]]));
  for (const [a, b] of pairs) adj.get(a)?.push(b);
  const reach = (from: string) => {
    const seen = new Set([from]),
      queue = [from];
    while (queue.length)
      for (const w of adj.get(queue.shift()!) ?? [])
        if (!seen.has(w)) {
          seen.add(w);
          queue.push(w);
        }
    return seen;
  };
  const reaches = new Map(ids.map(id => [id, reach(id)])),
    out: string[][] = [],
    taken = new Set<string>();
  for (const id of ids) {
    if (taken.has(id)) continue;
    const loop = ids.filter(o => reaches.get(id)!.has(o) && reaches.get(o)!.has(id));
    loop.forEach(o => taken.add(o));
    if (loop.length > 1) out.push(loop);
  }
  return out;
}

/**
 * Fold a long run of ranks into bands, like lines of text: each band starts again at the
 * beginning of the reading direction, and the bands stack across it. A run that is longer than
 * the render context and more than `FOLD_ASPECT` times its depth is cut only between ranks (where
 * no box spans the cut), into the fewest bands that bring it within both. Within a quarter of an
 * even share, a cut is chosen for the fewest edges across it, keeping each decision with its
 * branches and each loop whole, before an exact balance. Other runs are returned unchanged.
 *
 * `plan` is the same run laid out without its edge labels. Whether to fold, how many bands and
 * where to cut are decided on it, so relabelling an edge never adds a band or moves a cut: the
 * labels only widen the gaps they need inside their own band.
 */
export function foldRanks(
  items: Array<{ id: string; w: number; h: number }>,
  positions: Map<string, Pos>,
  axis: 'right' | 'down',
  gap: number,
  pairs: Array<[string, string]>,
  rooms: LabelRoom[] = [],
  decisions: Set<string> = new Set(),
  plan: Map<string, Pos> = positions,
  {
    aspect = FOLD_ASPECT,
    fewest = 4,
    room = axis === 'right' ? RENDER_CONTEXT.width : RENDER_CONTEXT.height,
  }: { aspect?: number; fewest?: number; room?: number } = {},
): { positions: Map<string, Pos>; fold?: Fold } {
  const byId = new Map(items.map(n => [n.id, n]));
  const along = axis === 'right' ? 'x' : 'y',
    across = axis === 'right' ? 'y' : 'x';
  const size = (n: { w: number; h: number }, a: 'x' | 'y') => (a === 'x' ? n.w : n.h);
  // Blocks of ranks that overlap along the reading direction; bands are cut only between blocks.
  const blocksOf = (at: Map<string, Pos>) => {
    const sorted = [...items].sort((a, b) => at.get(a.id)![along] - at.get(b.id)![along]);
    const out: Array<{ start: number; end: number; ids: string[] }> = [];
    for (const n of sorted) {
      const start = at.get(n.id)![along],
        end = start + size(n, along),
        last = out[out.length - 1];
      if (last && start < last.end) {
        last.end = Math.max(last.end, end);
        last.ids.push(n.id);
      } else out.push({ start, end, ids: [n.id] });
    }
    return out;
  };
  const blocks = blocksOf(positions);
  let planned = blocksOf(plan);
  // Label room only widens gaps between ranks, so both have the same blocks; if not, plan on the
  // labelled run.
  const key = (bs: typeof blocks) => bs.map(b => [...b.ids].sort().join(',')).join('|');
  if (key(planned) !== key(blocks)) {
    plan = positions;
    planned = blocks;
  }
  const span = (at: Map<string, Pos>, a: 'x' | 'y') => {
    const lo = Math.min(...items.map(n => at.get(n.id)![a])),
      hi = Math.max(...items.map(n => at.get(n.id)![a] + size(n, a)));
    return hi - lo;
  };
  const fits = (length: number, depth: number, slack = 1) =>
    length <= room * slack || length <= aspect * depth * slack;
  const unfolded = (at: Map<string, Pos>) => fits(span(at, along), span(at, across));
  // A plan that fits stays unfolded while its labelled run is within `HOLD_SLACK` of the render
  // context, so edge labels alone don't fold a run that is only a little too long.
  const held = (at: Map<string, Pos>) => unfolded(at) || span(at, along) <= room * HOLD_SLACK;
  if (items.length < fewest || (unfolded(plan) && held(positions))) return { positions };
  const block = new Map(blocks.flatMap((b, i) => b.ids.map(id => [id, i] as const)));
  const splits = (cut: number, a: string, b: string) => {
    const [i, j] = [block.get(a), block.get(b)];
    return i !== undefined && j !== undefined && Math.min(i, j) < cut && Math.max(i, j) >= cut;
  };
  const crossing = (cut: number) => pairs.filter(([a, b]) => splits(cut, a, b)).length;
  const cycles = loops(
    items.map(n => n.id),
    pairs,
  );
  // A cut between a decision and any of its branches, or through a loop, reads as a broken line.
  const broken = (cut: number) =>
    SPLIT_DECISION *
      [...decisions].filter(d => pairs.some(p => p[0] === d && splits(cut, ...p))).length +
    SPLIT_LOOP * cycles.filter(l => l.some(id => splits(cut, l[0], id))).length;
  // Wrap edges return along lanes in the gap between bands, so it fits a lane for each edge
  // across the cut and the labels on them.
  const bandGap = (cut: number, labelled: boolean) => {
    const labels = (labelled ? rooms : [])
      .filter(r => splits(cut, r.a, r.b))
      .map(r => (axis === 'right' ? r.h : r.w) - 2 * LABEL_RUN);
    return Math.max(
      gap + 40,
      84,
      labels.length ? Math.max(...labels) + 2 * LABEL_RUN : 0,
      (crossing(cut) + 1) * LANE_PITCH + labels.reduce((sum, h) => sum + h, 0),
    );
  };
  // Cut near each equal share of the length; among nearby cuts, prefer one that fewer edges
  // cross and that splits no decision or loop.
  const chooseCuts = (count: number, bs: typeof blocks) => {
    const total = bs[bs.length - 1].end - bs[0].start;
    const cuts: number[] = [];
    const startOf = new Map(bs.flatMap(b => b.ids.map(id => [id, b.start] as const)));
    for (let i = 1; i < count; i++) {
      // How far the edges a cut creates run back along the gap between bands: from each source's
      // place in the band it leaves to its target's place in the next, in shares of a band.
      const wrapped = (b: number) =>
        pairs
          .filter(p => splits(b, ...p))
          .reduce((sum, [a, z]) => {
            const [s, t] = block.get(a)! < block.get(z)! ? [a, z] : [z, a];
            return sum + Math.abs(startOf.get(s)! - from - (startOf.get(t)! - bs[b].start));
          }, 0) /
        (total / count);
      const at = bs[0].start + (total * i) / count,
        cost = (b: number) =>
          crossing(b) +
          broken(b) +
          wrapped(b) * WRAP_WEIGHT +
          (Math.abs(bs[b].start - at) / (total / count)) * 2;
      // Keep each band within a quarter of an even share (and at least half of one), so a cheap
      // lopsided cut can't win; or up to half over, at any length, when that is the only way to
      // keep decisions and loops whole. A band's length is its boxes, not the gap after them.
      const from = bs[cuts.at(-1) ?? 0].start,
        share = total / count,
        even = (b: number, slack: number, floor: number) =>
          bs[b - 1].end - from >= share * floor &&
          bs[b - 1].end - from <= share * (1 + slack) &&
          bs[bs.length - 1].end - bs[b].start <= share * (count - i) * (1 + slack);
      const tier = (b: number) =>
        !broken(b) && even(b, 0.25, 0.5)
          ? 0
          : !broken(b) && even(b, 0.5, 0)
            ? 1
            : even(b, 0.25, 0.5)
              ? 2
              : 3;
      let best = 0;
      for (let b = (cuts.at(-1) ?? 0) + 1; b < bs.length; b++)
        if (!best || tier(b) < tier(best) || (tier(b) === tier(best) && cost(b) < cost(best)))
          best = b;
      if (best) cuts.push(best);
    }
    return cuts;
  };
  // A side leaf (a node with no way out that shares its rank with another) deepens its band
  // without lengthening the run. Bands are measured without them when deciding how many to cut,
  // so adding an error exit or a note beside a step keeps the fold's bands and cuts.
  const sideLeaves = new Set(
    blocks.flatMap(b =>
      b.ids.length > 1 ? b.ids.filter(id => !pairs.some(([a, z]) => a === id && z !== id)) : [],
    ),
  );
  const bandsOf = (cuts: number[], bs: typeof blocks) => {
    const bands: (typeof blocks)[] = [];
    bs.forEach((b, i) => (i === 0 || cuts.includes(i) ? bands.push([b]) : bands.at(-1)!.push(b)));
    return bands;
  };
  /**
   * Branches to pull back across a cut: a node that starts a band, whose every source ends the
   * band before, comes back to that band's end, beside its nearest source, when that shortens its
   * lines along the run without adding a wrap. A side branch then stays with its source instead
   * of starting the next band and sending its edge across the whole drawing. Keyed by the node,
   * the value is the source it lines up with.
   */
  const pullsFor = (cuts: number[], bs: typeof blocks) => {
    const bands = bandsOf(cuts, bs),
      bandOf = new Map(bands.flatMap((band, k) => band.flatMap(b => b.ids.map(id => [id, k])))),
      startOf = new Map(bs.flatMap(b => b.ids.map(id => [id, b.start] as const))),
      out = new Map<string, string>();
    for (const [k, band] of bands.entries()) {
      if (!k) continue;
      const found: Array<{ id: string; source: string; saves: number }> = [];
      for (const id of band[0].ids) {
        if (decisions.has(id)) continue;
        const ins = pairs.filter(([a, z]) => z === id && a !== id).map(([a]) => a),
          outs = pairs.filter(([a, z]) => a === id && z !== id).map(([, z]) => z);
        if (!ins.length || ins.some(a => bandOf.get(a) !== k - 1)) continue;
        const rel = (n: string, b: number) => startOf.get(n)! - bands[b][0].start,
          length = (home: number) =>
            ins.reduce((s, a) => s + Math.abs(rel(a, k - 1) - rel(id, home)), 0) +
            outs.reduce((s, z) => s + Math.abs(rel(id, home) - rel(z, bandOf.get(z)!)), 0),
          wraps = (home: number) =>
            (home === k - 1 ? 0 : ins.length) + outs.filter(z => bandOf.get(z) !== home).length;
        if (wraps(k - 1) > wraps(k) || length(k - 1) >= length(k)) continue;
        const source = ins.reduce((best, a) => (startOf.get(a)! > startOf.get(best)! ? a : best));
        found.push({ id, source, saves: length(k) - length(k - 1) });
      }
      // The band keeps at least one of its first boxes: pulling them all would move the cut.
      found.sort((a, b) => b.saves - a.saves);
      for (const f of found.slice(0, band[0].ids.length - 1)) out.set(f.id, f.source);
    }
    return out;
  };
  const place = (
    cuts: number[],
    bs: typeof blocks,
    at: Map<string, Pos>,
    labelled: boolean,
    pulls = new Map<string, string>(),
  ) => {
    const bands = bandsOf(cuts, bs);
    // A pulled branch lines up across with its source, past any branch already pulled beside it.
    if (pulls.size) {
      at = new Map(at);
      const placed: Array<{ lo: number; hi: number }> = [];
      for (const [id, source] of pulls) {
        const n = byId.get(id)!,
          s = at.get(source)!;
        let lo = s[across] + (size(byId.get(source)!, across) - size(n, across)) / 2;
        for (const p of placed) if (lo < p.hi + gap && lo + size(n, across) > p.lo) lo = p.hi + gap;
        placed.push({ lo, hi: lo + size(n, across) });
        at.set(id, { ...at.get(id)!, [across]: lo });
      }
    }
    const out = new Map<string, Pos>(),
      members: string[][] = [];
    let offset = 0,
      length = 0,
      typical = 0;
    for (const [k, band] of bands.entries()) {
      const next = bands[k + 1]?.[0].ids ?? [],
        ids = [
          ...band.flatMap(b => b.ids).filter(id => !pulls.has(id)),
          ...next.filter(id => pulls.has(id)),
        ],
        start = Math.min(...ids.map(id => at.get(id)![along])),
        lo = Math.min(...ids.map(id => at.get(id)![across])),
        hi = Math.max(...ids.map(id => at.get(id)![across] + size(byId.get(id)!, across)));
      for (const id of ids) {
        const p = at.get(id)!,
          a = p[along] - start,
          c = p[across] - lo + offset;
        out.set(id, axis === 'right' ? { x: a, y: c } : { x: c, y: a });
      }
      const gapAfter = k < cuts.length ? bandGap(cuts[k], labelled) : 0,
        main = ids.filter(id => !sideLeaves.has(id)),
        kept = main.length ? main : ids;
      offset += hi - lo + gapAfter;
      typical +=
        Math.max(...kept.map(id => at.get(id)![across] + size(byId.get(id)!, across))) -
        Math.min(...kept.map(id => at.get(id)![across])) +
        gapAfter;
      length = Math.max(
        length,
        Math.max(...ids.map(id => at.get(id)![along] + size(byId.get(id)!, along))) - start,
      );
      members.push(ids);
    }
    return {
      out,
      length,
      // The depth that decides the count leaves side leaves out.
      depth: typical,
      count: bands.length,
      bands: members,
    };
  };
  // The fewest bands that fit: wide layouts read best. The plan sets the least count; the
  // labelled run keeps it while it stays within `HOLD_SLACK` of fitting, and takes another band
  // only when its labels no longer fit at all.
  let least = 0;
  if (!unfolded(plan))
    for (let count = 2; count <= blocks.length && !least; count++) {
      const c = place(chooseCuts(count, planned), planned, plan, false);
      if (c.count === count && fits(c.length, c.depth)) least = count;
    }
  for (let count = Math.max(2, least); count <= blocks.length; count++) {
    const cuts = chooseCuts(count, planned),
      c = place(cuts, blocks, positions, true),
      slack = count === least ? HOLD_SLACK : 1;
    if (c.count !== count || !fits(c.length, c.depth, slack)) continue;
    // Branches are pulled back on the plan too, so a relabel never moves one; only while the
    // band they join still has room.
    const pulls = pullsFor(cuts, planned),
      pulled = pulls.size ? place(cuts, blocks, positions, true, pulls) : undefined,
      done = pulled && fits(pulled.length, pulled.depth, slack) ? pulled : c;
    return { positions: done.out, fold: { bands: done.bands, axis } };
  }
  return { positions };
}

/**
 * Lanes for a fold's wrap edges. Each edge from one band into the next returns along its own line
 * in the gap between them: out of the band's end, back along the gap, into the next band. The
 * lanes share the gap at an even pitch, in the order where the returns cross least. A source with
 * a box between it and the gap leaves past the band's end; a target with one, or inside a group
 * (whose title is in the way), is entered from before the band's start. Such side turns are made
 * only at the end or start of a row. Edges with sides set in the file, or that would need a side
 * turn past a neighbour, get no lane.
 */
function wrapLanes(
  folds: Array<{ scope: string; fold: Fold }>,
  edges: ModelEdge[],
  byId: Map<string, SceneObject>,
  immediate: (id: string, scope: string) => string | undefined,
  portPitch: number,
): Map<string, Lane> {
  const out = new Map<string, Lane>();
  for (const { scope, fold } of folds) {
    // Bands read right and stack down, so their lanes are level; or read down and stack right.
    // Below, `u` runs along the bands and `v` across them.
    const level = fold.axis === 'right',
      lo = (o: SceneObject) => (level ? o.y : o.x),
      hi = (o: SceneObject) => (level ? o.y + o.h : o.x + o.w),
      start = (o: SceneObject) => (level ? o.x : o.y),
      end = (o: SceneObject) => (level ? o.x + o.w : o.y + o.h),
      mid = (o: SceneObject) => (start(o) + end(o)) / 2,
      middle = (o: SceneObject) => (lo(o) + hi(o)) / 2,
      overlap = (o: SceneObject, n: SceneObject) => start(o) < end(n) && end(o) > start(n);
    const band = new Map(fold.bands.flatMap((ids, k) => ids.map(id => [id, k] as const))),
      bandOf = (o: SceneObject) => band.get(immediate(o.id, scope) ?? '');
    const leaves = (k: number) =>
      [...byId.values()].filter(o => o.type !== 'group' && bandOf(o) === k);
    for (let k = 0; k + 1 < fold.bands.length; k++) {
      const here = fold.bands[k].map(id => byId.get(id)!),
        next = fold.bands[k + 1].map(id => byId.get(id)!),
        top = Math.max(...here.map(hi)),
        bottom = Math.min(...next.map(lo)),
        exit = Math.max(...here.map(end)) + LANE_PITCH,
        entry = Math.min(...next.map(start)) - LANE_PITCH;
      const [above, below] = [leaves(k), leaves(k + 1)];
      const wraps = edges.flatMap(e => {
        const source = byId.get(e.source)!,
          target = byId.get(e.target)!;
        if (bandOf(source) !== k || bandOf(target) !== k + 1) return [];
        if (e.from !== 'auto' || e.to !== 'auto') return [];
        const leave = above.some(o => lo(o) > lo(source) && overlap(o, source)),
          enter =
            immediate(e.target, scope) !== e.target ||
            below.some(o => lo(o) < lo(target) && overlap(o, target));
        // A side turn reads only from the end of a row or into its start; otherwise the line
        // would run past a neighbour, so the router draws the edge as it would any other.
        const row = (o: SceneObject, n: SceneObject) => lo(o) < hi(n) && hi(o) > lo(n);
        if (leave && above.some(o => row(o, source) && start(o) >= end(source))) return [];
        if (enter && below.some(o => row(o, target) && end(o) <= start(target))) return [];
        return [{ id: e.id, source, target, leave, enter }];
      });
      // Several wraps from one side of a source leave from ports the router spreads from the
      // middle outwards, nearest target first, leaning toward the targets. Their drops cross
      // the lanes unless the lanes follow the same order.
      const drop = new Map<string, number>();
      const bySource = new Map<string, typeof wraps>();
      for (const w of wraps)
        if (!w.leave) bySource.set(w.source.id, [...(bySource.get(w.source.id) ?? []), w]);
      for (const fan of bySource.values()) {
        const near = (w: (typeof wraps)[number]) =>
          Math.abs(mid(w.target) - mid(w.source)) + Math.abs(middle(w.target) - middle(w.source));
        fan.sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : 1));
        fan.forEach((w, k) => {
          const lean = mid(w.target) < mid(w.source) ? -1 : 1,
            step = Math.ceil(k / 2) * portPitch * (k % 2 ? lean : -lean);
          drop.set(w.id, mid(w.source) + step);
        });
      }
      // A hint can pull the bands together; then there is no clear gap to share.
      if (!wraps.length || bottom - top < (wraps.length + 1) * LANE_PITCH) continue;
      // Turns outside the bands nest: the lane nearest the earlier band leaves closest to its
      // end and enters furthest before the next band's start.
      const assign = (order: typeof wraps) => {
        const leaving = order.filter(w => w.leave),
          entering = order.filter(w => w.enter);
        return order.map((w, i) => ({
          w,
          at: round(top + ((bottom - top) * (i + 1)) / (order.length + 1)),
          leave: w.leave ? round(exit + LANE_PITCH * leaving.indexOf(w)) : undefined,
          enter: w.enter
            ? round(entry - LANE_PITCH * (entering.length - 1 - entering.indexOf(w)))
            : undefined,
        }));
      };
      const paths = (order: typeof wraps) =>
        assign(order).map(({ w, at, leave, enter }) => [
          ...(leave !== undefined
            ? [
                { u: end(w.source), v: middle(w.source) },
                { u: leave, v: middle(w.source) },
                { u: leave, v: at },
              ]
            : [
                { u: drop.get(w.id)!, v: top },
                { u: drop.get(w.id)!, v: at },
              ]),
          ...(enter !== undefined
            ? [
                { u: enter, v: at },
                { u: enter, v: middle(w.target) },
                { u: start(w.target), v: middle(w.target) },
              ]
            : [
                { u: mid(w.target), v: at },
                { u: mid(w.target), v: bottom },
              ]),
        ]);
      const order = fewestCrossings(
        [...wraps].sort((a, b) => mid(b.source) - mid(a.source)),
        o => crossings(paths(o)),
      );
      for (const { w, at, leave, enter } of assign(order))
        out.set(w.id, {
          ...(level ? { y: at } : { x: at }),
          ...(leave !== undefined ? { leave } : {}),
          ...(enter !== undefined ? { enter } : {}),
        });
    }
  }
  return out;
}

/** How many times orthogonal paths, given as points along and across, cross one another. */
export function crossings(paths: Array<Array<{ u: number; v: number }>>) {
  const segments = paths.map(p => p.slice(1).map((q, i) => [p[i], q] as const));
  let n = 0;
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++)
      for (const [a, b] of segments[i])
        for (const [c, d] of segments[j]) {
          // One run along, the other across, each passing strictly through the other.
          const [h, x] =
            a.v === b.v && c.u === d.u
              ? [
                  [a, b],
                  [c, d],
                ]
              : c.v === d.v && a.u === b.u
                ? [
                    [c, d],
                    [a, b],
                  ]
                : [];
          if (!h || !x) continue;
          const u = x[0].u,
            v = h[0].v;
          if (
            u > Math.min(h[0].u, h[1].u) &&
            u < Math.max(h[0].u, h[1].u) &&
            v > Math.min(x[0].v, x[1].v) &&
            v < Math.max(x[0].v, x[1].v)
          )
            n++;
        }
  return n;
}

/** The order of up to six items that scores fewest crossings; the first such, from `items`. */
export function fewestCrossings<T>(items: T[], score: (order: T[]) => number): T[] {
  if (items.length > 6) return items;
  let best = items,
    fewest = score(items);
  const permute = (done: T[], left: T[]) => {
    if (!fewest) return;
    if (!left.length) {
      const n = score(done);
      if (n < fewest) [best, fewest] = [done, n];
      return;
    }
    left.forEach((w, i) => permute([...done, w], [...left.slice(0, i), ...left.slice(i + 1)]));
  };
  permute([], items);
  return best;
}

/** Siblings placed as the engine arranged them, shifted so the scope's content starts at 0,0. */
function fromEngine(
  items: Item[],
  arranged: Map<string, Pos>,
  axis: 'right' | 'down',
  rooms: LabelRoom[] = [],
) {
  const x0 = Math.min(...items.map(n => arranged.get(n.id)!.x)),
    y0 = Math.min(...items.map(n => arranged.get(n.id)!.y));
  const positions = new Map(
    items.map(n => {
      const p = arranged.get(n.id)!;
      return [n.id, { x: round(p.x - x0), y: round(p.y - y0) }] as const;
    }),
  );
  return { positions: withLabelRoom(items, positions, axis, rooms), axis };
}

/** Clearance kept between a label in a pocket and the boxes and other labels around it. */
const POCKET_PAD = 4;

/**
 * Labelled edges whose label fits in a pocket, so their gap need not widen. An edge between two
 * ranks that are offset across the reading direction turns in the gap between them, and its run
 * across that gap can carry the label wherever the rows leave a hole beside it: the space between
 * two rows, clear of every box on either side of the gap. Each pocket taken stays clear for the
 * next label. `boxes` are the drawn boxes laid out without label room; widening other gaps only
 * moves whole ranks along, so a pocket found there stays open.
 */
function pocketed(
  boxes: Map<string, Size & Pos>,
  axis: 'right' | 'down',
  rooms: LabelRoom[],
): Set<LabelRoom> {
  const along = axis === 'right' ? 'x' : 'y',
    across = axis === 'right' ? 'y' : 'x',
    size = (n: Size, a: 'x' | 'y') => (a === 'x' ? n.w : n.h);
  const taken: Array<{ lo: number; hi: number; from: number; to: number }> = [],
    out = new Set<LabelRoom>();
  for (const r of rooms) {
    let [a, b] = [boxes.get(r.a), boxes.get(r.b)];
    if (!a || !b) continue;
    if (b[along] < a[along]) [a, b] = [b, a];
    const gapFrom = a[along] + size(a, along),
      gapTo = b[along];
    // Boxes side by side share no gap; their label room is set across.
    if (gapTo <= gapFrom) continue;
    const w = (axis === 'right' ? r.w : r.h) - 2 * LABEL_RUN,
      h = (axis === 'right' ? r.h : r.w) - 2 * LABEL_RUN;
    // The router may run the turn anywhere in the gap, so the label may sit anywhere across it.
    const from = gapFrom - w / 2 - POCKET_PAD,
      to = gapTo + w / 2 + POCKET_PAD;
    const ca = a[across] + size(a, across) / 2,
      cb = b[across] + size(b, across) / 2,
      runLo = Math.min(ca, cb) + POCKET_PAD,
      runHi = Math.max(ca, cb) - POCKET_PAD;
    if (runHi - runLo < h) continue;
    const blocks = [
      ...[...boxes.values()]
        .filter(o => o[along] < to && o[along] + size(o, along) > from)
        .map(o => ({
          lo: o[across] - POCKET_PAD,
          hi: o[across] + size(o, across) + POCKET_PAD,
        })),
      ...taken.filter(t => t.from < to && t.to > from),
    ];
    const free = (t: number) => blocks.every(k => t + h <= k.lo || t >= k.hi);
    const mid = (runLo + runHi - h) / 2;
    const spot = [runLo, mid, ...blocks.map(k => k.hi)]
      .filter(t => t >= runLo && t + h <= runHi && free(t))
      .sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid))[0];
    if (spot === undefined) continue;
    out.add(r);
    taken.push({ lo: spot - POCKET_PAD, hi: spot + h + POCKET_PAD, from, to });
  }
  return out;
}

/** Engines whose scopes holding groups are packed tight instead of kept on global rank columns. */
const PACKED_ENGINES = new Set(['compound-flow', 'layered']);

/** The most a group gap grows to leave room for the lines that pass between groups. */
const MAX_GROUP_GAP = 96;

/** Gaps a packed scope uses: between boxes across a rank, between ranks, and next to a group. */
interface PackGaps {
  node: number;
  rank: number;
  group: number;
}

/** How much deeper than the deepest rank a sink's move may make its callers' rank. */
const DEEPER = 1.25;

/**
 * Move a sink group (one with no way out) back into its callers' rank, beside them, when all its
 * callers share one rank and one of them goes on into another member of the next rank. Called
 * groups such as an upstream API then sit next to the code that calls them instead of opening a
 * rank of their own past it, where they leave the space beside their callers empty and draw long
 * lines back. Of a caller's sinks in the next rank, the longest along the reading direction
 * stays, so the run keeps its next step. A sink stays put when the move would make its callers'
 * rank much deeper (`extent`, across the reading direction) than the deepest rank already is: a
 * tall group stacked on its caller leaves the rest of the drawing beside empty space.
 */
function besideCallers(
  layers: string[][],
  pairs: Array<[string, string]>,
  movable: (id: string) => boolean,
  length: (id: string) => number,
  extent: (layer: string[]) => number,
): string[][] {
  const rank = new Map(layers.flatMap((layer, i) => layer.map(id => [id, i] as const))),
    sink = (id: string) => !pairs.some(([a, b]) => a === id && b !== id),
    callers = (id: string) => [
      ...new Set(pairs.filter(([a, b]) => b === id && a !== id).map(p => p[0])),
    ];
  const moved = new Set<string>(),
    deepest = Math.max(...layers.map(extent));
  for (const [i, layer] of layers.entries()) {
    if (!i) continue;
    for (const id of layer) {
      const from = callers(id);
      if (!movable(id) || !sink(id) || !from.length) continue;
      if (from.some(c => rank.get(c) !== i - 1)) continue;
      // It moves only if the run still goes on past the callers: into a member of this rank that
      // goes further, or into a longer sink.
      const next = [...new Set(pairs.filter(([a]) => from.includes(a)).map(p => p[1]))].filter(
        t => t !== id && rank.get(t) === i,
      );
      const longest = [id, ...next].filter(sink).sort((a, b) => length(b) - length(a))[0];
      const joined = [...layers[i - 1], ...layer.filter(x => moved.has(x)), id];
      if (extent(joined) > DEEPER * deepest) continue;
      if (next.some(t => !sink(t)) || longest !== id) moved.add(id);
    }
  }
  if (!moved.size) return layers;
  return layers
    .map((layer, i) => [
      ...layer.filter(id => !moved.has(id)),
      ...(layers[i + 1] ?? []).filter(id => moved.has(id)),
    ])
    .filter(layer => layer.length);
}

/**
 * Pack an engine-arranged scope tight. Members take local ranks from the edges between them, so a
 * chain reads as a straight row or column in the reading direction instead of stepping across the
 * engine's global rank columns. Each rank keeps the engine's order across it, and every rank is
 * centred on one line. A gap next to a group is the drawing's one group gap. Where members are
 * linked, a member with no edge to another member has nothing here to order it by: the engine
 * centres it under the linked ones. It sits across where its `outside` neighbours are instead, so
 * two outcomes fed by one node outside the group sit together on that node's side. In a scope with
 * no inner edges the engine's order already follows the outside neighbours, and it stays.
 */
function packed(
  items: Item[],
  arranged: Map<string, Pos & Size>,
  axis: 'right' | 'down',
  pairs: Array<[string, string]>,
  rooms: LabelRoom[],
  gaps: PackGaps,
  sinks = false,
  lines: ScopeLine[] = [],
  outside = new Map<string, string[]>(),
  follow = new Map<string, number>(),
  anchor: (a: string, b: string) => number | undefined = () => undefined,
) {
  const by = new Map(items.map(n => [n.id, n])),
    ids = items.map(n => n.id),
    right = axis === 'right';
  const major = (id: string) => (right ? by.get(id)!.w : by.get(id)!.h),
    minor = (id: string) => (right ? by.get(id)!.h : by.get(id)!.w),
    group = (id: string) => by.get(id)!.type === 'group';
  const centre = (p: Pos & Size) => (right ? p.y + p.h / 2 : p.x + p.w / 2),
    linked = new Set(pairs.flat());
  const across = (id: string) => {
    const ns =
      !linked.size || linked.has(id)
        ? []
        : (outside.get(id) ?? []).flatMap(o => arranged.get(o) ?? []);
    if (ns.length) return ns.reduce((s, p) => s + centre(p), 0) / ns.length;
    const p = arranged.get(id)!;
    return right ? p.y + by.get(id)!.h / 2 : p.x + by.get(id)!.w / 2;
  };
  const between = (a: string, b: string) =>
    Math.max(
      roomBetween(rooms, a, b, group(a) || group(b) ? gaps.group : gaps.node, !right),
      softRoom(by.get(a)!.soft, by.get(b)!.soft, right),
    );
  const extent = (layer: string[]) =>
    layer.reduce((s, id, j) => s + minor(id) + (j ? between(layer[j - 1], id) : 0), 0);
  const layers = besideCallers(
    rankLayers(ids, pairs),
    pairs,
    sinks ? group : () => false,
    major,
    extent,
  ).map(layer =>
    clustered(
      [...layer].sort((a, b) => across(a) - across(b) || ids.indexOf(a) - ids.indexOf(b)),
      id => by.get(id)!.soft,
    ),
  );
  const rank = new Map(layers.flatMap((layer, i) => layer.map(id => [id, i] as const)));
  const extents = layers.map(extent);
  const widest = Math.max(...extents);
  // A chain link, a member with one way on into a member with one way in, shares its
  // predecessor's centre line so the chain reads straight. Other members stay centred on the
  // ranks' common line; members are pushed along only to keep their order and gaps.
  const outs = new Map(ids.map(id => [id, new Set<string>()])),
    ins = new Map(ids.map(id => [id, new Set<string>()]));
  for (const [a, b] of pairs)
    if (rank.get(b)! > rank.get(a)!) {
      outs.get(a)!.add(b);
      ins.get(b)!.add(a);
    }
  const cross = new Map<string, number>(),
    mid = new Map<string, number>();
  for (const [i, layer] of layers.entries()) {
    let slot = (widest - extents[i]) / 2,
      end = -Infinity;
    for (const [j, id] of layer.entries()) {
      const [pred] = ins.get(id)!,
        link = ins.get(id)!.size === 1 && outs.get(pred)!.size === 1,
        lined = link ? anchor(pred, id) : undefined,
        want =
          lined !== undefined
            ? cross.get(pred)! + lined
            : link
              ? mid.get(pred)! - minor(id) / 2
              : slot,
        start = j ? Math.max(want, end + between(layer[j - 1], id)) : want;
      cross.set(id, start);
      mid.set(id, start + minor(id) / 2);
      end = start + minor(id);
      slot = Math.max(slot + minor(id), end) + (layer[j + 1] ? between(id, layer[j + 1]) : 0);
    }
  }
  const followed = layers.length === 1 && spaced(layers[0]);
  /**
   * One rank whose members each face one box in a sibling group (`follow`: that box's centre,
   * in order) takes that box's spacing, so each line between the two columns runs straight.
   * Members only move on to keep their gaps; if that costs more than a little length, the rank
   * stays packed.
   */
  function spaced(layer: string[]) {
    const at = layer.map(id => follow.get(id));
    if (layer.length < 2 || at.some((c, j) => c === undefined || (j && c < at[j - 1]!)))
      return false;
    const starts: number[] = [];
    let end = -Infinity;
    for (const [j, id] of layer.entries()) {
      const want = at[j]! - at[0]! + minor(layer[0]) / 2 - minor(id) / 2;
      starts.push(j ? Math.max(want, end + between(layer[j - 1], id)) : want);
      end = starts[j] + minor(id);
    }
    const span = at.at(-1)! - at[0]! + (minor(layer[0]) + minor(layer.at(-1)!)) / 2;
    if (end - starts[0] > Math.max(extents[0] * 1.25, span + 1)) return false;
    layer.forEach((id, j) => cross.set(id, starts[j]));
    return true;
  }
  const low = Math.min(...cross.values()),
    busy = gapRoom(layers, lines, rooms, axis);
  const out = new Map<string, Pos>();
  let at = 0;
  for (const [i, layer] of layers.entries()) {
    for (const id of layer) {
      const c = round(cross.get(id)! - low);
      out.set(id, right ? { x: at, y: c } : { x: c, y: at });
    }
    const next = layers[i + 1];
    if (!next) break;
    let after = Math.max(
      layer.some(group) || next.some(group) ? gaps.group : gaps.rank,
      busy[i],
      rankRoom(layer, next, id => by.get(id)!.soft, !right),
    );
    for (const r of rooms)
      if (
        Math.min(rank.get(r.a)!, rank.get(r.b)!) === i &&
        Math.abs(rank.get(r.a)! - rank.get(r.b)!) === 1
      )
        after = Math.max(after, right ? r.w : r.h);
    at += Math.max(...layer.map(major)) + after;
  }
  return { positions: out, axis, followed };
}

/**
 * Engines space every rank alike. Where a labelled edge between two ranks has less room than its
 * label needs, push everything past the first rank's end along the reading axis.
 */
function withLabelRoom(
  items: Item[],
  positions: Map<string, Pos>,
  axis: 'right' | 'down',
  rooms: LabelRoom[],
) {
  const by = new Map(items.map(n => [n.id, n])),
    start = (id: string) => (axis === 'right' ? positions.get(id)!.x : positions.get(id)!.y),
    end = (id: string) => start(id) + (axis === 'right' ? by.get(id)!.w : by.get(id)!.h);
  const cuts = new Map<number, number>();
  for (const r of rooms) {
    const [a, b] = start(r.a) <= start(r.b) ? [r.a, r.b] : [r.b, r.a],
      free = start(b) - end(a),
      need = axis === 'right' ? r.w : r.h;
    // Siblings that overlap on the axis sit side by side; their edge doesn't cross a rank gap.
    if (free >= 0 && free < need) cuts.set(end(a), Math.max(cuts.get(end(a)) ?? 0, need - free));
  }
  if (!cuts.size) return positions;
  const out = new Map<string, Pos>();
  for (const n of items) {
    let shift = 0;
    for (const [at, amount] of cuts) if (start(n.id) >= at) shift += amount;
    const p = positions.get(n.id)!;
    out.set(
      n.id,
      axis === 'right' ? { x: round(p.x + shift), y: p.y } : { x: p.x, y: round(p.y + shift) },
    );
  }
  return out;
}

/**
 * A line a scope's layout must leave room for: an edge between two members (`a` and `b`), or
 * one that leaves (`a` only) or enters (`b` only) the scope. `label` is an outside line's label
 * size; a line between members takes its label from the scope's label rooms.
 */
interface ScopeLine {
  a?: string;
  b?: string;
  label?: Size;
}

/** Clearance a line keeps from the boxes on either side of a gap it runs through. */
const GAP_STANDOFF = 20;

/**
 * The room each gap between consecutive ranks needs for the lines that run through it, or 0
 * where the scope's own gap will do. A line runs through a gap it leaves its source by or enters
 * its target by: one between members ending next to the gap, one leaving the scope from the rank
 * before it, or one entering the scope into the rank after it. A gap where a line would run
 * through a label (see below) widens the way a group gap widens: a standoff each side,
 * `LANE_PITCH` per extra line, and, between rows, each labelled line's label height.
 */
function gapRoom(
  layers: string[][],
  lines: ScopeLine[],
  rooms: LabelRoom[],
  axis: 'right' | 'down',
): number[] {
  const rank = new Map(layers.flatMap((layer, i) => layer.map(id => [id, i] as const))),
    // Labels stack along a gap only where lines cross it running level: in a gap between rows.
    // Between columns each label sits on its own level run, side by side with the others, and
    // the widest already sets the gap.
    along = (s: Size) => (axis === 'right' ? 2 * LABEL_RUN : s.h),
    run = 2 * LABEL_RUN;
  return layers.slice(0, -1).map((_, i) => {
    let n = 0,
      labels = 0;
    const unused = [...rooms],
      counted: ScopeLine[] = [],
      labelled: ScopeLine[] = [];
    for (const l of lines) {
      const ra = l.a !== undefined ? rank.get(l.a) : undefined,
        rb = l.b !== undefined ? rank.get(l.b) : undefined;
      let through: boolean;
      if (ra !== undefined && rb !== undefined) {
        const lo = Math.min(ra, rb),
          hi = Math.max(ra, rb);
        through = lo <= i && hi > i && (lo === i || hi === i + 1);
        if (!through) continue;
        const k = unused.findIndex(
          r => (r.a === l.a && r.b === l.b) || (r.a === l.b && r.b === l.a),
        );
        if (k >= 0) {
          labels += along(unused.splice(k, 1)[0]) - run;
          if (lo === i && hi === i + 1) labelled.push(l);
        }
      } else {
        through = ra !== undefined ? ra === i : rb === i + 1;
        if (!through) continue;
        if (l.label && rooms.length) labels += along(l.label) - (axis === 'right' ? run : 0);
      }
      n++;
      counted.push(l);
    }
    // The gap widens only where a line would run through a label in it: a labelled edge across
    // the gap, and a line leaving or entering the group by one of its two boxes, which turns in
    // the gap past the label on its way out of the group.
    const clash = labelled.some(l =>
      counted.some(o => !(o.a && o.b) && [o.a, o.b].some(e => e && (e === l.a || e === l.b))),
    );
    return clash ? 2 * GAP_STANDOFF + (n - 1) * LANE_PITCH + labels : 0;
  });
}

function baseLayout(
  items: Item[],
  layout: ModelLayout,
  pairs: Array<[string, string]>,
  rooms: LabelRoom[] = [],
  lines: ScopeLine[] = [],
) {
  const out = new Map<string, Pos>(),
    gap = layout.gap,
    axis = axisOf(layout);
  const by = new Map(items.map(n => [n.id, n]));
  if (layout.algorithm === 'row' || layout.algorithm === 'column') {
    const row = layout.algorithm === 'row',
      busy = gapRoom(
        items.map(n => [n.id]),
        lines,
        rooms,
        row ? 'right' : 'down',
      );
    let cursor = 0;
    for (const [i, n] of items.entries()) {
      const next = items[i + 1]?.id ?? '';
      out.set(n.id, row ? { x: cursor, y: 0 } : { x: 0, y: cursor });
      cursor +=
        (row ? n.w : n.h) +
        Math.max(
          roomBetween(rooms, n.id, next, gap, row),
          busy[i] ?? 0,
          softRoom(n.soft, items[i + 1]?.soft, !row),
        );
    }
  } else {
    const ids = items.map(n => n.id);
    const chainOf = (id: string) => by.get(id)!.soft;
    const layers = pairs.length
      ? byBarycenter(rankLayers(ids, pairs), pairs, layer => clustered(layer, chainOf))
      : ids.map(id => [id]);
    const major = (id: string) => (axis === 'right' ? by.get(id)!.w : by.get(id)!.h);
    const minor = (id: string) => (axis === 'right' ? by.get(id)!.h : by.get(id)!.w);
    // A gap between ranks grows to fit the labels on edges that cross it.
    const rank = new Map(layers.flatMap((layer, i) => layer.map(id => [id, i] as const))),
      busy = gapRoom(layers, lines, rooms, axis);
    let at = 0;
    for (const [i, layer] of layers.entries()) {
      let across = 0,
        after = Math.max(gap, busy[i] ?? 0);
      for (const [j, id] of layer.entries()) {
        out.set(id, axis === 'right' ? { x: at, y: across } : { x: across, y: at });
        across +=
          minor(id) +
          Math.max(
            roomBetween(rooms, id, layer[j + 1] ?? '', gap, axis !== 'right'),
            layer[j + 1] ? softRoom(chainOf(id), chainOf(layer[j + 1]), axis === 'right') : 0,
          );
      }
      if (layers[i + 1])
        after = Math.max(after, rankRoom(layer, layers[i + 1], chainOf, axis === 'down'));
      for (const r of rooms)
        if (
          Math.min(rank.get(r.a)!, rank.get(r.b)!) === i &&
          Math.abs(rank.get(r.a)! - rank.get(r.b)!) === 1
        )
          after = Math.max(after, axis === 'right' ? r.w : r.h);
      at += Math.max(...layer.map(major)) + after;
    }
  }
  return { positions: out, axis };
}

/**
 * Order each rank across the run by where its connections point: the mean place of its members'
 * neighbours in the rank before, as `layered` orders nodes. A group fed by another group then sits
 * on that group's side instead of in declaration order between unrelated siblings (FEEL.md:
 * siblings sit where their connections point). A member with no neighbour in the rank before
 * keeps its place.
 */
function byBarycenter(
  layers: string[][],
  pairs: Array<[string, string]>,
  group: (layer: string[]) => string[] = layer => layer,
): string[][] {
  const out = [group(layers[0])];
  for (let i = 1; i < layers.length; i++) {
    const before = new Map(out[i - 1].map((id, k) => [id, k]));
    const keyed = layers[i].map((id, k) => {
      const at = pairs
        .flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []))
        .filter(n => before.has(n))
        .map(n => before.get(n)!);
      return {
        id,
        key: at.length ? at.reduce((s, v) => s + v, 0) / at.length : null,
        k,
      };
    });
    // Members with a key take the free places in key order; the others stay put.
    const free = keyed.filter(x => x.key !== null);
    const sorted = [...free].sort((a, b) => a.key! - b.key! || a.k - b.k);
    const slots = free.map(x => x.k);
    const layer = [...layers[i]];
    sorted.forEach((x, j) => (layer[slots[j]] = x.id));
    out.push(group(layer));
  }
  return out;
}

class Union {
  private parent: Map<string, string>;
  constructor(ids: string[]) {
    this.parent = new Map(ids.map(x => [x, x]));
  }
  find(x: string) {
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    return r;
  }
  join(a: string, b: string) {
    a = this.find(a);
    b = this.find(b);
    if (a !== b) this.parent.set(b, a);
  }
}

interface Variable {
  sum: number;
  weight: number;
  value: number;
  fixed: number | null;
  members: string[];
}

/**
 * The `stay`s in a scope that went stale. The viewer writes a `stay` for each object around a
 * drag, recording where it sat in the arrangement of the time. When growth changes that
 * arrangement, honouring the stays can land two siblings that the packing keeps in different
 * ranks on top of each other along the reading direction. Separation then slides one under the
 * other and the drawing no longer reads in order. Those two stays describe a layout that no
 * longer exists, so both are dropped and the packing places them. A pair counts when two stayed
 * boxes collide and overlap by at least half the smaller one along the reading direction, while
 * the packing holds them apart along it. Stays written together never collide, so only a change
 * since then can do that. A stayed box that a little growth nudges into a neighbour still holds,
 * and a new object that lands on a stayed one is moved aside as before.
 */
function staleStays(
  items: Item[],
  base: Map<string, Pos>,
  local: Hint[],
  axis: 'right' | 'down',
): Extract<Hint, { type: 'stay' }>[] {
  const stays = local.filter((h): h is Extract<Hint, { type: 'stay' }> => h.type === 'stay');
  if (!stays.length) return [];
  const stayed = new Map(stays.map(h => [h.id, { x: h.x, y: h.y }])),
    stale = new Set<string>();
  const along = axis === 'right' ? 'x' : 'y',
    across = axis === 'right' ? 'y' : 'x',
    size = (n: Item, a: 'x' | 'y') => (a === 'x' ? n.w : n.h);
  /** Overlap of two boxes' extents on one axis (negative when apart). */
  const overlap = (a: Item, p: Pos, b: Item, q: Pos, ax: 'x' | 'y') =>
    Math.min(p[ax] + size(a, ax), q[ax] + size(b, ax)) - Math.max(p[ax], q[ax]);
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i],
        b = items[j];
      const sa = stayed.get(a.id),
        sb = stayed.get(b.id),
        pa = base.get(a.id),
        pb = base.get(b.id);
      if (!sa || !sb || !pa || !pb || overlap(a, pa, b, pb, along) > 0) continue;
      if (
        overlap(a, sa, b, sb, across) > 0 &&
        overlap(a, sa, b, sb, along) >= Math.min(size(a, along), size(b, along)) / 2
      ) {
        stale.add(a.id);
        stale.add(b.id);
      }
    }
  return stays.filter(h => stale.has(h.id));
}

/**
 * Apply refinements to one scope: stays, nudges, near, preferred alignment and pins set starting
 * positions; required alignment and near become shared or ordered variables; then overlapping
 * siblings are separated, moving lighter objects more. Pins never move.
 */
function refine(
  items: Item[],
  base: Map<string, Pos>,
  hints: Hint[],
  scope: string,
  diagnostics: Diagnostic[],
  axis: 'right' | 'down',
): Map<string, Pos> {
  const ids = items.map(n => n.id),
    by = new Map(items.map(n => [n.id, n])),
    pos = new Map(items.map(n => [n.id, { ...base.get(n.id)! }])),
    weight = new Map(ids.map(id => [id, 1]));
  const local = hints.filter(h =>
    'ids' in h ? h.type === 'align' && h.ids.every(id => by.has(id)) : 'id' in h && by.has(h.id),
  );
  const intended = new Map<string, { pos: Pos; hint: Hint }>();
  const stale = staleStays(items, base, local, axis);
  if (stale.length)
    diagnostics.push({
      level: 'info',
      code: 'stale-stay',
      message: `The stays on ${stale.map(h => h.id).join(', ')} no longer fit ${scope}'s arrangement, so they were ignored. Drag again to anchor the new layout.`,
      line: stale[0].line,
      ids: stale.map(h => h.id),
    });
  for (const h of local)
    if (h.type === 'stay' && !stale.includes(h)) {
      pos.set(h.id, { x: h.x, y: h.y });
      weight.set(h.id, h.weight);
      intended.set(h.id, { pos: { x: h.x, y: h.y }, hint: h });
    }
  for (const h of local)
    if (h.type === 'nudge') {
      const p = base.get(h.id)!,
        next = { x: p.x + h.dx, y: p.y + h.dy };
      pos.set(h.id, next);
      weight.set(h.id, 4);
      intended.set(h.id, { pos: next, hint: h });
    }
  const near = new Map(
    local.flatMap(h => (h.type === 'near' && by.has(h.ref) ? [[h.id, h] as const] : [])),
  );
  const done = new Set<string>(),
    visiting = new Set<string>();
  const place = (id: string) => {
    const h = near.get(id);
    if (done.has(id) || !h) return;
    if (visiting.has(id))
      throw new DslError(
        `Relative placement cycle in ${scope}. Replace one near with nudge.`,
        h.line,
      );
    visiting.add(id);
    place(h.ref);
    const a = by.get(id)!,
      b = by.get(h.ref)!,
      p = pos.get(h.ref)!;
    let x = p.x + (b.w - a.w) / 2,
      y = p.y + (b.h - a.h) / 2;
    if (h.side === 'right' || h.side === 'left') {
      x = h.side === 'right' ? p.x + b.w + h.gap : p.x - a.w - h.gap;
      y += h.offset;
    } else {
      y = h.side === 'below' ? p.y + b.h + h.gap : p.y - a.h - h.gap;
      x += h.offset;
    }
    pos.set(id, { x, y });
    weight.set(id, 5);
    intended.set(id, { pos: { x, y }, hint: h });
    visiting.delete(id);
    done.add(id);
  };
  ids.forEach(place);

  for (const h of local)
    if (h.type === 'align' && h.strength === 'prefer') {
      const ref = by.get(h.ids[0])!,
        p = pos.get(ref.id)!,
        size = (n: Item) => (h.axis === 'x' ? n.w : n.h),
        center = p[h.axis] + size(ref) / 2;
      for (const id of h.ids.slice(1)) pos.get(id)![h.axis] = center - size(by.get(id)!) / 2;
    }
  const pins = new Map(local.flatMap(h => (h.type === 'pin' ? [[h.id, h] as const] : [])));
  for (const [id, h] of pins) pos.set(id, { x: h.x, y: h.y });

  const half = (a: 'x' | 'y', id: string) => (a === 'x' ? by.get(id)!.w : by.get(id)!.h) / 2;
  const uf = { x: new Union(ids), y: new Union(ids) };
  for (const h of local)
    if (h.type === 'align' && h.strength === 'required')
      for (const id of h.ids.slice(1)) {
        const roots = new Set([uf[h.axis].find(h.ids[0]), uf[h.axis].find(id)]);
        const fixed = ids
          .filter(k => pins.has(k) && roots.has(uf[h.axis].find(k)))
          .map(k => pos.get(k)![h.axis] + half(h.axis, k));
        if (fixed.length > 1 && Math.max(...fixed) - Math.min(...fixed) > 0.01)
          diagnostics.push({
            level: 'error',
            code: 'pin-align-conflict',
            message: `Pins conflict with required ${h.axis} alignment in ${scope}. The pins were kept.`,
            line: h.line,
            ids: h.ids,
          });
        else uf[h.axis].join(h.ids[0], id);
      }

  const vars = { x: new Map<string, Variable>(), y: new Map<string, Variable>() };
  for (const a of ['x', 'y'] as const)
    for (const id of ids) {
      const root = uf[a].find(id),
        center = pos.get(id)![a] + half(a, id);
      if (!vars[a].has(root))
        vars[a].set(root, { sum: 0, weight: 0, value: 0, fixed: null, members: [] });
      const v = vars[a].get(root)!;
      v.sum += center * weight.get(id)!;
      v.weight += weight.get(id)!;
      v.members.push(id);
      if (pins.has(id)) v.fixed = center;
    }
  for (const a of ['x', 'y'] as const)
    for (const v of vars[a].values()) v.value = v.fixed ?? v.sum / v.weight;
  const variable = (a: 'x' | 'y', id: string) => vars[a].get(uf[a].find(id))!;
  const center = (a: 'x' | 'y', id: string) => variable(a, id).value;
  /** Push `first` to be at least `gap` after `second` on axis `a`. */
  const separate = (a: 'x' | 'y', first: string, second: string, gap: number) => {
    const u = variable(a, first),
      w = variable(a, second),
      delta = gap - (u.value - w.value);
    if (delta <= 0.005 || u === w || (u.fixed !== null && w.fixed !== null)) return 0;
    if (u.fixed !== null) w.value -= delta;
    else if (w.fixed !== null) u.value += delta;
    else {
      const total = u.weight + w.weight;
      u.value += (delta * w.weight) / total;
      w.value -= (delta * u.weight) / total;
    }
    return delta;
  };

  const required = local.flatMap(h =>
    h.type === 'near' && h.strength === 'required' && by.has(h.ref) ? [h] : [],
  );
  const primary = axis === 'right' ? 'x' : 'y';
  for (let pass = 0; pass < 48; pass++) {
    let movement = 0;
    for (const h of required) {
      const a = h.side === 'right' || h.side === 'left' ? 'x' : 'y',
        plus = h.side === 'right' || h.side === 'below';
      movement += separate(
        a,
        plus ? h.id : h.ref,
        plus ? h.ref : h.id,
        half(a, h.id) + half(a, h.ref) + h.gap,
      );
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i],
          b = items[j],
          dx = center('x', b.id) - center('x', a.id),
          dy = center('y', b.id) - center('y', a.id),
          ox = (a.w + b.w) / 2 + MIN_GAP - Math.abs(dx),
          oy = (a.h + b.h) / 2 + MIN_GAP - Math.abs(dy);
        if (ox <= 0.005 || oy <= 0.005) continue;
        const choices = (['x', 'y'] as const).filter(
          ax =>
            variable(ax, a.id) !== variable(ax, b.id) &&
            !(variable(ax, a.id).fixed !== null && variable(ax, b.id).fixed !== null),
        );
        if (!choices.length) continue;
        const cost = (ax: 'x' | 'y') => (ax === 'x' ? ox : oy) + (ax === primary ? 0 : 3);
        const ax = [...choices].sort((p, q) => cost(p) - cost(q))[0],
          d = ax === 'x' ? dx : dy;
        movement += separate(
          ax,
          d >= 0 ? b.id : a.id,
          d >= 0 ? a.id : b.id,
          (ax === 'x' ? a.w + b.w : a.h + b.h) / 2 + MIN_GAP,
        );
      }
    // Group content stays at nonnegative local coordinates so it fits inside the frame; the root
    // has no frame, and clamping there would push anchored objects aside. Pins never move.
    if (scope !== 'root')
      for (const a of ['x', 'y'] as const)
        for (const v of vars[a].values()) {
          const min = Math.max(...v.members.map(id => half(a, id)));
          if (v.value < min && v.fixed === null) {
            movement += min - v.value;
            v.value = min;
          }
        }
    if (movement < 0.01) break;
  }

  for (const n of items)
    pos.set(n.id, {
      x: round(center('x', n.id) - n.w / 2),
      y: round(center('y', n.id) - n.h / 2),
    });

  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i],
        b = items[j],
        pa = pos.get(a.id)!,
        pb = pos.get(b.id)!;
      if (
        pa.x + a.w > pb.x + 0.1 &&
        pb.x + b.w > pa.x + 0.1 &&
        pa.y + a.h > pb.y + 0.1 &&
        pb.y + b.h > pa.y + 0.1
      )
        diagnostics.push({
          level: 'error',
          code: 'overlap',
          message: `${a.id} overlaps ${b.id}. Release a pin or give ${scope} more room.`,
          ids: [a.id, b.id],
        });
    }
  for (const h of required) {
    const a = by.get(h.id)!,
      b = by.get(h.ref)!,
      p = pos.get(a.id)!,
      q = pos.get(b.id)!;
    const distance =
      h.side === 'right'
        ? p.x - q.x - b.w
        : h.side === 'left'
          ? q.x - p.x - a.w
          : h.side === 'below'
            ? p.y - q.y - b.h
            : q.y - p.y - a.h;
    if (distance < h.gap - 0.5)
      diagnostics.push({
        level: 'error',
        code: 'unsatisfied-near',
        message: `Required: ${h.id} ${h.side} of ${h.ref} is not satisfied.`,
        line: h.line,
        ids: [h.id, h.ref],
      });
  }
  // Soft preferences may give way; say which ones did and by how much.
  for (const [id, { pos: want, hint }] of intended) {
    if (pins.has(id) || (hint.type === 'near' && hint.strength === 'required')) continue;
    const got = pos.get(id)!,
      moved = Math.round(Math.hypot(got.x - want.x, got.y - want.y));
    // A few pixels is layout settling; more means the line no longer says where the object is.
    if (moved >= 2)
      diagnostics.push({
        level: moved >= RELAXED_WARNING ? 'warning' : 'info',
        code: 'relaxed',
        message: `${hint.type} ${id} gave way by ${moved} px to keep ${scope} clear.${moved >= RELAXED_WARNING ? ` Remove line ${hint.line}, or run format --drop-stale.` : ''}`,
        line: hint.line,
        ids: [id],
      });
  }
  return pos;
}

/**
 * A node drawn larger than its slot may spill past it by this share of its scope's gap, in total
 * along each axis, before the slot grows: two facing neighbours still keep half the gap, and
 * never less than `SLOT_KEEP`, the room a line between them needs.
 */
const SLOT_SPILL = 0.5,
  SLOT_KEEP = 16;
const spillOf = (gap: number) => Math.min(gap * SLOT_SPILL, Math.max(0, gap - SLOT_KEEP));

/**
 * Lay out a model. `arranged` holds world positions from layout engines; scopes that an engine
 * governs take their children's relative placement from it instead of their built-in recipe.
 *
 * Nodes are laid out on slots: their size in the reference appearance (the default theme, with
 * the file's own overrides), so a theme switch keeps rows, order and positions. Each node is drawn
 * at its theme's size in its slot. A slot grows only where the theme's size is larger
 * than the scope's gap can absorb (`SLOT_SPILL`), or where spilling would bring two boxes closer
 * than `MIN_GAP`. With `slots`, objects come out at their slot size (the engines' input).
 */
export function layoutModel(m: Model, arranged?: Map<string, Pos & Size>, slots = false): Scene {
  // The engines' input (`slots`) has no channels: they are planned on the final arrangement.
  if (slots) return layoutPass(m, arranged, true);
  // A `near` whose reference sits inside a sibling group places against that group, lined up
  // with the reference as the drawing without those lines has it.
  const by = new Map(m.objects.map(o => [o.id, o])),
    across = m.hints.filter(
      (h): h is Extract<Hint, { type: 'near' }> =>
        h.type === 'near' && nearAnchor(by, h.id, h.ref) !== h.ref,
    );
  if (across.length) {
    const first = layoutModel(
      { ...m, hints: m.hints.filter(h => !across.includes(h as never)) },
      arranged,
    );
    const centre = (id: string, axis: 'x' | 'y') => {
      const o = first.byId.get(id)!;
      return axis === 'x' ? o.x + o.w / 2 : o.y + o.h / 2;
    };
    const hints = m.hints.map(h => {
      if (!across.includes(h as never) || h.type !== 'near') return h;
      const anchor = nearAnchor(by, h.id, h.ref)!,
        axis = h.side === 'left' || h.side === 'right' ? 'y' : 'x';
      return { ...h, ref: anchor, offset: h.offset + centre(h.ref, axis) - centre(anchor, axis) };
    });
    return layoutModel({ ...m, hints }, arranged);
  }
  // Plan routing channels on the arrangement before refinements, so a pin, drag or nudge never
  // changes the room left for lines elsewhere; then lay out with them.
  const unrefined = { ...m, hints: m.hints.filter(h => h.type === 'size' || h.type === 'order') },
    planned = layoutPass(unrefined, arranged),
    // Which groups fold is decided on the arrangement before refinements too, so a stay or pin
    // never folds or unfolds a group.
    plain = planned,
    packFold = packFolds.get(plain),
    area = (objects: SceneObject[]) =>
      (Math.max(...objects.map(o => o.x + o.w)) - Math.min(...objects.map(o => o.x))) *
      (Math.max(...objects.map(o => o.y + o.h)) - Math.min(...objects.map(o => o.y))),
    channels = trimChannels(
      planChannels(plain.objects, m.edges, m.routing),
      area(plain.objects),
      c => area(layoutPass(unrefined, arranged, false, c, packFold).objects),
    );
  return layoutPass(m, arranged, false, channels.size ? channels : undefined, packFold);
}

/** The groups a packed drawing folds, and whether it wraps its own run into rows. */
interface PackFold {
  groups: Set<string>;
  wrap: boolean;
}
/** The fold decision each pass made, so later passes of one layout can reuse it. */
const packFolds = new WeakMap<Scene, PackFold>();

function layoutPass(
  m: Model,
  arranged?: Map<string, Pos & Size>,
  slots = false,
  channels?: Map<string, Channel>,
  packFold?: PackFold,
): Scene {
  /** Only directed, constraining edges impose a reading order. Engines still see undirected links. */
  const ranking = m.edges.filter(e => e.constraint !== false && e.directed !== false);
  const diagnostics: Diagnostic[] = [],
    children = new Map<string, ModelObject[]>([['root', []]]);
  for (const o of m.objects) {
    if (!children.has(o.parent)) children.set(o.parent, []);
    children.get(o.parent)!.push(o);
  }
  const look = resolveAppearance(m.appearance),
    header = look.groupHeader,
    /** Groups whose title wraps, and to how many lines. */
    titleLines = new Map<string, number>(),
    ref =
      look.theme === DEFAULT_THEME
        ? look
        : resolveAppearance({ ...m.appearance, theme: DEFAULT_THEME });
  /** The size each node is drawn at, where it differs from its slot. */
  const drawn = new Map<string, { w: number; h: number }>();
  /** The title band of each `cells` group, which holds no inset around its cells. */
  const cellBands = new Map<string, number>(),
    chrome = new Map<string, CellsChrome>();
  const items = new Map<string, Item>(),
    local = new Map<string, Pos>(),
    bases = new Map<string, Pos>();
  const byId = new Map(m.objects.map(o => [o.id, o]));
  /** Groups whose members follow the boxes of the sibling group named. */
  const following = new Map<string, string>();
  const immediate = (id: string, scope: string) => {
    let o = byId.get(id);
    while (o && o.parent !== scope) o = byId.get(o.parent);
    return o?.id;
  };

  const folds: Array<{ scope: string; fold: Fold }> = [],
    flows: FlowScope[] = [];
  /** Packed groups that fold their own long runs, and whether the drawing wraps: see below. */
  const foldGroups = new Set<string>(packFold?.groups);
  let wrapRoot = packFold?.wrap ?? false;
  // A decision: a diamond, or any node whose branches are labelled, with two or more ways out.
  const decisionsIn = (scope: string) => {
    const outs = new Map<string, ModelEdge[]>();
    for (const e of ranking) {
      const a = immediate(e.source, scope);
      if (a && immediate(e.target, scope) !== a) outs.set(a, [...(outs.get(a) ?? []), e]);
    }
    return new Set(
      [...outs]
        .filter(
          ([id, out]) =>
            out.length > 1 &&
            (byId.get(id)!.shape === 'diamond' || out.filter(e => e.label).length > 1),
        )
        .map(([id]) => id),
    );
  };

  // Scopes an engine arranges that hold groups, and every group inside one, are packed tight.
  const pairsIn = (scope: string) =>
    ranking
      .map(e => [immediate(e.source, scope), immediate(e.target, scope)] as const)
      .filter((p): p is [string, string] => !!p[0] && !!p[1] && p[0] !== p[1]);
  /**
   * A scope's pairs for ranking a packed scope, less the returns of its cycles. Groups lift their
   * members' edges, so a node that a group's member feeds and that feeds another member forms a
   * cycle with the group. Breaking it in declaration order can rank the whole group after that
   * node, and the group's entry edge then runs across the drawing. Instead each sibling enters
   * where its first member ranks among all the scope's nodes, and a pair in a cycle that runs
   * back to an earlier entry is the return.
   */
  const rankPairsIn = (scope: string, ids: string[], pairs: Array<[string, string]>) => {
    const within = (id: string) => immediate(id, scope) !== undefined;
    const inner = m.objects.filter(o => within(o.id)).map(o => o.id),
      rank = new Map(
        rankLayers(
          inner,
          ranking.filter(e => within(e.source) && within(e.target)).map(e => [e.source, e.target]),
        ).flatMap((layer, i) => layer.map(id => [id, i] as const)),
      );
    const entry = new Map(ids.map(id => [id, Infinity]));
    for (const id of inner) {
      const k = immediate(id, scope)!;
      entry.set(k, Math.min(entry.get(k)!, rank.get(id)!));
    }
    const reaches = (from: string, to: string) => {
      const seen = new Set([from]),
        todo = [from];
      while (todo.length) {
        const v = todo.pop()!;
        if (v === to) return true;
        for (const [a, b] of pairs)
          if (a === v && !seen.has(b)) {
            seen.add(b);
            todo.push(b);
          }
      }
      return false;
    };
    return pairs.filter(([a, b]) => !(entry.get(b)! < entry.get(a)! && reaches(b, a)));
  };
  const packEngine = (scope: string) => {
    const governing = arranged && governingLayout(m, scope),
      kids = children.get(scope) ?? [];
    if (!governing?.engine || !PACKED_ENGINES.has(governing.engine.algorithm)) return undefined;
    // Soft groups are packed too, so their members can be kept side by side in each rank.
    if (scope === 'root' && !kids.some(k => k.type === 'group' || k.soft?.length)) return undefined;
    if (!kids.every(k => arranged!.has(k.id))) return undefined;
    return LayoutLab.settings({
      algorithm: governing.engine.algorithm,
      ...governing.engine.params,
    });
  };
  // One group gap for the whole drawing: the engines' group gap, or wider for the most lines that
  // cross one rank gap of a packed scope, so lines passing between groups keep their pitch.
  let groupGap = 0,
    lines = 0;
  for (const scope of children.keys()) {
    const s = packEngine(scope);
    if (!s) continue;
    groupGap = Math.max(groupGap, s.groupGap);
    const pairs = pairsIn(scope),
      rank = new Map(
        rankLayers(
          (children.get(scope) ?? []).map(k => k.id),
          pairs,
        ).flatMap((layer, i) => layer.map(id => [id, i] as const)),
      ),
      ranks = Math.max(0, ...rank.values());
    for (let i = 0; i < ranks; i++)
      lines = Math.max(
        lines,
        pairs.filter(
          ([a, b]) =>
            Math.min(rank.get(a)!, rank.get(b)!) <= i && Math.max(rank.get(a)!, rank.get(b)!) > i,
        ).length,
      );
  }
  groupGap = Math.min(MAX_GROUP_GAP, Math.max(groupGap, (lines + 1) * (m.routing.edgeGap ?? 16)));

  /** The direction a scope's own layout reads along. */
  function readsAlong(scope: string): 'right' | 'down' {
    const governing = arranged && governingLayout(m, scope);
    if (governing?.engine) return axisOf(governing);
    const own = layoutFor(m, scope);
    return own.algorithm === 'row' ? 'right' : own.algorithm === 'column' ? 'down' : axisOf(own);
  }

  /**
   * Swim lanes: each top-level group is a band across the reading direction, and everything in a
   * lane takes its rank from the connections of the whole drawing, so a rank is one column across
   * every lane. In each lane, a rank's objects stack across it, centred on the lane. Lanes share
   * one length and sit side by side; refinements inside a lane do not apply.
   */
  function swimLanes(list: Item[], layout: ModelLayout) {
    const right = axisOf(layout) === 'right',
      rankGap = Math.max(layout.gap, LANE_RANK_GAP);
    const laneOf = new Map<string, string>();
    for (const lane of list) for (const k of children.get(lane.id) ?? []) laneOf.set(k.id, lane.id);
    const ids = [...laneOf.keys()],
      size = (id: string) => drawn.get(id) ?? items.get(id)!,
      major = (id: string) => (right ? size(id).w : size(id).h),
      minor = (id: string) => (right ? size(id).h : size(id).w);
    const owner = (id: string) => {
      let o = byId.get(id);
      while (o && !laneOf.has(o.id)) o = byId.get(o.parent);
      return o?.id;
    };
    const pairs = ranking
      .map(e => [owner(e.source), owner(e.target)] as const)
      .filter((p): p is [string, string] => !!p[0] && !!p[1] && p[0] !== p[1]);
    const layers = ids.length ? byBarycenter(rankLayers(ids, pairs), pairs) : [];
    const rank = new Map(layers.flatMap((layer, i) => layer.map(id => [id, i] as const)));
    // Rank columns, each as long as its longest object, with room for the labels between them.
    const longest = layers.map(layer => Math.max(...layer.map(major))),
      starts: number[] = [];
    let at = 0;
    for (const [i, layer] of layers.entries()) {
      starts.push(at);
      let after = rankGap;
      for (const e of m.edges) {
        const a = rank.get(owner(e.source) ?? ''),
          b = rank.get(owner(e.target) ?? '');
        if (e.label && a !== undefined && b !== undefined && Math.min(a, b) === i && a !== b) {
          const r = labelRoom('', '', e.label, look);
          after = Math.max(after, right ? r.w : r.h);
        }
      }
      at += longest[i] + (layer === layers.at(-1) ? 0 : after);
    }
    const length = at;
    const depth = new Map<string, number>();
    for (const lane of list) {
      const per = layers.map(layer => layer.filter(id => laneOf.get(id) === lane.id)),
        stack = (stacked: string[]) =>
          stacked.reduce((sum, id, j) => sum + minor(id) + (j ? LANE_STACK_GAP : 0), 0),
        deep = Math.max(EMPTY_LANE, ...per.map(stack));
      depth.set(lane.id, deep);
      per.forEach((stacked, r) => {
        let across = (deep - stack(stacked)) / 2;
        for (const id of stacked) {
          const along = starts[r] + (longest[r] - major(id)) / 2,
            p = right ? { x: along, y: across } : { x: across, y: along };
          local.set(id, { x: round(p.x), y: round(p.y) });
          bases.set(id, p);
          across += minor(id) + LANE_STACK_GAP;
        }
      });
    }
    // Every lane is as long as the drawing; each one is wide enough for its title.
    const title = (l: Item) =>
        Math.ceil(measureText(l.label, look.groupTitle)) + GROUP_TITLE_CHROME,
      span = Math.max(length + 2 * GROUP_INSET, ...list.map(title));
    let next = 0;
    for (const lane of list) {
      const deep = depth.get(lane.id)!;
      lane.w = right ? span : Math.max(deep + 2 * GROUP_INSET, title(lane));
      lane.h = header + (right ? deep : length) + GROUP_INSET;
      const p = right ? { x: 0, y: next } : { x: next, y: 0 };
      local.set(lane.id, p);
      bases.set(lane.id, p);
      next += (right ? lane.h : lane.w) + LANE_GAP;
    }
    const total = Math.max(0, next - LANE_GAP);
    return right
      ? { w: list.length ? span : 0, h: total }
      : { w: total, h: list.length ? header + length + GROUP_INSET : 0 };
  }

  function arrange(scope: string): { w: number; h: number } {
    const layout = layoutFor(m, scope),
      order = m.hints.find(h => h.type === 'order' && h.scope === scope);
    let kids = children.get(scope) ?? [];
    if (order?.type === 'order') {
      const listed = order.ids.flatMap(id => kids.filter(k => k.id === id));
      kids = [...listed, ...kids.filter(k => !order.ids.includes(k.id))];
    }
    if (layout.algorithm === 'cells') return arrangeCells(scope, kids, layout);
    // Theme size and reference size of each leaf; the slot is chosen below.
    const leaves = new Map<string, { look: Size; ref: Size }>();
    const list: Item[] = kids.map(o => {
      let size: { w: number; h: number };
      if (o.type === 'group') {
        // Bottom-up: the group's content is already placed in its own coordinates, so the frame
        // is that box plus the same inset on every side, and never feeds back into the content.
        // Only the title or an explicit minimum can make it larger.
        const sub = arrange(o.id),
          own = layoutFor(m, o.id),
          empty = !children.get(o.id)?.length,
          band = cellBands.get(o.id);
        size =
          band !== undefined
            ? {
                w: Math.max(sub.w, own.minWidth),
                h: Math.max(sub.h + band, own.minHeight),
              }
            : (() => {
                const inner = Math.max(
                    empty ? EMPTY_GROUP.w : 0,
                    sub.w + GROUP_INSET + (channels?.get(o.id)?.right ?? GROUP_INSET),
                    own.minWidth,
                  ),
                  title = titleFit(o.label, inner, look);
                if (title.lines > 1) titleLines.set(o.id, title.lines);
                return {
                  w: Math.max(inner, title.w),
                  h: Math.max(
                    empty ? EMPTY_GROUP.h : 0,
                    sub.h +
                      groupHeaderFor(look, title.lines) +
                      (channels?.get(o.id)?.bottom ?? GROUP_INSET),
                    own.minHeight,
                  ),
                };
              })();
      } else {
        const hint = m.hints.find(h => h.type === 'size' && h.id === o.id);
        const leaf = leafSize(o, hint?.type === 'size' ? hint : undefined, look);
        size = leaf;
        if (ref !== look) {
          const r = leafSize(o, hint?.type === 'size' ? hint : undefined, ref);
          leaves.set(o.id, {
            look: { w: round(leaf.w), h: round(leaf.h) },
            ref: { w: round(r.w), h: round(r.h) },
          });
        }
        if (o.shape === 'diamond' && !hint && leaf.w > defaultShapeSize('diamond').w * BIG_DIAMOND)
          diagnostics.push({
            level: 'info',
            code: 'big-diamond',
            message: `${o.id}'s question makes its diamond ${round(leaf.w)}px square, much larger than the shapes around it. Shorten the question, or move the detail onto its edges' labels.`,
            line: o.line,
            ids: [o.id],
          });
        if (leaf.overflow)
          diagnostics.push({
            level: 'warning',
            code: 'text-overflow',
            message: `${o.id}'s title does not fit in its requested size. Make it larger or remove the size line.`,
            line: hint?.line,
            ids: [o.id],
          });
      }
      const item = { ...o, w: round(size.w), h: round(size.h) };
      items.set(o.id, item);
      return item;
    });
    if (scope === 'root' && layout.algorithm === 'lanes') return swimLanes(list, layout);
    const pairs = pairsIn(scope);
    // Every line with an end in this scope, for the room the gaps it runs through need.
    // Only a group's gaps widen: the drawing's own gaps are already as wide as a group gap. A
    // line to or from outside the group runs through its gaps only when the group reads the same
    // way as the scope around it; across it, the line arrives from the side.
    const parentOf = byId.get(scope)?.parent,
      sameWay = parentOf !== undefined && readsAlong(parentOf) === readsAlong(scope);
    const lines: ScopeLine[] = (scope === 'root' ? [] : m.edges).flatMap(e => {
      const a = immediate(e.source, scope),
        b = immediate(e.target, scope);
      if ((!a && !b) || a === b || (!(a && b) && !sameWay)) return [];
      return [{ a, b, label: e.label && !(a && b) ? edgeLabelSize(e.label, look) : undefined }];
    });
    // Label rooms are measured on the reference appearance too; a theme's label may use up to
    // one `LABEL_RUN` of the line beside it before the room grows.
    // Each member's neighbours outside the scope, for ordering members with no edge inside it.
    const outside = new Map<string, string[]>();
    for (const e of ranking) {
      const a = immediate(e.source, scope),
        b = immediate(e.target, scope);
      if (a && !b) outside.set(a, [...(outside.get(a) ?? []), e.target]);
      if (b && !a) outside.set(b, [...(outside.get(b) ?? []), e.source]);
    }
    // A group's members that each face one box in a sibling group placed before it follow that
    // box's centre across the reading direction, so the lines between the two run straight; the
    // scope around them then lines the two frames up by their first pair (`anchor`).
    const across = (id: string, right: boolean) => {
      const p = local.get(id)!,
        s = drawn.get(id) ?? items.get(id)!;
      return right ? p.y + s.h / 2 : p.x + s.w / 2;
    };
    const follow = new Map<string, number>(),
      parent = byId.get(scope)?.parent,
      siblings = (parent !== undefined && children.get(parent)) || [],
      faced = list.map(n => outside.get(n.id) ?? []),
      holder = faced[0]?.length === 1 ? byId.get(faced[0][0])?.parent : undefined,
      earlier = siblings.findIndex(o => o.id === holder) < siblings.findIndex(o => o.id === scope);
    if (
      holder !== undefined &&
      holder !== scope &&
      siblings.some(o => o.id === holder) &&
      earlier &&
      faced.every(o => o.length === 1 && byId.get(o[0])?.parent === holder && local.has(o[0]))
    )
      for (const [i, n] of list.entries())
        follow.set(n.id, across(faced[i][0], readsAlong(holder) === 'right'));
    const anchor = (a: string, b: string) => {
      if (following.get(b) !== a) return undefined;
      const right = readsAlong(scope) === 'right',
        head = (g: string) => (right ? groupHeaderFor(look, titleLines.get(g)) : GROUP_INSET),
        joins = m.edges.filter(
          e => byId.get(e.source)?.parent === a && byId.get(e.target)?.parent === b,
        );
      const first = joins.sort((x, y) => across(x.target, right) - across(y.target, right))[0];
      return first
        ? head(a) + across(first.source, right) - head(b) - across(first.target, right)
        : undefined;
    };
    const rooms = m.edges.flatMap(e => {
      const a = immediate(e.source, scope),
        b = immediate(e.target, scope);
      if (!e.label || !a || !b || a === b) return [];
      const own = labelRoom(a, b, e.label, look);
      if (ref === look) return [own];
      const r = labelRoom(a, b, e.label, ref);
      return [{ a, b, w: Math.max(r.w, own.w - LABEL_RUN), h: Math.max(r.h, own.h - LABEL_RUN) }];
    });
    const governing = arranged && governingLayout(m, scope),
      pack = packEngine(scope),
      packGaps = pack ? { node: pack.nodeGap, rank: pack.rankGap, group: groupGap } : undefined,
      ranked = pack
        ? rankPairsIn(
            scope,
            list.map(n => n.id),
            pairs,
          )
        : undefined,
      engine = governing?.engine && governing.scope === scope ? governing.engine : undefined;
    /**
     * Where each drawn box sits in its slot, and its size. The built-in recipes line a rank's
     * boxes up by their start across the reading direction (a row of a fold shares its top), so
     * there the drawn box keeps the slot's start across and is centred along. Engines place
     * centres, so there the drawn box is centred. In a downward engine layout a rank is a row:
     * the nodes on one centre line share their top, with the row's tallest box centred on the
     * line, so a wrapped title or a taller theme grows the row evenly instead of giving it
     * ragged tops. The slots stay the theme-independent reference ones.
     * Pins and stays hold the drawn box.
     */
    const offsets = (axis: 'right' | 'down', at: Map<string, Pos>) => {
      const reads =
        layout.algorithm === 'row' ? 'right' : layout.algorithm === 'column' ? 'down' : axis;
      const centre = {
        x: !!governing?.engine || reads === 'right',
        y: !!governing?.engine || reads === 'down',
      };
      const look = (n: Item) => (slots ? n : (leaves.get(n.id)?.look ?? n));
      /** Offset down from the slot's top that lines a node up with the rest of its row. */
      const rowTop = new Map<string, number>();
      if (governing?.engine && axis === 'down' && !slots) {
        // Nodes only: a group's frame is sized to its content and keeps its place. Two slots
        // share a row when they overlap down the page by over half the shorter one; the row's
        // top is the highest centred top in it.
        const nodes = list.filter(o => leaves.has(o.id) && at.has(o.id)),
          top = (n: Item) => at.get(n.id)!.y,
          centred = (n: Item) => top(n) + (n.h - look(n).h) / 2,
          shared = (a: Item, b: Item) =>
            Math.min(top(a) + a.h, top(b) + b.h) - Math.max(top(a), top(b)) >
            Math.min(a.h, b.h) / 2;
        for (const n of nodes) {
          const row = nodes.filter(o => shared(o, n));
          if (row.length > 1) rowTop.set(n.id, Math.min(...row.map(centred)) - top(n));
        }
      }
      return new Map(
        list.map(n => {
          const l = look(n);
          return [
            n.id,
            {
              x: centre.x ? (n.w - l.w) / 2 : 0,
              y: rowTop.get(n.id) ?? (centre.y ? (n.h - l.h) / 2 : 0),
              w: l.w,
              h: l.h,
            },
          ] as const;
        }),
      );
    };
    /** Lay the scope out on slots that let each drawn node spill `spill` past them. */
    const lay = (spill: Size) => {
      for (const n of list) {
        const l = leaves.get(n.id);
        if (!l) continue;
        n.w = Math.max(l.ref.w, l.look.w - spill.w);
        n.h = Math.max(l.ref.h, l.look.h - spill.h);
      }
      const laidOut = (with_: LabelRoom[]) =>
        packGaps
          ? packed(
              list,
              arranged!,
              axisOf(governing!),
              ranked!,
              with_,
              packGaps,
              scope === 'root',
              lines,
              outside,
              follow,
              anchor,
            )
          : governing?.engine && list.every(n => arranged!.has(n.id))
            ? fromEngine(list, arranged!, axisOf(governing), with_)
            : baseLayout(list, layout, pairs, with_, lines);
      // Labels that fit in a pocket on their own edge leave their gap as it is; only the gaps
      // whose labels have nowhere else to go widen.
      const plain = rooms.length ? laidOut([]) : undefined;
      const pockets = plain
        ? pocketed(
            new Map(
              list.map(n => {
                const p = plain.positions.get(n.id)!,
                  o = offsets(plain.axis, plain.positions).get(n.id)!;
                return [n.id, { x: p.x + o.x, y: p.y + o.y, w: o.w, h: o.h }];
              }),
            ),
            plain.axis,
            rooms,
          )
        : new Set<LabelRoom>();
      const base = laidOut(rooms.filter(r => !pockets.has(r)));
      let fold: Fold | undefined;
      if (
        engine
          ? !pack && engine.algorithm === 'layered' && engine.params.fold !== 'never'
          : !governing?.engine && layout.algorithm === 'flow' && layout.fold === 'auto'
      ) {
        // The fold is planned without edge labels, so a relabel keeps the bands and cuts.
        const folded = foldRanks(
          list,
          base.positions,
          base.axis,
          layout.gap,
          pairs,
          rooms,
          decisionsIn(scope),
          (plain ?? base).positions,
        );
        base.positions = folded.positions;
        fold = folded.fold;
      }
      // A packed drawing too long for its depth first folds its long groups (a second pass, see
      // below), then wraps its own ranks into rows, groups and all, like a line of text.
      const canFold = !fold && pack && governing?.engine?.params.fold !== 'never';
      if (canFold && foldGroups.has(scope)) {
        const folded = foldRanks(
          list,
          base.positions,
          base.axis,
          packGaps!.rank,
          pairs,
          rooms,
          decisionsIn(scope),
          (plain ?? base).positions,
          { fewest: 2, room: 0 },
        );
        base.positions = folded.positions;
        fold = folded.fold;
      }
      if (canFold && scope === 'root' && wrapRoot) {
        const folded = foldRanks(
          list,
          base.positions,
          base.axis,
          packGaps!.rank,
          pairs,
          rooms,
          decisionsIn(scope),
          (plain ?? base).positions,
          { aspect: PACKED_FOLD_ASPECT, fewest: 2 },
        );
        base.positions = folded.positions;
        fold = folded.fold;
      }
      // A routing channel on the left or under the title moves the content over to make room.
      const room = channels?.get(scope);
      if (room && (room.left > GROUP_INSET || room.top))
        for (const [id, p] of base.positions)
          base.positions.set(id, { x: p.x + room.left - GROUP_INSET, y: p.y + room.top });
      const off = offsets(base.axis, base.positions);
      const hints = !leaves.size
        ? m.hints
        : m.hints.map(h =>
            (h.type === 'stay' || h.type === 'pin') && off.has(h.id)
              ? { ...h, x: h.x - off.get(h.id)!.x, y: h.y - off.get(h.id)!.y }
              : h,
          );
      const pos = refine(list, base.positions, hints, scope, diagnostics, base.axis);
      if ('followed' in base && base.followed) following.set(scope, holder!);
      else following.delete(scope);
      return { base, fold, pos, off };
    };
    const drawnBox = (n: Item, at: ReturnType<typeof lay>) => {
      const p = at.pos.get(n.id)!,
        o = at.off.get(n.id)!;
      return { x: p.x + o.x, y: p.y + o.y, w: o.w, h: o.h };
    };
    const slotBox = (n: Item, at: ReturnType<typeof lay>) => ({
      ...at.pos.get(n.id)!,
      w: n.w,
      h: n.h,
    });
    // Spill into the gaps first; if that brings two drawn boxes closer than `MIN_GAP` where their
    // slots were not, lay the scope out again on slots that hold the whole drawn size.
    // An engine spaces ranks by its rank gap and neighbours by its node gap.
    const spill = !leaves.size
        ? { w: 0, h: 0 }
        : governing?.engine
          ? (() => {
              const along = spillOf(governing.engine.params.rankGap ?? 52),
                across = spillOf(governing.engine.params.nodeGap ?? 24);
              return axisOf(governing) === 'right'
                ? { w: along, h: across }
                : { w: across, h: along };
            })()
          : { w: spillOf(layout.gap), h: spillOf(layout.gap) },
      diagnosed = diagnostics.length;
    let laid = lay(spill);
    if (
      !slots &&
      (spill.w || spill.h) &&
      list.some((a, i) =>
        list
          .slice(i + 1)
          .some(
            b =>
              clearance(slotBox(a, laid), slotBox(b, laid)) >= MIN_GAP - 0.5 &&
              clearance(drawnBox(a, laid), drawnBox(b, laid)) < MIN_GAP - 0.5,
          ),
      )
    ) {
      diagnostics.length = diagnosed;
      laid = lay({ w: 0, h: 0 });
    }
    if (laid.fold) folds.push({ scope, fold: laid.fold });
    if (engine ? engine.algorithm === 'layered' : !governing?.engine && layout.algorithm === 'flow')
      flows.push({ scope, axis: laid.base.axis });
    // Drawn boxes, in this scope's coordinates. Group content starts at 0,0, so a box that spills
    // past its slot at the top or left moves the content over by that much.
    const boxes = list.map(n => drawnBox(n, laid));
    // A frame also leaves room inside its border for the soft tints round its members.
    const nest = scope === 'root' ? 0 : Math.max(0, ...list.map(n => n.soft?.length ?? 0));
    const shift =
      scope === 'root' || !list.length
        ? { x: 0, y: 0 }
        : {
            x: Math.max(0, -Math.min(...boxes.map(b => b.x))) + nest * SOFT_PAD,
            y: Math.max(0, -Math.min(...boxes.map(b => b.y))) + nest * (SOFT_PAD + SOFT_LABEL),
          };
    for (const [i, n] of list.entries()) {
      const b = boxes[i],
        o = laid.off.get(n.id)!,
        p = laid.base.positions.get(n.id)!;
      local.set(n.id, { x: round(b.x + shift.x), y: round(b.y + shift.y) });
      bases.set(n.id, { x: p.x + o.x + shift.x, y: p.y + o.y + shift.y });
      if (leaves.has(n.id)) drawn.set(n.id, { w: round(b.w), h: round(b.h) });
    }
    const extent = (a: 'x' | 'y', size: 'w' | 'h') =>
      list.length
        ? Math.max(
            ...list.map((n, i) =>
              Math.max(laid.pos.get(n.id)![a] + n[size], boxes[i][a] + boxes[i][size]),
            ),
          ) +
          shift[a] +
          nest * SOFT_PAD
        : 0;
    return { w: extent('x', 'w'), h: extent('y', 'h') };
  }
  /**
   * A `cells` group's members, edge to edge from its content origin. The cells keep this place:
   * position refinements on them are reported and ignored, and an engine moves the whole group.
   */
  function arrangeCells(scope: string, kids: ModelObject[], layout: ModelLayout) {
    if (layout.unit) return arrangeUnits(scope, kids, layout);
    const title =
        Math.ceil(measureText(byId.get(scope)!.label, look.groupTitle)) + CELLS_TITLE_CHROME,
      sizeOf = (id: string) => m.hints.find(h => h.type === 'size' && h.id === id),
      out = layoutCells(
        kids.map(o => {
          const hint = sizeOf(o.id);
          return {
            id: o.id,
            label: o.label,
            marker: o.shape === 'marker',
            ...(typeof o.span === 'number' ? { span: o.span } : {}),
            ...(hint?.type === 'size' ? { size: { width: hint.width, height: hint.height } } : {}),
          };
        }),
        {
          direction: layout.direction === 'down' ? 'down' : 'right',
          ...(layout.columns ? { columns: layout.columns } : {}),
        },
        look,
        title,
      );
    placeCells(scope, kids, out.boxes);
    cellBands.set(scope, cellsBandFor(look.groupTitle.lineHeight));
    // A marker's tail is drawn past the frame; the frame holds only the cells.
    return { w: Math.max(out.w, title), h: out.h };
  }
  /** A byte or bit layout: one width per unit, a ruler under the title band, run-on fields. */
  function arrangeUnits(scope: string, kids: ModelObject[], layout: ModelLayout) {
    const out = layoutUnits(
        kids.map(o => ({
          id: o.id,
          label: o.label,
          marker: false,
          ...(typeof o.span === 'number' ? { span: o.span } : {}),
          open: o.span === 'var',
        })),
        {
          unit: layout.unit!,
          ruler: layout.ruler !== false,
          ...(layout.columns ? { columns: layout.columns } : {}),
          ...(layout.unitWidth ? { unitWidth: layout.unitWidth } : {}),
        },
        look,
      ),
      band = cellsBandFor(look.groupTitle.lineHeight),
      top = band + (out.ruler?.h ?? 0);
    placeCells(scope, kids, out.boxes);
    cellBands.set(scope, top);
    chrome.set(scope, {
      ...(out.ruler ? { ruler: { y: band, ...out.ruler } } : {}),
      ...(out.pieces.size
        ? {
            pieces: Object.fromEntries(
              [...out.pieces].map(([id, list]) => [id, list.map(r => ({ ...r, y: r.y + top }))]),
            ),
          }
        : {}),
      ...(out.open.length ? { open: out.open } : {}),
    });
    return { w: out.w, h: out.h };
  }
  function placeCells(
    scope: string,
    kids: ModelObject[],
    boxes: Map<string, { x: number; y: number; w: number; h: number }>,
  ) {
    for (const o of kids) {
      const b = boxes.get(o.id)!;
      items.set(o.id, { ...o, w: round(b.w), h: round(b.h) });
      local.set(o.id, { x: round(b.x), y: round(b.y) });
      bases.set(o.id, { x: b.x, y: b.y });
      const moved = m.hints.find(
        h => POSITION_HINTS.includes(h.type) && 'id' in h && h.id === o.id,
      );
      if (moved)
        diagnostics.push({
          level: 'warning',
          code: 'cell-position',
          message: `${o.id} is a cell of ${scope}, so it stays in its place. Move ${scope} instead, or reorder its cells with order.`,
          line: moved.line,
          ids: [o.id],
        });
    }
  }
  // A packed drawing whose run is more than `PACKED_FOLD_ASPECT` times its depth is laid out
  // again with its longest group folded, one group at a time, so the groups keep their order along
  // the reading direction. Only a drawing still too long once no group can fold wraps its groups
  // into rows.
  const diagnosed = diagnostics.length,
    rootLayout = packEngine('root') && governingLayout(m, 'root');
  let size = arrange('root');
  if (!packFold && rootLayout && rootLayout.engine?.params.fold !== 'never') {
    const right = axisOf(rootLayout) === 'right',
      along = (o: Size) => (right ? o.w : o.h),
      across = (o: Size) => (right ? o.h : o.w);
    const room = right ? RENDER_CONTEXT.width : RENDER_CONTEXT.height,
      tooLong = (o: Size) => along(o) > room && along(o) > PACKED_FOLD_ASPECT * across(o);
    while (tooLong(size) && !wrapRoot) {
      const next = [...items.values()]
        .filter(
          o => o.type === 'group' && !foldGroups.has(o.id) && packEngine(o.id) && tooLongRun(o),
        )
        .sort((a, b) => along(b) - along(a))[0];
      if (next) foldGroups.add(next.id);
      else wrapRoot = true;
      diagnostics.length = diagnosed;
      folds.length = flows.length = 0;
      drawn.clear();
      size = arrange('root');
    }
    /** A group whose content runs more than `FOLD_ASPECT` times its depth. */
    function tooLongRun(o: Size) {
      return along(o) > FOLD_ASPECT * across(o);
    }
  }

  // In a drawing that reads down, a group whose chain is much taller than every other column folds
  // into side-by-side columns, the tallest first, while that makes the whole drawing smaller.
  // (Reading right, folding a long group turns it into rows, which reads worse; the length check
  // above covers that case.)
  if (
    !packFold &&
    rootLayout &&
    axisOf(rootLayout) === 'down' &&
    rootLayout.engine?.params.fold !== 'never'
  ) {
    const along = (o: Size) => o.h,
      area = (o: Size) => o.w * o.h;
    for (;;) {
      const tops = (children.get('root') ?? [])
          .map(o => items.get(o.id)!)
          .filter(Boolean)
          .sort((a, b) => along(b) - along(a)),
        [tall, next] = tops;
      if (
        !tall ||
        !next ||
        tall.type !== 'group' ||
        tall.fold === 'never' ||
        foldGroups.has(tall.id) ||
        !packEngine(tall.id) ||
        along(tall) < TALL_GROUP * along(next)
      )
        break;
      const before = size;
      foldGroups.add(tall.id);
      diagnostics.length = diagnosed;
      folds.length = flows.length = 0;
      drawn.clear();
      size = arrange('root');
      if (area(size) < area(before)) continue;
      foldGroups.delete(tall.id);
      diagnostics.length = diagnosed;
      folds.length = flows.length = 0;
      drawn.clear();
      arrange('root');
      break;
    }
  }

  const objects: SceneObject[] = [];
  const place = (scope: string, origin: Pos, depth: number) => {
    for (const o of children.get(scope) ?? []) {
      const item = drawn.get(o.id) ?? items.get(o.id)!,
        l = local.get(o.id)!,
        b = bases.get(o.id)!;
      const box: SceneObject = {
        ...o,
        x: origin.x + l.x,
        y: origin.y + l.y,
        w: item.w,
        h: item.h,
        localX: l.x,
        localY: l.y,
        baseX: round(b.x),
        baseY: round(b.y),
        depth,
        ...(titleLines.has(o.id) ? { titleLines: titleLines.get(o.id) } : {}),
      };
      objects.push(box);
      if (o.type === 'group')
        place(
          o.id,
          cellBands.has(o.id)
            ? { x: box.x, y: box.y + cellBands.get(o.id)! }
            : contentOrigin(box, groupHeaderFor(look, box.titleLines)),
          depth + 1,
        );
    }
  };
  place('root', { x: 0, y: 0 }, 0);
  const lanes = wrapLanes(
    folds,
    m.edges,
    new Map(objects.map(o => [o.id, o])),
    immediate,
    Math.max(m.routing.portGap ?? 16, m.routing.edgeGap ?? 16),
  );
  // Returns and skips within a band take lanes outside it; fold wraps keep theirs.
  for (const [id, lane] of returnLanes(
    flows.map(f => ({ ...f, bands: folds.find(x => x.scope === f.scope)?.fold.bands })),
    m.edges,
    new Map(objects.map(o => [o.id, o])),
    new Set(lanes.keys()),
    label => edgeLabelSize(label, look),
  ))
    lanes.set(id, lane);
  // Report groups that are larger than their requested size because of their content.
  for (const l of m.layouts) {
    const g = objects.find(o => o.id === l.scope);
    if (!g || (!l.minWidth && !l.minHeight)) continue;
    if ((l.minWidth && g.w > l.minWidth + 0.5) || (l.minHeight && g.h > l.minHeight + 0.5))
      diagnostics.push({
        level: 'info',
        code: 'group-grew',
        message: `${g.id} needs at least ${g.w}×${g.h} for its contents.`,
        line: l.line,
        ids: [g.id],
      });
  }
  diagnostics.push(...paletteNotes(m), ...legendNotes(m));
  for (const w of m.warnings) diagnostics.push({ level: 'warning', ...w, ids: [] });
  // Keep declaration order so output is stable regardless of the arrangement order.
  const index = new Map(m.objects.map((o, i) => [o.id, i]));
  objects.sort((a, b) => index.get(a.id)! - index.get(b.id)!);
  const scene: Scene = {
    model: m,
    title: m.title,
    objects,
    byId: new Map(objects.map(o => [o.id, o])),
    edges: m.edges.map(e => (lanes.has(e.id) ? { ...e, lane: lanes.get(e.id) } : e)),
    diagnostics,
    look,
    cells: chrome,
  };
  packFolds.set(scene, { groups: foldGroups, wrap: wrapRoot });
  return scene;
}
