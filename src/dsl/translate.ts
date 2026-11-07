/**
 * Translate one committed editor edit into source statements.
 *
 * The editor works on a projected `Diagram`. When an edit is committed, the document before and
 * after it are compared and the supported differences become targeted source changes: model edits
 * become declarations, and moves become relative preferences. Geometry the translator does not
 * write snaps back when the source is reprojected, so nothing unsaved looks saved. Changes the
 * file cannot express are rejected outright.
 */
import type { ColorDefinition, DiagramAppearance } from '../model/appearance';
import { findNode, isCell, selectionRoots } from '../model/graph';
import { groupHeaderFor } from '../model/labels';
import type { ColorKey, Diagram, DiagramEdge, DiagramNode, PortSide, Rect } from '../model/types';
import { contentOrigin, layoutView, type Scene } from './compile';
import {
  addRefinement,
  bare,
  clearPosition,
  declaration,
  edgeStatement,
  getAttr,
  insertAfter,
  layoutStatement,
  num,
  quoted,
  removeEdge,
  removeReferences,
  removeWhere,
  setAttr,
  statement,
  statements,
} from './source-edits';
import { sourceOperations, type SourceOperation } from './operations';
import {
  DSL_SHAPES,
  isIdentifier,
  POSITION_HINTS,
  printSource,
  readSource,
  THEME_ATTRS,
  type NearSide,
  type SourceDoc,
  type Statement,
  type Word,
} from './syntax';

export class UnsupportedEdit extends Error {}

export interface EditInput {
  source: SourceDoc;
  scene: Scene;
  before: Diagram;
  after: Diagram;
  label: string;
  /** Selected ids when the edit was committed; moves and resizes apply to these. */
  selection: string[];
  /**
   * How a moved object is kept: `near` (the default) places it relative to the neighbour it was
   * dropped by, or nudges it; `stay` keeps it exactly where it was dropped, as a soft `stay`.
   * Either way its neighbours are anchored, and a pinned object moves its pin.
   */
  drag?: DragTranslation;
  /**
   * Give a new object or connection its id. Without it ids are made from labels; with it they
   * never are. The id must be an identifier that `taken` does not report.
   */
  newId?: (request: NewIdRequest) => string;
}

export type DragTranslation = 'stay' | 'near';

/** A new object or connection that needs an id in the source. */
export interface NewIdRequest {
  kind: 'node' | 'group' | 'edge';
  /** A node's or group's title, or a connection's label (often empty). */
  label: string;
  /** A connection's ends, as source ids. */
  from?: string;
  to?: string;
  /** Whether an id is already used in the source, or by an earlier new object in this edit. */
  taken: (id: string) => boolean;
}

export interface EditResult {
  source: SourceDoc;
  /** Editor ids of new objects and connections, mapped to their ids in the source. */
  ids: Map<string, string>;
  /** Short descriptions of saved refinements, for the status message. */
  notes: string[];
  /** Objects a move placed `near` a neighbour, with where they were dropped. */
  drops: Drop[];
  /**
   * The statements the edit added, removed and changed, for a host that keeps the diagram as its
   * own records. A file save ignores them: `source` is the whole result.
   */
  operations: SourceOperation[];
}

/** A dropped object: where it was let go in the drawing, and that point in its parent. */
export interface Drop {
  id: string;
  x: number;
  y: number;
  local: { x: number; y: number };
}

