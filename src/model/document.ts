import { LayoutLab } from '../engines/layout-engine.js';
import { RouteLab } from '../engines/routing-engine.js';
import { clamp, clone, finite } from './geometry';
import { ICONS } from './icons';
import {
  defaultAppearance,
  HEX_COLOR,
  isBuiltInFamily,
  isShade,
  LEGEND_LINES,
  OVERRIDE_LIMITS,
  THEME_IDS,
  type AppearanceOverrides,
  type DiagramAppearance,
  type EmphasisState,
  type LegendEntry,
} from './appearance';
import { FONT_ROLES } from './fonts';
import { EDITORS, type FileConfig } from './link';
import { MARKERS } from './markers';
import type { Footnote } from './footnote';
import { NOTE_SIDES, type Note } from './note';
import { STATUSES } from './status';
import { LEGACY_TYPE_STYLE, SHAPES } from './styles';
import type {
  ContainerLayout,
  Diagram,
  DiagramSettings,
  EdgeLayout,
  NodeLayout,
  SequenceLayout,
  SequencePhase,
  ShapeKind,
} from './types';

export const MAX_NODES = 500;
export const MAX_EDGES = 1200;
const LABEL_MODES = ['center', 'top', 'bottom', 'left', 'right', 'detached'];
const PORT_SIDES = ['auto', 'left', 'right', 'top', 'bottom'];

export function uid(prefix = 'n') {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  return (prefix + '-' + random).slice(0, 18);
}

export const DEFAULT_SETTINGS: DiagramSettings = {
  ...LayoutLab.defaults,
  snap: true,
  showManual: true,
  routing: { ...RouteLab.defaults },
};

export function emptyDiagram(title = 'Untitled diagram'): Diagram {
  return {
    schemaVersion: 2,
    id: uid('doc'),
    title,
    graph: { nodes: [], edges: [], groups: [] },
    layout: { nodes: {}, edges: {}, labels: {}, containers: {}, intent: {} },
    styles: {},
    collapsed: [],
    settings: clone(DEFAULT_SETTINGS),
    camera: { x: 0, y: 0, k: 1 },
    theme: 'light',
    appearance: defaultAppearance(),
  };
}

// Untrusted JSON from files, storage and the clipboard. `normalize` validates every field it keeps.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

/** A changed object's old corner and size, where both numbers of each are finite. */
const pastBox = (o: Raw) => ({
  ...(finite(o.wasAt?.x) && finite(o.wasAt?.y) ? { wasAt: { x: o.wasAt.x, y: o.wasAt.y } } : {}),
  ...(finite(o.wasSize?.w) && finite(o.wasSize?.h) && o.wasSize.w > 0 && o.wasSize.h > 0
    ? { wasSize: { w: o.wasSize.w, h: o.wasSize.h } }
    : {}),
});

/**
 * Import the active view of a version 1 file. The obsolete view-management data is dropped;
 * hidden objects are removed together with their descendants.
 */
function migrateLegacy(input: Raw): Raw {
  if (!Array.isArray(input.views)) return input;
  const view = input.views.find((v: Raw) => v.id === input.activeViewId) || input.views[0];
  if (!view) throw Error('The old file has no usable diagram.');
  const graph = clone(input.graph);
  const hidden = new Set<string>(view.filter?.hiddenIds || []);
  const all: Raw[] = [...(graph.nodes || []), ...(graph.groups || [])];
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of all)
      if (n.parentId && hidden.has(n.parentId) && !hidden.has(n.id)) {
        hidden.add(n.id);
        changed = true;
      }
  }
  graph.nodes = (graph.nodes || []).filter((n: Raw) => !hidden.has(n.id));
  graph.groups = (graph.groups || []).filter((n: Raw) => !hidden.has(n.id));
  const kept = new Set(graph.nodes.map((n: Raw) => n.id));
  graph.edges = (graph.edges || []).filter(
    (e: Raw) => !hidden.has(e.id) && kept.has(e.from) && kept.has(e.to),
  );
  const layout = clone(view.layout || { nodes: {}, edges: {}, labels: {}, containers: {} });
  layout.containers ||= {};
  for (const group of graph.groups)
    layout.containers[group.id] = { ...layout.containers[group.id], manualSize: false };
  const styles = clone(view.styles || {});
  for (const n of all)
    styles[n.id] = {
      ...(LEGACY_TYPE_STYLE[n.type] || { shape: 'box', color: 'violet', icon: '' }),
      ...styles[n.id],
    };
  return {
    schemaVersion: 2,
    id: input.id,
    title: input.title,
    graph,
    layout,
    styles,
    collapsed: view.collapsed,
    settings: { ...DEFAULT_SETTINGS, direction: view.settings?.direction || 'RIGHT' },
    camera: view.camera,
    theme: input.theme,
  };
}

