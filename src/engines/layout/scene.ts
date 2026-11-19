import type { DiagramGroup, DiagramNode, Direction, NodeLayout } from '../../model/types.ts';
import type {
  Diagram,
  LayoutIntent,
  LayoutMetrics,
  LayoutOptions,
  Rect,
  Settings,
  SolverStop,
  TraceFrame,
} from './types.ts';

/** A shape or group ID, or nothing for the top level. */
export type ParentId = string | null | undefined;
import { topology } from './topology.ts';
import { bounds, clamp, cmp, copy, magnitude, midpoint, penetration } from './util.ts';

/** Counters and findings that every solve of one layout run adds to. */
export interface Run {
  batchCount: number;
  totalIterations: number;
  /** Which hierarchy sweep is running; odd sweeps of a compound layout go top down. */
  hierarchyPhase: number;
  stops: SolverStop[];
  warnings: Set<string>;
  /** Containers whose children a rebuild has already placed from a seed. */
  seeded: Set<string | null>;
}

/**
 * One layout run's view of the document: the hierarchy, what is fixed or hidden, and the only
 * ways a solve may move or measure boxes. `doc` is the copy the run changes; `original` keeps the
 * geometry it started from.
 */
export function createScene(input: Diagram, doc: Diagram, s: Settings, opts: LayoutOptions) {
  const original = copy(input.layout.nodes),
    intent: LayoutIntent = doc.layout.intent,
    compound = ['compound-flow', 'boundary-align', 'compound-spring'].includes(s.algorithm),
    globalTopology = topology(doc.graph.nodes, doc.graph.edges, intent);
  const groups = new Map(doc.graph.groups.map(g => [g.id, g])),
    entities = new Map<string, DiagramNode | DiagramGroup>(
      [...doc.graph.nodes, ...doc.graph.groups].map(n => [n.id, n]),
    ),
    pos = doc.layout.nodes;
  const child = (id: ParentId) =>
    [...entities.values()]
      .filter(n => (n.parentId || null) === (id || null))
      .sort((a, b) => cmp(a.id, b.id));
  const parent = (id: string) => entities.get(id)?.parentId;
  const inheritedDirection = (id: ParentId): Direction => {
    for (let p = id; p; p = parent(p)) {
      const d = doc.layout.containers[p]?.direction;
      if (d && d !== 'inherit') return d;
    }
    return s.direction;
  };
  const descend = (id: string): string[] =>
    child(id).flatMap(n => [n.id, ...(groups.has(n.id) ? descend(n.id) : [])]);
  // Source order: each node's place in the document, the order the file declares them in.
  const nodeIndex = new Map(doc.graph.nodes.map((n, i) => [n.id, i]));
  const extraFixed = new Set(opts.fixedIds || []);
  const direct = (id: string) =>
    extraFixed.has(id) || !!pos[id]?.pinned || (s.respectManual && !!pos[id]?.manual);
  const branch = (id: ParentId) => {
    for (let p = id; p; p = parent(p)) if (direct(p)) return true;
    return false;
  };
  const fixed = (id: string) => branch(id) || (groups.has(id) && descend(id).some(direct));
  const visible = (id: string) => {
    for (let p = parent(id); p; p = parent(p)) if (doc.collapsed.includes(p)) return false;
    return true;
  };
  const padded = (id: string): NodeLayout => {
    const p = pos[id];
    if (doc.collapsed.includes(id)) return { ...p, w: Math.min(p.w, 210), h: 58 };
    return p;
  };
  const run: Run = {
    batchCount: 0,
    totalIterations: 0,
    hierarchyPhase: 0,
    stops: [],
    warnings: new Set(),
    seeded: new Set(),
  };
  const aspect =
    s.aspect === 'canvas'
      ? clamp((opts.viewport?.w || 1200) / (opts.viewport?.h || 760), 0.5, 3)
      : Number(s.aspect);
  // Move whole subtrees. In pass mode every descendant stays inside the same
  // global displacement disc: parent + child moves cannot multiply the budget.
  function move(id: string, dx: number, dy: number) {
    if (fixed(id) || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const ids = [id, ...(groups.has(id) ? descend(id) : [])];
    let f = 1;
    if (s.mode === 'pass') {
      const a = dx * dx + dy * dy;
      if (a < 1e-16) return;
      for (const k of ids) {
        const p = pos[k],
          o = original[k],
          rx = p.x - o.x,
          ry = p.y - o.y,
          b = 2 * (rx * dx + ry * dy),
          c = rx * rx + ry * ry - s.maxMove * s.maxMove,
          disc = b * b - 4 * a * c;
        f = Math.min(f, clamp((-b + Math.sqrt(Math.max(0, disc))) / (2 * a), 0, 1));
      }
    }
    for (const k of ids) {
      pos[k].x += dx * f;
      pos[k].y += dy * f;
    }
  }
  function resizeAuto(id: string) {
    if (!s.growContainers || fixed(id) || !child(id).length) return;
    const b = bounds(child(id).map(n => pos[n.id])),
      r = pos[id],
      p = doc.layout.containers[id]?.padding || 24;
    const right = Math.max(r.x + r.w, b.x + b.w + p),
      bottom = Math.max(r.y + r.h, b.y + b.h + p);
    // Growth is deliberately right/down only. It cannot relocate children.
    r.w = right - r.x;
    r.h = bottom - r.y;
  }
  function metrics(): LayoutMetrics {
    let overlaps = 0,
      overlapArea = 0;
    const roots = child(null).filter(n => visible(n.id));
    for (const pid of [null, ...groups.keys()]) {
      if (pid && (!visible(pid) || doc.collapsed.includes(pid))) continue;
      const cs = child(pid).filter(n => visible(n.id));
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) {
          const hit = penetration(padded(cs[i].id), padded(cs[j].id));
          if (hit) {
            overlaps++;
            overlapArea += hit.area;
          }
        }
    }
    const b = bounds(roots.map(n => padded(n.id)));
    let length = 0;
    for (const e of doc.graph.edges) {
      const a = pos[e.from],
        b = pos[e.to];
      if (a && b) {
        const ca = midpoint(a),
          cb = midpoint(b);
        length += magnitude(ca.x - cb.x, ca.y - cb.y);
      }
    }
    return {
      overlaps,
      overlapArea: Math.round(overlapArea),
      width: Math.round(b.w),
      height: Math.round(b.h),
      aspect: +(b.w / b.h).toFixed(2),
      area: Math.round(b.w * b.h),
      linkLength: Math.round(length),
    };
  }
  const before = metrics();
  // Optional recorded solver path. Rendering can scrub real checkpoints;
  // this does not interpolate untested straight lines between two layouts.
  const trace: TraceFrame[] = [];
  let traceStride = 8,
    lastTraceTick = -8;
  function captureTrace(phase: string, force = false) {
    if (!opts.trace) return;
    if (!force && run.totalIterations - lastTraceTick < traceStride) return;
    const m = metrics();
    if (!force && m.overlaps > before.overlaps) return;
    // Do not surface transient invalid container states as scrub stops.
    if (!force)
      for (const n of entities.values())
        if (parent(n.id) && visible(n.id)) {
          const p = pos[n.id],
            f = pos[parent(n.id)!],
            pad = doc.layout.containers[parent(n.id)!]?.padding || 24;
          const o = original[n.id],
            of = original[parent(n.id)!];
          const spill = (p: Rect, f: Rect) =>
            Math.max(0, f.x + pad - p.x) +
            Math.max(0, f.y + pad + 28 - p.y) +
            Math.max(0, p.x + p.w - (f.x + f.w - pad)) +
            Math.max(0, p.y + p.h - (f.y + f.h - pad));
          if (spill(p, f) > spill(o, of) + 0.01) return;
        }
    const previous = trace.at(-1);
    const travel = previous
      ? Math.max(
          ...Object.keys(pos).map(id =>
            Math.hypot(
              pos[id].x - previous.nodes[id].x,
              pos[id].y - previous.nodes[id].y,
              pos[id].w - previous.nodes[id].w,
              pos[id].h - previous.nodes[id].h,
            ),
          ),
          0,
        )
      : Infinity;
    if (previous && travel < 0.02 && !force) return;
    if (trace.length >= 94) {
      const keep = trace.filter((_, i) => i === 0 || i % 2 === 0);
      trace.splice(0, trace.length, ...keep);
      traceStride *= 2;
    }
    trace.push({ nodes: copy(pos), iteration: run.totalIterations, phase, metrics: m });
    lastTraceTick = run.totalIterations;
  }
  return {
    doc,
    original,
    nodeIndex,
    s,
    opts,
    run,
    aspect,
    intent,
    compound,
    globalTopology,
    groups,
    entities,
    pos,
    child,
    parent,
    inheritedDirection,
    descend,
    branch,
    fixed,
    visible,
    padded,
    move,
    resizeAuto,
    metrics,
    before,
    trace,
    captureTrace,
  };
}
export type Scene = ReturnType<typeof createScene>;