/** Replace the `near` of each dropped object with a `stay` at the exact point it was dropped. */
export function keepDropped(source: SourceDoc, drops: Drop[]) {
  for (const d of drops) {
    clearPosition(source, d.id);
    addRefinement(
      source,
      statement(
        'stay',
        [bare(d.id)],
        [
          ['x', num(Math.max(0, d.local.x))],
          ['y', num(Math.max(0, d.local.y))],
        ],
      ),
    );
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const objectsOf = (d: Diagram) => [...d.graph.groups, ...d.graph.nodes];

function slug(text: string, fallback: string) {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return s && /^[a-z_]/.test(s) ? s : s ? fallback + '-' + s : fallback;
}

function rejectUnsupported(before: Diagram, after: Diagram) {
  for (const e of after.graph.edges) {
    const a = before.layout.edges[e.id] ?? {},
      b = after.layout.edges[e.id] ?? {};
    if (!same(a.waypoints?.length ? a.waypoints : null, b.waypoints?.length ? b.waypoints : null))
      throw new UnsupportedEdit('Connection bends are not saved to diagram files yet.');
    if ((a.labelDx ?? 0) !== (b.labelDx ?? 0) || (a.labelDy ?? 0) !== (b.labelDy ?? 0))
      throw new UnsupportedEdit('Connection label positions are not saved to diagram files yet.');
    const old = before.graph.edges.find(x => x.id === e.id);
    if (e.emphasis || (old && old.emphasis !== e.emphasis))
      throw new UnsupportedEdit('Emphasized connections are not supported yet.');
  }
  if (!same(before.layout.labels, after.layout.labels))
    throw new UnsupportedEdit('Label positions are not saved to diagram files yet.');
  if (!same(before.layout.intent, after.layout.intent))
    throw new UnsupportedEdit('Start and end preferences are not saved to diagram files yet.');
  for (const n of after.graph.nodes) {
    const style = after.styles[n.id];
    if (n.image || style?.shape === 'image' || style?.shape === 'icon' || style?.icon)
      throw new UnsupportedEdit('Images and icons are not saved to diagram files yet.');
    if (style && !DSL_SHAPES.includes(style.shape as never))
      throw new UnsupportedEdit(`The ${style.shape} shape is not supported in diagram files.`);
  }
}

export function translateEdit(input: EditInput): EditResult {
  const { source, scene, before, after } = input;
  rejectUnsupported(before, after);
  const original = printSource(source);
  const ids = new Map<string, string>(),
    notes: string[] = [],
    taken = new Set([...scene.objects.map(o => o.id), ...scene.edges.map(e => e.id), 'root']);
  const fresh = (
    text: string,
    fallback: 'node' | 'group' | 'edge',
    ends?: { from: string; to: string },
  ) => {
    if (input.newId) {
      const id = input.newId({ kind: fallback, label: text, ...ends, taken: x => taken.has(x) });
      if (!isIdentifier(id) || taken.has(id))
        throw new UnsupportedEdit(`The host gave a new ${fallback} an unusable id: ${id}.`);
      taken.add(id);
      return id;
    }
    const base = slug(text, fallback);
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    return id;
  };
  /** Source id for an editor id. */
  const sid = (id: string) => ids.get(id) ?? id;
  const parentOf = (d: Diagram, id: string) =>
    objectsOf(d).find(o => o.id === id)?.parentId ?? null;

  // Explicit colors decide what `color=auto` resolves to.
  const explicit = new Map<string, ColorKey>();
  for (const o of scene.model.objects) if (o.color !== 'auto') explicit.set(o.id, o.color);
  const autoColor = (editorParent: string | null): ColorKey => {
    for (let p = editorParent; p; p = parentOf(after, p)) {
      const c = explicit.get(sid(p));
      if (c) return c;
    }
    return 'auto';
  };
  const writeColor = (s: Statement, id: string, editorParent: string | null) => {
    const color = after.styles[id]?.color;
    if (!color) return;
    if (color === 'auto' || color === autoColor(editorParent)) {
      setAttr(s, 'color', undefined);
      explicit.delete(sid(id));
    } else {
      setAttr(s, 'color', bare(color));
      explicit.set(sid(id), color);
    }
  };

  // The heading, notes and key have their own lines; the rest of the appearance is the `theme` line.
  const look = (d: Diagram) => ({
    ...d.appearance,
    heading: undefined,
    notes: undefined,
    footnotes: undefined,
    legend: undefined,
  });
  if (!same(look(before), look(after))) writeAppearance(source, after.appearance);
  writeRows(source, 'note', before.appearance.notes, after.appearance.notes, (st, n) => {
    // The text is the last word: `note "text"`, or `note id "text"`, whose ID an edit keeps.
    st.args[st.args.length - 1] = quoted(n.text);
    setAttr(st, 'near', n.near ? bare(n.near) : undefined);
    setAttr(st, 'side', n.near && n.side ? bare(n.side) : undefined);
    if (!n.near) setAttr(st, 'leader', undefined);
  });
  writeRows(
    source,
    'footnote',
    before.appearance.footnotes,
    after.appearance.footnotes,
    (st, n) => {
      st.args = [...(n.mark ? [bare(n.mark)] : []), quoted(n.text)];
    },
  );
  writeRows(source, 'legend', before.appearance.legend, after.appearance.legend, (st, e) => {
    st.args[st.args.length - 1] = quoted(e.label);
  });
  // A phase's label is in its `phase` line; its messages never change on the canvas.
  const phases = new Map(before.layout.sequence?.phases.map(p => [p.id, p.label]));
  for (const p of after.layout.sequence?.phases ?? []) {
    const st = statements(source).find(x => x.command === 'phase' && x.args[0]?.value === p.id);
    if (st && phases.get(p.id) !== p.label) st.args[1] = quoted(p.label);
  }

  // Title, frame width and subtitle.
  const head = before.appearance.heading ?? {},
    next = after.appearance.heading ?? {};
  // A file without a `diagram` line has no title, whatever name the editor shows for it.
  const diagramLine = () => {
    let s = statements(source).find(x => x.command === 'diagram');
    if (!s) {
      s = statement('diagram', [quoted(head.title ?? '')], [['version', bare(1)]]);
      source.lines.unshift(s, { kind: 'blank' });
    }
    return s;
  };
  if (after.title !== before.title) diagramLine().args[0] = quoted(after.title);
  if (next.width !== head.width)
    setAttr(diagramLine(), 'width', next.width ? bare(Math.round(next.width)) : undefined);
  if (next.subtitle !== head.subtitle) {
    const s = statements(source).find(x => x.command === 'subtitle');
    if (!next.subtitle) removeWhere(source, x => x === s);
    else if (s) s.args[0] = quoted(next.subtitle);
    else {
      const d = diagramLine();
      insertAfter(source, statement('subtitle', [quoted(next.subtitle)]), x => x === d);
    }
  }

  // Removed objects and connections.
  const afterIds = new Set(objectsOf(after).map(o => o.id));
  for (const o of objectsOf(before))
    if (!afterIds.has(o.id)) {
      removeWhere(source, s => s === declaration(source, o.id));
      removeReferences(source, o.id);
    }
  const afterEdges = new Set(after.graph.edges.map(e => e.id));
  for (const e of before.graph.edges) if (!afterEdges.has(e.id)) removeEdge(source, e.id);

  // New containers (outermost first), then new shapes.
  const beforeIds = new Set(objectsOf(before).map(o => o.id));
  const depth = (id: string) => {
    let n = 0;
    for (let p = parentOf(after, id); p; p = parentOf(after, p)) n++;
    return n;
  };
  const added = [
    ...after.graph.groups
      .filter(g => !beforeIds.has(g.id))
      .sort((a, b) => depth(a.id) - depth(b.id)),
    ...after.graph.nodes.filter(n => !beforeIds.has(n.id)),
  ];
  for (const o of added) {
    const type = after.graph.groups.includes(o as never) ? 'group' : 'node';
    const id = fresh(o.title, type);
    ids.set(o.id, id);
    const s = statement(type, [bare(id), quoted(o.title)]);
    if (o.parentId) setAttr(s, 'in', bare(sid(o.parentId)));
    const shape = after.styles[o.id]?.shape;
    if (type === 'node' && shape && shape !== 'box') setAttr(s, 'shape', bare(shape));
    writeColor(s, o.id, o.parentId ?? null);
    writeShade(s, after.styles[o.id]?.shade);
    insertAfter(source, s, isDeclaration);
  }

  // Changed objects.
  for (const o of objectsOf(after)) {
    if (!beforeIds.has(o.id)) continue;
    const old = objectsOf(before).find(x => x.id === o.id)!,
      s = declaration(source, o.id);
    if (!s) continue;
    if (o.title !== old.title) s.args[1] = quoted(o.title);
    if ((o.parentId ?? null) !== (old.parentId ?? null)) {
      setAttr(s, 'in', o.parentId ? bare(sid(o.parentId)) : undefined);
      // Relative preferences are between siblings; the old ones no longer apply.
      removeWhere(
        source,
        x => x.command === 'near' && (x.args[0]?.value === o.id || x.args[1]?.value === o.id),
      );
      removeWhere(
        source,
        x => (x.command === 'align' || x.command === 'order') && x.args.some(w => w.value === o.id),
      );
    }
    const a = before.styles[o.id],
      b = after.styles[o.id];
    if (a?.color !== b?.color) writeColor(s, o.id, o.parentId ?? null);
    if (a?.shade !== b?.shade) writeShade(s, b?.shade);
    if (s.command === 'node' && a?.shape !== b?.shape)
      setAttr(s, 'shape', b.shape === 'box' ? undefined : bare(b.shape));
    const span = (o as DiagramNode).span;
    if (s.command === 'node' && span !== (old as DiagramNode).span)
      setAttr(s, 'span', span === undefined || span === 1 ? undefined : bare(span));
  }

  // Connections.
  const ports = (cfg: { fromSide?: PortSide; toSide?: PortSide } | undefined, s: Statement) => {
    setAttr(s, 'from', cfg?.fromSide && cfg.fromSide !== 'auto' ? bare(cfg.fromSide) : undefined);
    setAttr(s, 'to', cfg?.toSide && cfg.toSide !== 'auto' ? bare(cfg.toSide) : undefined);
  };
  const writeEdge = (e: DiagramEdge, s: Statement) => {
    s.args = [s.args[0], bare(sid(e.from)), bare('->'), bare(sid(e.to))];
    if (e.label) s.args.push(quoted(e.label));
    setAttr(s, 'directed', e.directed === false ? bare('false') : undefined);
    setAttr(s, 'head', e.head ? bare(e.head) : undefined);
    setAttr(s, 'tail', e.tail ? bare(e.tail) : undefined);
    const kind = getAttr(s, 'kind')?.value;
    if (e.dashed) setAttr(s, 'kind', bare('async'));
    else if (kind === 'async') setAttr(s, 'kind', undefined);
    ports(after.layout.edges[e.id], s);
  };
  const beforeEdges = new Map(before.graph.edges.map(e => [e.id, e]));
  for (const e of after.graph.edges) {
    const old = beforeEdges.get(e.id);
    if (!old) {
      const id = input.newId
        ? fresh(e.label ?? '', 'edge', { from: sid(e.from), to: sid(e.to) })
        : fresh(`${sid(e.from)}-${sid(e.to)}`, 'edge');
      ids.set(e.id, id);
      const s = statement('edge', [bare(id)]);
      writeEdge(e, s);
      if (statements(source).some(x => x.command === 'edge'))
        insertAfter(source, s, x => x.command === 'edge');
      else insertAfter(source, s, isDeclaration);
    } else if (!same(old, e) || !same(before.layout.edges[e.id], after.layout.edges[e.id])) {
      const s = edgeStatement(source, e.id);
      if (s) writeEdge(e, s);
    }
  }

  const drops: Drop[] = [];
  placeSelection(input, sid, notes, drops);
  return {
    source,
    ids,
    notes,
    drops,
    operations: sourceOperations(readSource(original), source),
  };
}

function writeShade(s: Statement, shade: number | undefined) {
  setAttr(s, 'shade', shade === undefined ? undefined : bare(shade));
}

/**
 * Rewrite the `command` statements (`note`, `legend`) whose rows changed, matched by order. Rows
 * an edit removes are taken from where the lists first differ; this never adds rows.
 */
function writeRows<T>(
  source: SourceDoc,
  command: string,
  before: readonly T[] = [],
  after: readonly T[] = [],
  write: (s: Statement, row: T) => void,
) {
  const rows = statements(source).filter(s => s.command === command);
  let old = [...before];
  if (after.length < old.length) {
    let i = 0;
    while (i < after.length && same(old[i], after[i])) i++;
    const gone = rows.splice(i, old.length - after.length);
    removeWhere(source, x => gone.includes(x));
    old = [...old.slice(0, i), ...old.slice(i + gone.length)];
  }
  after.forEach((row, i) => {
    if (rows[i] && !same(old[i], row)) write(rows[i], row);
  });
}

const colorKey = (s: Statement) => `${s.args[0]?.value}:${getAttr(s, 'shade')?.value ?? 500}`;

/**
 * Write a diagram appearance as the file's `theme` line and `theme-color` statements. Statements
 * for colors that are no longer defined are removed; the rest are updated in place, so comments
 * next to them stay.
 */
export function writeAppearance(source: SourceDoc, appearance: DiagramAppearance) {
  let theme = statements(source).find(s => s.command === 'theme');
  if (!theme) {
    theme = statement('theme', [bare(appearance.theme)]);
    const diagram = statements(source).find(s => s.command === 'diagram');
    const at = diagram ? source.lines.indexOf(diagram) + 1 : 0;
    source.lines.splice(at, 0, theme, ...(diagram ? [] : [{ kind: 'blank' as const }]));
  }
  theme.args = [bare(appearance.theme)];
  for (const [attr, key] of Object.entries(THEME_ATTRS)) {
    const value = appearance.overrides[key];
    setAttr(
      theme,
      attr,
      value === undefined
        ? undefined
        : typeof value === 'number'
          ? bare(value)
          : key === 'titleFont' || key === 'annotationFont'
            ? bare(value)
            : quoted(value),
    );
  }
  const wanted = new Map<string, ColorDefinition>(
    appearance.colors.map(c => [`${c.family}:${c.shade}`, c]),
  );
  removeWhere(source, s => s.command === 'theme-color' && !wanted.has(colorKey(s)));
  for (const [key, c] of wanted) {
    let s = statements(source).find(x => x.command === 'theme-color' && colorKey(x) === key);
    if (!s) {
      s = statement('theme-color', [bare(c.family)], [['shade', bare(c.shade)]]);
      insertAfter(source, s, x => x.command === 'theme' || x.command === 'theme-color');
    }
    for (const field of ['fill', 'stroke', 'ink'] as const)
      setAttr(s, field, c[field] ? quoted(c[field]) : undefined);
  }
}

/**
 * The direction the layout around an object reads along: its parent's `layout` line, or the
 * nearest ancestor's that names one. Diagrams read down unless told otherwise.
 */
function readsAlong(source: SourceDoc, parentOf: (id: string) => string) {
  return (id: string): 'right' | 'down' => {
    for (let p = parentOf(id); ; p = parentOf(p)) {
      const s = layoutStatement(source, p),
        algorithm = s?.args[1]?.value,
        direction = s && getAttr(s, 'direction')?.value;
      if (algorithm === 'row' || direction === 'right') return 'right';
      if (algorithm === 'column' || direction === 'down') return 'down';
      if (p === 'root') return 'down';
    }
  };
}

/** Local rectangle of an object relative to its parent's content origin in the compiled scene. */
function localRect(scene: Scene, parent: string, r: Rect): Rect | null {
  if (parent === 'root') return { ...r };
  const p = scene.byId.get(parent);
  if (!p) return null;
  const o = contentOrigin(p, groupHeaderFor(scene.look, p.titleLines));
  return { x: r.x - o.x, y: r.y - o.y, w: r.w, h: r.h };
}

interface Candidate {
  ref: string;
  side: NearSide;
  gap: number;
  offset: number;
  score: number;
}

/**
 * The sibling an object reads next to: the nearest one it lines up with, beside it or stacked on
 * it, without overlapping it. A box beside another must share some of its height, and a box
 * stacked on another some of its width. Stacking along the reading direction wins unless a side
 * neighbour is less than half as far: a node dropped under another in a column that reads down is
 * below it, not beside the node across the gap.
 */
function nearestSibling(
  me: Rect,
  siblings: Array<{ id: string; r: Rect }>,
  reads: 'right' | 'down',
): Candidate | null {
  let best: Candidate | null = null;
  for (const { id, r } of siblings) {
    const dx = me.x + me.w / 2 - (r.x + r.w / 2),
      dy = me.y + me.h / 2 - (r.y + r.h / 2);
    const options: Candidate[] = [];
    const horizontal = dx >= 0 ? me.x - (r.x + r.w) : r.x - (me.x + me.w),
      vertical = dy >= 0 ? me.y - (r.y + r.h) : r.y - (me.y + me.h),
      sharesHeight = me.y < r.y + r.h && r.y < me.y + me.h,
      sharesWidth = me.x < r.x + r.w && r.x < me.x + me.w;
    if (horizontal >= 0 && sharesHeight)
      options.push({
        ref: id,
        side: dx >= 0 ? 'right' : 'left',
        gap: horizontal,
        offset: dy,
        score: 0,
      });
    if (vertical >= 0 && sharesWidth)
      options.push({
        ref: id,
        side: dy >= 0 ? 'below' : 'above',
        gap: vertical,
        offset: dx,
        score: 0,
      });
    for (const c of options) {
      c.gap = Math.round(c.gap);
      c.offset = Math.round(c.offset);
      c.score = c.gap + Math.abs(c.offset) * 0.6;
      if ((c.side === 'above' || c.side === 'below') !== (reads === 'down')) c.score *= 2;
      if (!best || c.score < best.score) best = c;
    }
  }
  return best && best.gap <= 2000 ? best : null;
}

/**
 * Write the order a dragged cell's group reads in after the drop: the cell goes before the first
 * other cell it now reads before, row by row. Markers stay before the cell they preceded. Returns
 * whether the order changed.
 */
function reorderCells(input: EditInput, sid: (id: string) => string, id: string) {
  const { source, scene, after } = input,
    group = sid(findNode(after, id)!.parentId!),
    kids = scene.objects.filter(o => o.parent === group),
    markers = kids.filter(o => o.shape === 'marker');
  // The compiled order: cells row by row, each marker before the cell on its seam.
  const parts = kids
    .filter(o => o.shape !== 'marker')
    .sort((a, b) => a.localY - b.localY || a.localX - b.localX);
  const following = new Map(
    markers.map(m => {
      const across = m.h > m.w,
        seam = across ? m.localX + m.w / 2 : m.localY + m.h / 2;
      return [m.id, parts.find(p => (across ? p.localX : p.localY) >= seam - 0.5)?.id];
    }),
  );
  const withMarkers = (list: string[]) => {
    const out = [...list];
    for (const m of markers) {
      const next = following.get(m.id);
      out.splice(next ? out.indexOf(next) : out.length, 0, m.id);
    }
    return out;
  };
  const current = withMarkers(parts.map(p => p.id));
  // Where the dragged cell now reads: before the first other cell it precedes.
  const at = after.layout.nodes[id],
    me = { x: at.x + at.w / 2, y: at.y + at.h / 2 };
  const others = parts.map(p => p.id).filter(p => p !== id),
    precedes = (o: string) => {
      const r = after.layout.nodes[o],
        c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      return Math.abs(c.y - me.y) < Math.min(r.h, at.h) / 2 ? me.x < c.x : me.y < c.y;
    };
  const next = others.findIndex(precedes);
  others.splice(next < 0 ? others.length : next, 0, id);
  const order = withMarkers(others);
  if (order.every((c, i) => c === current[i])) return false;
  removeWhere(source, s => s.command === 'order' && s.args[0]?.value === group);
  addRefinement(source, statement('order', [bare(group), ...order.map(c => bare(c))]));
  return true;
}

/**
 * Write the lane order a drop leaves a scope in: its participants and bands left to right as they
 * now stand. Returns whether the order changed.
 */
function reorderLanes(input: EditInput, scope: string) {
  const { source, scene, after } = input,
    lanes = scene.objects
      .filter(o => o.parent === scope && after.layout.nodes[o.id])
      .sort((a, b) => a.x - b.x)
      .map(o => o.id),
    mid = (id: string) => after.layout.nodes[id].x + after.layout.nodes[id].w / 2,
    order = [...lanes].sort((a, b) => mid(a) - mid(b));
  if (order.every((id, i) => id === lanes[i])) return false;
  removeWhere(source, s => s.command === 'order' && s.args[0]?.value === scope);
  addRefinement(source, statement('order', [bare(scope), ...order.map(id => bare(id))]));
  return true;
}

function placeSelection(
  input: EditInput,
  sid: (id: string) => string,
  notes: string[],
  drops: Drop[],
) {
  const { source, before, after, label } = input,
    // A sequence places everything in lanes, so no position would change the drawing.
    lanes = layoutStatement(source, 'root')?.args[1]?.value === 'sequence';
  let keptLane = false;
  // Positions are written in the containers that lay objects out, so soft groups drop out: a
  // moved soft group places each of its members instead, with a `stay` at its new position.
  const scene = layoutView(input.scene),
    soft = new Set(after.graph.groups.filter(g => g.frame).map(g => g.id)),
    declared = (id: string) =>
      [...after.graph.groups, ...after.graph.nodes].find(o => o.id === id)?.parentId ?? 'root';
  const parentOf = (id: string) => {
    let p = declared(id);
    while (soft.has(p)) p = declared(p);
    return p;
  };
  const roots = new Set<string>(),
    carried = new Set<string>();
  for (const id of selectionRoots(after, input.selection)) {
    // A dragged cell is a new order for its group's cells, not a position.
    if (isCell(after, id)) {
      if (reorderCells(input, sid, id))
        notes.push(`reordered ${sid(findNode(after, id)!.parentId!)}`);
      continue;
    }
    if (!soft.has(id)) {
      roots.add(id);
      continue;
    }
    for (const o of scene.objects)
      for (let p = declared(o.id); p !== 'root'; p = declared(p))
        if (p === id) {
          roots.add(o.id);
          carried.add(o.id);
          break;
        }
  }
  for (const n of after.graph.nodes) if (!scene.byId.has(n.id)) roots.add(n.id);

  // Positions after the edit, relative to each parent's compiled content origin.
  const local = new Map<string, Rect>();
  for (const id of roots) {
    const r = after.layout.nodes[id],
      l = r && localRect(scene, sid(parentOf(id)), r);
    if (l) local.set(id, l);
  }
  const nearOf = () =>
    new Map(
      statements(source)
        .filter(s => s.command === 'near')
        .map(s => [s.args[0].value, s.args[1].value]),
    );

  const placed: string[] = [];
  for (const id of roots) {
    const noted = notes.length;
    const sourceId = sid(id),
      compiled = scene.byId.get(id),
      now = local.get(id),
      was = before.layout.nodes[id],
      is = after.layout.nodes[id];
    if (!is) continue;
    const parentChanged = !compiled || compiled.parent !== sid(parentOf(id));
    // Resizing can snap a frame's corner to the grid; that is not a request to move it.
    const moved =
      !lanes &&
      !!now &&
      !label.startsWith('Resize') &&
      (parentChanged ||
        Math.abs(now.x - compiled!.localX) > 0.5 ||
        Math.abs(now.y - compiled!.localY) > 0.5);
    const resized =
      !!compiled && (Math.abs(is.w - compiled.w) > 0.5 || Math.abs(is.h - compiled.h) > 0.5);

    if (
      lanes &&
      compiled &&
      was &&
      !label.startsWith('Resize') &&
      (Math.abs(is.x - was.x) > 0.5 || Math.abs(is.y - was.y) > 0.5)
    ) {
      if (!reorderLanes(input, compiled.parent)) keptLane = true;
      else notes.push('reordered the lanes');
    }
    if (label === 'Clear manual markers' && compiled) {
      removeWhere(
        source,
        s => ['near', 'nudge', 'stay'].includes(s.command) && s.args[0]?.value === sourceId,
      );
      notes.push(`released ${sourceId}`);
      continue;
    }
    if (!lanes && !!was?.pinned !== !!is.pinned) {
      const at = now && moved ? now : compiled ? { x: compiled.localX, y: compiled.localY } : now;
      if (!at) continue;
      clearPosition(source, sourceId);
      const xy: Array<[string, ReturnType<typeof num>]> = [
        ['x', num(Math.max(0, at.x))],
        ['y', num(Math.max(0, at.y))],
      ];
      addRefinement(source, statement(is.pinned ? 'pin' : 'stay', [bare(sourceId)], xy));
      notes.push(is.pinned ? `pinned ${sourceId}` : `released the pin on ${sourceId}`);
    } else if (moved && now) {
      clearPosition(source, sourceId);
      if (is.pinned) {
        addRefinement(
          source,
          statement(
            'pin',
            [bare(sourceId)],
            [
              ['x', num(Math.max(0, now.x))],
              ['y', num(Math.max(0, now.y))],
            ],
          ),
        );
        notes.push(`moved the pin on ${sourceId}`);
      } else if (carried.has(id) || input.drag === 'stay') {
        addRefinement(
          source,
          statement(
            'stay',
            [bare(sourceId)],
            [
              ['x', num(now.x)],
              ['y', num(now.y)],
            ],
          ),
        );
        notes.push(`placed ${sourceId}`);
      } else {
        const near = nearOf();
        const createsCycle = (ref: string) => {
          for (let x: string | undefined = ref, n = 0; x && n < 500; x = near.get(x), n++)
            if (x === sourceId) return true;
          return false;
        };
        const siblings = [...after.graph.groups, ...after.graph.nodes]
          .filter(o => o.id !== id && !soft.has(o.id) && parentOf(o.id) === parentOf(id))
          .flatMap(o => {
            const c = scene.byId.get(o.id),
              r = local.get(o.id) ?? (c ? { x: c.localX, y: c.localY, w: c.w, h: c.h } : null);
            return r && !createsCycle(sid(o.id))
              ? [{ id: sid(o.id), r, moved: local.has(o.id) }]
              : [];
          });
        // Prefer siblings that stayed put as references.
        const reads = readsAlong(source, parentOf),
          pick =
            nearestSibling(
              now,
              siblings.filter(s => !s.moved),
              reads(id),
            ) ?? nearestSibling(now, siblings, reads(id));
        if (pick) {
          addRefinement(
            source,
            statement(
              'near',
              [bare(sourceId), bare(pick.ref)],
              [
                ['side', bare(pick.side)],
                ['gap', num(pick.gap)],
                ...(pick.offset ? [['offset', num(pick.offset)] as [string, Word]] : []),
              ],
            ),
          );
          drops.push({ id: sourceId, x: is.x, y: is.y, local: { x: now.x, y: now.y } });
          notes.push(
            `${sourceId} ${pick.side === 'above' || pick.side === 'below' ? pick.side : pick.side + ' of'} ${pick.ref}`,
          );
        } else if (compiled && !parentChanged) {
          addRefinement(
            source,
            statement(
              'nudge',
              [bare(sourceId)],
              [
                ['dx', num(now.x - compiled.baseX)],
                ['dy', num(now.y - compiled.baseY)],
              ],
            ),
          );
          notes.push(`nudged ${sourceId}`);
        } else {
          addRefinement(
            source,
            statement(
              'stay',
              [bare(sourceId)],
              [
                ['x', num(Math.max(0, now.x))],
                ['y', num(Math.max(0, now.y))],
              ],
            ),
          );
          notes.push(`placed ${sourceId}`);
        }
      }
    }

    if (resized && compiled && !(lanes && compiled.type === 'group')) {
      if (compiled.type === 'node') {
        removeWhere(source, s => s.command === 'size' && s.args[0]?.value === sourceId);
        addRefinement(
          source,
          statement(
            'size',
            [bare(sourceId)],
            [
              ['width', num(Math.min(1200, Math.max(40, is.w)))],
              ['height', num(Math.min(1200, Math.max(24, is.h)))],
            ],
          ),
        );
      } else {
        let s = layoutStatement(source, sourceId);
        if (!s) {
          s = statement('layout', [bare(sourceId), bare('column')], [['gap', bare(24)]]);
          if (statements(source).some(x => x.command === 'layout'))
            insertAfter(source, s, x => x.command === 'layout');
          else addRefinement(source, s);
        }
        setAttr(s, 'min-width', num(Math.min(10_000, is.w)));
        setAttr(s, 'min-height', num(Math.min(10_000, is.h)));
      }
      notes.push(`resized ${sourceId} to ${Math.round(is.w)}×${Math.round(is.h)}`);
    }
    if (notes.length > noted) placed.push(sourceId);
  }
  notes.splice(0, notes.length, ...new Set(notes));
  if (keptLane && !notes.length)
    throw new UnsupportedEdit(
      'A participant stays in its lane. Drag it past a neighbor to reorder.',
    );
  // A resize lets the layout move the neighbours: anchors at their old places would only give way.
  const anchored =
    lanes || label.startsWith('Resize') ? [] : anchorSurroundings(source, scene, placed);
  if (anchored.length) notes.push(`anchored ${anchored.length} nearby`);
}

/**
 * Write soft `stay` anchors at their current positions for objects around an accepted refinement:
 * every top-level object, and the siblings of each edited object and of its containers. Later
 * additions then move nearby objects instead of rearranging distant ones. Objects that already
 * have a position refinement keep it. Returns the anchored ids.
 */
export function anchorSurroundings(source: SourceDoc, drawn: Scene, edited: string[]): string[] {
  if (!edited.length) return [];
  const scene = layoutView(drawn);
  const hinted = new Set(
    statements(source)
      .filter(s => POSITION_HINTS.includes(s.command as never))
      .map(s => s.args[0]?.value),
  );
  const scopes = new Set(['root']);
  for (const id of edited)
    for (let o = scene.byId.get(id); o; o = scene.byId.get(o.parent)) scopes.add(o.parent);
  const editedSet = new Set(edited),
    exists = new Set(statements(source).flatMap(s => (isDeclaration(s) ? [s.args[0].value] : [])));
  const anchored: string[] = [];
  for (const o of scene.objects) {
    if (!scopes.has(o.parent) || editedSet.has(o.id) || hinted.has(o.id) || !exists.has(o.id))
      continue;
    addRefinement(
      source,
      statement(
        'stay',
        [bare(o.id)],
        [
          ['x', num(Math.max(0, o.localX))],
          ['y', num(Math.max(0, o.localY))],
        ],
      ),
    );
    anchored.push(o.id);
  }
  return anchored;
}

const isDeclaration = (s: Statement) => s.command === 'node' || s.command === 'group';

/**
 * Let the automatic recipe rearrange a group again: remove soft refinements for everything inside
 * it (pins and sizes stay), and anchor what is around it so the rest of the drawing holds.
 */
export function reflowGroup(source: SourceDoc, scene: Scene, groupId: string) {
  const inside = new Set(
    scene.objects
      .filter(o => {
        for (let p = scene.byId.get(o.parent); p; p = scene.byId.get(p.parent))
          if (p.id === groupId) return true;
        return false;
      })
      .map(o => o.id),
  );
  removeWhere(source, s => {
    if (['near', 'nudge', 'stay'].includes(s.command)) return inside.has(s.args[0]?.value);
    if (s.command === 'align')
      return getAttr(s, 'strength')?.value !== 'required' && inside.has(s.args[1]?.value);
    if (s.command === 'order') return inside.has(s.args[1]?.value);
    return false;
  });
  anchorSurroundings(source, scene, [groupId]);
  return inside.size;
}

/**
 * Objects that moved between two compiled versions although no changed statement mentions them
 * (or a container of theirs). Only the outermost moved object of a subtree is listed.
 */
export function movedOutsideEdit(
  previous: Scene,
  next: Scene,
  previousSource: SourceDoc,
  nextSource: SourceDoc,
): string[] {
  const print = (doc: SourceDoc) =>
    new Set(statements(doc).map(s => JSON.stringify([s.command, s.args, s.attrs])));
  const a = print(previousSource),
    b = print(nextSource),
    mentioned = new Set<string>();
  for (const line of [...a].filter(x => !b.has(x)).concat([...b].filter(x => !a.has(x)))) {
    const [, args, attrs] = JSON.parse(line) as [
      string,
      Array<{ value: string }>,
      Array<[string, { value: string }]>,
    ];
    for (const w of [...args, ...attrs.map(([, v]) => v)]) mentioned.add(w.value);
  }
  // Every object whose world position changed, mentioned or not.
  const moved = new Set<string>();
  for (const o of next.objects) {
    const p = previous.byId.get(o.id);
    if (p && (Math.abs(p.x - o.x) > 1 || Math.abs(p.y - o.y) > 1)) moved.add(o.id);
  }
  // Report unmentioned objects that moved on their own, not because a container carried them.
  return [...moved].filter(id => !mentioned.has(id) && !moved.has(next.byId.get(id)!.parent));
}