export const isLegacyDiagram = (input: Raw) => Array.isArray(input?.views);

const validId = (id: unknown): id is string =>
  typeof id === 'string' && !!id.trim() && !['__proto__', 'constructor', 'prototype'].includes(id);

/**
 * Validate a diagram from any source and return a complete, canonical copy.
 * Throws a readable error for anything that cannot be repaired.
 */
export function normalize(input: unknown): Diagram {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Expected a diagram object.');
  const raw = input as Raw;
  if (raw.schemaVersion !== undefined && ![1, 2].includes(raw.schemaVersion))
    throw Error('Unsupported diagram version.');
  const data = migrateLegacy(clone(raw));
  const out = emptyDiagram(typeof data.title === 'string' ? data.title : 'Untitled diagram');
  if (!data.graph || !Array.isArray(data.graph.nodes) || !Array.isArray(data.graph.edges))
    throw Error('Expected graph.nodes and graph.edges arrays.');
  if (data.graph.groups !== undefined && !Array.isArray(data.graph.groups))
    throw Error('graph.groups must be an array.');
  if (data.graph.nodes.length > MAX_NODES || data.graph.edges.length > MAX_EDGES)
    throw Error('Use a diagram with at most 500 shapes and 1,200 connections.');

  out.appearance = normalizeAppearance(data.appearance);
  const families = new Set(out.appearance.colors.map(c => c.family));
  const ids = new Set<string>();
  function check(n: Raw, kind: 'Shape' | 'Container' | 'Connection') {
    if (!n || !validId(n.id)) throw Error(kind + ' requires a nonempty, safe ID.');
    if (ids.has(n.id)) throw Error('Duplicate ID: ' + n.id);
    ids.add(n.id);
    if (kind !== 'Connection' && typeof n.title !== 'string')
      throw Error(n.id + ' requires a title.');
  }

  if (validId(data.id)) out.id = data.id;
  for (const n of data.graph.nodes) {
    check(n, 'Shape');
    if (n.image && !/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(n.image))
      throw Error(n.id + ': image must be embedded raster data.');
    out.graph.nodes.push({
      id: n.id,
      title: n.title,
      ...(typeof n.was === 'string' ? { was: n.was } : {}),
      ...(typeof n.wasShape === 'string' ? { wasShape: n.wasShape } : {}),
      ...(Number.isInteger(n.wasCount) || typeof n.wasCount === 'string'
        ? { wasCount: n.wasCount }
        : {}),
      ...pastBox(n),
      ...(typeof n.href === 'string' ? { href: n.href } : {}),
      ...((Number.isInteger(n.count) && n.count > 1) || typeof n.count === 'string'
        ? { count: n.count }
        : {}),
      ...((Number.isInteger(n.span) && n.span > 0) || n.span === 'var' ? { span: n.span } : {}),
      ...(n.parentId ? { parentId: n.parentId } : {}),
      ...(n.image ? { image: n.image } : {}),
      ...(finite(n.lifeline) && n.lifeline > 0 ? { lifeline: n.lifeline } : {}),
    });
  }
  for (const g of data.graph.groups || []) {
    check(g, 'Container');
    out.graph.groups.push({
      id: g.id,
      title: g.title,
      ...(typeof g.was === 'string' ? { was: g.was } : {}),
      ...pastBox({ wasAt: g.wasAt }),
      ...(typeof g.href === 'string' ? { href: g.href } : {}),
      ...(g.parentId ? { parentId: g.parentId } : {}),
      ...(g.frame === 'soft' || g.frame === 'none' ? { frame: g.frame } : {}),
      ...(Array.isArray(g.hull) &&
      g.hull.every((r: Raw) => ['x', 'y', 'w', 'h'].every(k => finite(r[k])))
        ? { hull: g.hull.map((r: Raw) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) }
        : {}),
    });
  }

  const groups = new Map(out.graph.groups.map(g => [g.id, g]));
  const nodes = new Set(out.graph.nodes.map(n => n.id));
  const objects = [...out.graph.nodes, ...out.graph.groups];
  for (const n of objects) {
    if (n.parentId && !groups.has(n.parentId)) throw Error(n.id + ': container does not exist.');
    const seen = new Set([n.id]);
    for (let p = n.parentId; p; p = groups.get(p)?.parentId) {
      if (seen.has(p)) throw Error('Containers cannot contain themselves.');
      seen.add(p);
    }
  }

  for (const e of data.graph.edges) {
    check(e, 'Connection');
    if (!(nodes.has(e.from) || groups.has(e.from)) || !(nodes.has(e.to) || groups.has(e.to)))
      throw Error(e.id + ': both endpoints must exist.');
    if (e.label !== undefined && typeof e.label !== 'string')
      throw Error(e.id + ': label must be text.');
    out.graph.edges.push({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label || '',
      ...(typeof e.was === 'string' ? { was: e.was } : {}),
      directed: e.directed !== false,
      ...(e.directed !== false && MARKERS.includes(e.head) && e.head !== 'arrow'
        ? { head: e.head }
        : {}),
      ...(e.directed !== false && MARKERS.includes(e.tail) && e.tail !== 'none'
        ? { tail: e.tail }
        : {}),
      emphasis: !!e.emphasis,
      dashed: !!e.dashed || ['dependency', 'annotation'].includes(e.type),
      ...(STATUSES.includes(e.status) && e.status !== 'same' ? { status: e.status } : {}),
    });
  }

  for (const [i, n] of objects.entries()) {
    const p = data.layout?.nodes?.[n.id];
    if (p) {
      for (const key of ['x', 'y', 'w', 'h'])
        if (!finite(p[key]) || Math.abs(p[key]) > 1e6)
          throw Error(n.id + ': ' + key + ' must be a finite coordinate.');
      // A marker is a thin bar on the seam between two cells.
      const marker = data.styles?.[n.id]?.shape === 'marker';
      if ((p.w < 24 && !marker) || (p.h < 20 && !marker) || Math.min(p.w, p.h) < 4)
        throw Error(n.id + ': shape dimensions are too small.');
      out.layout.nodes[n.id] = {
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        manual: !!p.manual,
        pinned: !!p.pinned,
      };
    } else if (nodes.has(n.id)) {
      out.layout.nodes[n.id] = {
        x: (i % 4) * 212 + 60,
        y: Math.floor(i / 4) * 100 + 60,
        w: 164,
        h: 56,
      };
    }
    const style = data.styles?.[n.id] || {};
    if (style.shape !== undefined && !SHAPES.includes(style.shape) && style.shape !== 'marker')
      throw Error(n.id + ': unknown shape.');
    if (
      style.color !== undefined &&
      style.color !== 'auto' &&
      !isBuiltInFamily(style.color) &&
      !families.has(style.color)
    )
      throw Error(n.id + ': unknown color.');
    if (style.shade !== undefined && !isShade(style.shade)) throw Error(n.id + ': unknown shade.');
    out.styles[n.id] = {
      shape: (style.shape as ShapeKind) || 'box',
      color: style.color || 'auto',
      ...(style.shade !== undefined ? { shade: style.shade } : {}),
      icon: ICONS[style.icon] ? style.icon : '',
      ...(STATUSES.includes(style.status) && style.status !== 'same'
        ? { status: style.status }
        : {}),
    };
    const label = data.layout?.labels?.[n.id];
    if (label) {
      if (label.mode && !LABEL_MODES.includes(label.mode))
        throw Error(n.id + ': invalid label position.');
      for (const k of ['dx', 'dy', 'width'])
        if (label[k] !== undefined && !finite(label[k]))
          throw Error(n.id + ': invalid label geometry.');
      out.layout.labels[n.id] = { ...label };
    }
    if (groups.has(n.id)) {
      const cfg = data.layout?.containers?.[n.id] || {};
      if (cfg.direction && !['inherit', 'RIGHT', 'DOWN'].includes(cfg.direction))
        throw Error(n.id + ': invalid container direction.');
      out.layout.containers[n.id] = {
        direction: cfg.direction || 'inherit',
        padding: finite(cfg.padding) ? clamp(cfg.padding, 12, 80) : 24,
        manualSize: cfg.manualSize !== false,
        ...(finite(cfg.cellsBand) ? { cellsBand: cfg.cellsBand } : {}),
        ...(cfg.cellsChrome && typeof cfg.cellsChrome === 'object'
          ? { cellsChrome: structuredClone(cfg.cellsChrome) }
          : {}),
      } satisfies ContainerLayout;
    }
  }

  // Old auto-sized containers have no rectangle. Materialize each once.
  const framed = new Set<string>();
  function frame(id: string): NodeLayout {
    if (framed.has(id)) return out.layout.nodes[id];
    framed.add(id);
    const rects = objects
      .filter(n => n.parentId === id)
      .map(n => (groups.has(n.id) ? frame(n.id) : out.layout.nodes[n.id]));
    if (!out.layout.nodes[id]) {
      if (rects.length) {
        const x = Math.min(...rects.map(r => r.x)) - 24,
          y = Math.min(...rects.map(r => r.y)) - 52;
        out.layout.nodes[id] = {
          x,
          y,
          w: Math.max(200, Math.max(...rects.map(r => r.x + r.w)) - x + 24),
          h: Math.max(130, Math.max(...rects.map(r => r.y + r.h)) - y + 24),
        };
      } else out.layout.nodes[id] = { x: 60, y: 60, w: 300, h: 220 };
    }
    return out.layout.nodes[id];
  }
  out.graph.groups.forEach(g => frame(g.id));

  for (const e of out.graph.edges) {
    const cfg = data.layout?.edges?.[e.id] || {},
      next: EdgeLayout = {};
    for (const key of ['fromSide', 'toSide'] as const)
      if (cfg[key]) {
        if (!PORT_SIDES.includes(cfg[key])) throw Error(e.id + ': invalid connection side.');
        next[key] = cfg[key];
      }
    for (const key of ['labelDx', 'labelDy'] as const)
      if (cfg[key] !== undefined) {
        if (!finite(cfg[key])) throw Error(e.id + ': invalid label offset.');
        next[key] = cfg[key];
      }
    if (cfg.row !== undefined) {
      if (!finite(cfg.row)) throw Error(e.id + ': invalid message row.');
      next.row = cfg.row;
    }
    if (cfg.waypoints) {
      if (
        !Array.isArray(cfg.waypoints) ||
        cfg.waypoints.length > 40 ||
        cfg.waypoints.some((p: Raw) => !finite(p.x) || !finite(p.y))
      )
        throw Error(e.id + ': invalid connection bends.');
      next.waypoints = cfg.waypoints.map((p: Raw) => ({ x: p.x, y: p.y }));
    }
    if (cfg.lane) {
      const at = 'y' in cfg.lane ? cfg.lane.y : cfg.lane.x;
      if (!finite(at)) throw Error(e.id + ': invalid connection lane.');
      next.lane = 'y' in cfg.lane ? { y: at } : { x: at };
      for (const key of ['leave', 'enter'] as const)
        if (cfg.lane[key] !== undefined) {
          if (!finite(cfg.lane[key])) throw Error(e.id + ': invalid connection lane.');
          next.lane[key] = cfg.lane[key];
        }
      if (cfg.lane.out === true) next.lane.out = true;
      if (cfg.lane.face === true) next.lane.face = true;
    }
    if (cfg.flow === 'right' || cfg.flow === 'down') next.flow = cfg.flow;
    out.layout.edges[e.id] = next;
  }

  out.layout.intent = LayoutLab.normalizeIntent(data.layout?.intent || {}, nodes);
  const seq = data.layout?.sequence as SequenceLayout | undefined;
  if (
    seq &&
    ['x', 'y', 'w', 'h'].every(k => finite((seq.panel as Raw | undefined)?.[k])) &&
    Array.isArray(seq.phases)
  ) {
    const phases = (list: SequencePhase[]) =>
      list
        .filter(p => typeof p?.id === 'string' && finite(p.y) && finite(p.h))
        .map(p => ({ id: p.id, label: String(p.label ?? p.id), y: p.y, h: p.h }));
    out.layout.sequence = {
      panel: { ...seq.panel },
      phases: phases(seq.phases),
      ...(finite(seq.phaseX) ? { phaseX: seq.phaseX } : {}),
      ...(Array.isArray(seq.notes) ? { notes: seq.notes } : {}),
      ...(seq.inner ? { inner: { ...seq.inner } } : {}),
      ...(seq.before && Array.isArray(seq.before.phases)
        ? {
            before: {
              rows: { ...seq.before.rows },
              phases: phases(seq.before.phases),
              grow: finite(seq.before.grow) ? seq.before.grow : 0,
            },
          }
        : {}),
    };
  }
  out.collapsed = Array.isArray(data.collapsed)
    ? data.collapsed.filter((id: string) => groups.has(id))
    : [];
  const supplied = { ...(data.settings || {}) };
  if (supplied.algorithm === 'compact') supplied.algorithm = 'layered';
  out.settings = {
    ...DEFAULT_SETTINGS,
    ...LayoutLab.settings({ ...DEFAULT_SETTINGS, ...supplied }),
  };
  for (const key of ['respectManual', 'snap', 'showManual', 'growContainers'] as const)
    if (typeof supplied[key] === 'boolean') out.settings[key] = supplied[key];
  out.settings.routing = RouteLab.settings(data.settings?.routing || {});
  out.settings.mode = 'pass';
  const c = data.camera;
  if (c) {
    if (!finite(c.x) || !finite(c.y) || !finite(c.k) || c.k <= 0) throw Error('Invalid camera.');
    out.camera = { x: c.x, y: c.y, k: clamp(c.k, 0.08, 4) };
  }
  out.theme = data.theme === 'dark' ? 'dark' : 'light';
  return out;
}

/** Validate a saved appearance. A missing appearance is the default theme. */
export function normalizeAppearance(input: Raw): DiagramAppearance {
  const out = defaultAppearance();
  if (input === undefined || input === null) return out;
  if (typeof input !== 'object') throw Error('Invalid appearance.');
  if (input.theme !== undefined) {
    if (!THEME_IDS.includes(input.theme)) throw Error('Unknown theme: ' + input.theme);
    out.theme = input.theme;
  }
  const o = input.overrides ?? {},
    next: AppearanceOverrides = {};
  for (const key of ['paddingX', 'paddingY', 'radius'] as const)
    if (o[key] !== undefined) {
      const { min, max } = OVERRIDE_LIMITS[key];
      if (!finite(o[key]) || o[key] < min || o[key] > max)
        throw Error(`Appearance ${key} must be from ${min} to ${max}.`);
      next[key] = o[key];
    }
  for (const key of ['titleFont', 'annotationFont'] as const)
    if (o[key] !== undefined) {
      if (!FONT_ROLES.includes(o[key]))
        throw Error(`Appearance ${key} must be sans, serif or mono.`);
      next[key] = o[key];
    }
  for (const key of ['canvas', 'text', 'connection'] as const)
    if (o[key] !== undefined) {
      if (typeof o[key] !== 'string' || !HEX_COLOR.test(o[key]))
        throw Error(`Appearance ${key} must be a hex color.`);
      next[key] = o[key];
    }
  out.overrides = next;
  const seen = new Set<string>();
  for (const c of Array.isArray(input.colors) ? input.colors : []) {
    if (!c || typeof c.family !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(c.family))
      throw Error('Color definitions need a family name.');
    if (!isShade(c.shade)) throw Error(`${c.family}: unknown shade ${c.shade}.`);
    if (seen.has(c.family + ':' + c.shade)) throw Error(`Duplicate color ${c.family} ${c.shade}.`);
    seen.add(c.family + ':' + c.shade);
    const def: DiagramAppearance['colors'][number] = { family: c.family, shade: c.shade };
    for (const key of ['fill', 'stroke', 'ink'] as const)
      if (c[key] !== undefined) {
        if (typeof c[key] !== 'string' || !HEX_COLOR.test(c[key]))
          throw Error(`${c.family} ${c.shade}: ${key} must be a hex color.`);
        def[key] = c[key];
      }
    if (!isBuiltInFamily(c.family) && !(def.fill && def.stroke && def.ink))
      throw Error(`${c.family} ${c.shade}: a new color needs fill, stroke and ink.`);
    out.colors.push(def);
  }
  const legend: LegendEntry[] = [];
  for (const e of Array.isArray(input.legend) ? input.legend : []) {
    if (e && LEGEND_LINES.includes(e.line)) {
      if (typeof e.label !== 'string') throw Error(`Legend line ${e.line}: a label is required.`);
      legend.push({ line: e.line, label: e.label });
      continue;
    }
    if (!e || typeof e.family !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(e.family))
      throw Error('Legend entries need a color family.');
    if (typeof e.label !== 'string') throw Error(`Legend ${e.family}: a label is required.`);
    if (e.shade !== undefined && !isShade(e.shade))
      throw Error(`Legend ${e.family}: unknown shade ${e.shade}.`);
    legend.push({
      family: e.family,
      label: e.label,
      ...(e.shade !== undefined ? { shade: e.shade } : {}),
    });
  }
  if (legend.length) out.legend = legend;
  const h = input.heading;
  if (h && typeof h === 'object') {
    const heading: NonNullable<DiagramAppearance['heading']> = {};
    for (const key of ['title', 'subtitle'] as const)
      if (typeof h[key] === 'string' && h[key]) heading[key] = h[key];
    if (typeof h.width === 'number' && h.width > 0) heading.width = h.width;
    if (heading.title || heading.subtitle || heading.width) out.heading = heading;
  }
  const notes: Note[] = [];
  for (const n of Array.isArray(input.notes) ? input.notes : [])
    if (n && typeof n.text === 'string')
      notes.push({
        ...(typeof n.id === 'string' ? { id: n.id } : {}),
        text: n.text,
        ...(typeof n.near === 'string' ? { near: n.near } : {}),
        ...(NOTE_SIDES.includes(n.side) ? { side: n.side } : {}),
        ...(typeof n.width === 'number' && n.width > 0 ? { width: n.width } : {}),
        ...(Array.isArray(n.states)
          ? { states: n.states.filter((x: unknown) => typeof x === 'string') }
          : {}),
        ...(n.leader === true ? { leader: true } : {}),
      });
  if (notes.length) out.notes = notes;
  const footnotes: Footnote[] = [];
  for (const n of Array.isArray(input.footnotes) ? input.footnotes : [])
    if (n && typeof n.text === 'string')
      footnotes.push({ text: n.text, ...(typeof n.mark === 'string' ? { mark: n.mark } : {}) });
  if (footnotes.length) out.footnotes = footnotes;
  const cfg = input.config;
  if (cfg && typeof cfg === 'object') {
    const config: FileConfig = {};
    if (typeof cfg.linkBase === 'string') config.linkBase = cfg.linkBase;
    if (EDITORS.includes(cfg.editor)) config.editor = cfg.editor;
    if (cfg.strikeRemoved === true) config.strikeRemoved = true;
    if (Object.keys(config).length) out.config = config;
  }
  const states: EmphasisState[] = [];
  for (const st of Array.isArray(input.states) ? input.states : [])
    if (st && typeof st.id === 'string' && Array.isArray(st.ids))
      states.push({
        id: st.id,
        label: typeof st.label === 'string' ? st.label : st.id,
        ids: st.ids.filter((x: unknown) => typeof x === 'string'),
        rest: st.rest === 'plain' ? 'plain' : 'dim',
        ...(Array.isArray(st.context)
          ? { context: st.context.filter((x: unknown) => typeof x === 'string') }
          : {}),
        ...(st.hidden === true ? { hidden: true } : {}),
      });
  if (states.length) out.states = states;
  const c = input.compare;
  if (c && typeof c.before === 'string' && typeof c.after === 'string')
    out.compare = {
      before: c.before,
      after: c.after,
      ...(c.direction === 'right' || c.direction === 'down' ? { direction: c.direction } : {}),
      ...(finite(c.aspect) && c.aspect > 0 ? { aspect: c.aspect } : {}),
    };
  return out;
}

/** The meaning of a document, ignoring where the camera happens to be. */
export function documentIdentity(doc: Diagram) {
  const { camera: _camera, ...meaning } = doc;
  return JSON.stringify(meaning);
}

/** Write object keys in sorted order, so key order never changes a fingerprint. */
const sortedKeys = (_key: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : value;

/**
 * Inputs that affect connection routing. The editor store keeps the key order of the document it
 * replaced, so the worker's freshly projected copy of the same document lists its keys differently.
 */
export function routingFingerprint(doc: Diagram) {
  return JSON.stringify(
    [doc.graph, doc.layout, doc.styles, doc.collapsed, doc.settings.routing],
    sortedKeys,
  );
}
