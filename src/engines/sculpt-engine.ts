/* Spatial editing and recorded layout journeys.
 * DOM-free. No random starts. Every operation returns new geometry.
 * A brush changes a local goal, not the definition of global graph quality.
 */
import type { Diagram, LayoutSettings, NodeGeometry, Point, Rect } from '../model/types.ts';
import { LayoutLab } from './layout-engine.ts';
import type { LayoutMetrics, LayoutOptions, LayoutReport, TraceFrame } from './layout-engine.ts';

export type BrushMode = 'tidy' | 'flow' | 'space' | 'restore' | 'protect';

export interface BrushSettings {
  radius: number;
  strength: number;
  softness: number;
  step: number;
  mode: BrushMode;
  holdRestored: boolean;
}

export interface DabOptions extends Partial<BrushSettings> {
  point?: Point;
  worldRadius?: number;
  reference?: NodeGeometry | null;
  protectedIds?: string[];
}

export interface DabResult {
  document: Diagram;
  weights: Record<string, number>;
  locked: string[];
  moved: string[];
  maxDisplacement: number;
  blocked: boolean;
  attenuation?: number;
  mode: BrushMode;
}

export interface TimelineFrame {
  nodes: NodeGeometry;
  iteration: number;
  phase: string;
  metrics: LayoutMetrics;
  index: number;
  moved: number;
  travel: number;
  cumulative: number;
  maxMove: number;
}

export interface TimelineBookmark {
  index: number;
  title: string;
}

export interface Timeline {
  schemaVersion: 1;
  kind: 'diagram-studio-journey';
  baseline: Diagram;
  settings: LayoutSettings;
  execution: Record<string, unknown>;
  report: LayoutReport;
  frames: TimelineFrame[];
  finalDocument: Diagram;
  bookmarks: TimelineBookmark[];
  createdAt: string;
  /** Added by the app: routes in effect when the timeline was recorded. */
  routePrior?: unknown[];
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const clamp = (x: number, a: number, b: number) =>
  Math.max(a, Math.min(b, Number.isFinite(+x) ? +x : a));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (p: Rect) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
const defaults: BrushSettings = {
  radius: 190,
  strength: 35,
  softness: 75,
  step: 18,
  mode: 'tidy',
  holdRestored: true,
};
function settings(input: Partial<BrushSettings> = {}): BrushSettings {
  return {
    radius: clamp(input.radius ?? 190, 40, 600),
    strength: clamp(input.strength ?? 35, 1, 100),
    softness: clamp(input.softness ?? 75, 0, 100),
    step: clamp(input.step ?? 18, 1, 64),
    mode: ['tidy', 'flow', 'space', 'restore', 'protect'].includes(input.mode as string)
      ? (input.mode as BrushMode)
      : 'tidy',
    holdRestored: input.holdRestored !== false,
  };
}
/** How strongly a brush of radius `r` acts at distance `d`: 1 in the core, eased to 0 at the rim. */
function weight(d: number, r: number, softness = 0.75) {
  if (d >= r) return 0;
  const core = r * (1 - softness);
  if (d <= core) return 1;
  const t = (d - core) / Math.max(0.00001, r - core);
  return 1 - t * t * (3 - 2 * t);
}
function rectDistance(p: Point, r: Rect) {
  return Math.hypot(
    Math.max(r.x - p.x, 0, p.x - r.x - r.w),
    Math.max(r.y - p.y, 0, p.y - r.y - r.h),
  );
}
function index(doc: Diagram) {
  const by = new Map([...doc.graph.nodes, ...doc.graph.groups].map(n => [n.id, n])),
    groups = new Set(doc.graph.groups.map(n => n.id)),
    parents = (id: string) => {
      const a: string[] = [];
      for (let p = by.get(id)?.parentId; p; p = by.get(p)?.parentId) a.push(p);
      return a;
    };
  return {
    by,
    groups,
    parents,
    visible: (id: string) => !parents(id).some(id => doc.collapsed.includes(id)),
    locked: (id: string) =>
      [id, ...parents(id)].some(
        id =>
          doc.layout.nodes[id]?.pinned ||
          (doc.settings.respectManual && doc.layout.nodes[id]?.manual),
      ),
  };
}
/** The brush weight of each visible shape it reaches, and the shapes it reaches but may not move. */
function field(
  doc: Diagram,
  point: Point,
  radius: number,
  softness = 0.75,
  protectedIds: string[] = [],
) {
  const idx = index(doc),
    protectedSet = new Set(protectedIds),
    weights: Record<string, number> = {},
    locked: string[] = [];
  for (const n of doc.graph.nodes) {
    if (!idx.visible(n.id)) continue;
    const value = weight(rectDistance(point, doc.layout.nodes[n.id]), radius, softness);
    if (value <= 0.0001) continue;
    if (
      idx.locked(n.id) ||
      protectedSet.has(n.id) ||
      idx.parents(n.id).some(id => protectedSet.has(id))
    ) {
      locked.push(n.id);
      continue;
    }
    weights[n.id] = value;
  }
  return { weights, locked };
}
function intersection(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.005 && h > 0.005 ? w * h : 0;
}
function violationPairs(doc: Diagram, nodes: NodeGeometry) {
  const idx = index(doc),
    visible = [...doc.graph.nodes, ...doc.graph.groups].filter(n => idx.visible(n.id)),
    violations = new Map<string, number>();
  for (let i = 0; i < visible.length; i++)
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i],
        b = visible[j];
      if (idx.parents(a.id).includes(b.id) || idx.parents(b.id).includes(a.id)) continue;
      const area = intersection(nodes[a.id], nodes[b.id]);
      if (area) violations.set(a.id + '\0' + b.id, area);
    }
  return violations;
}
function noWorse(doc: Diagram, before: NodeGeometry, after: NodeGeometry) {
  const base = violationPairs(doc, before),
    next = violationPairs(doc, after);
  for (const [id, area] of next) if (area > (base.get(id) || 0) + 0.01) return false;
  return true;
}
function constrainedTarget(doc: Diagram, nodes: NodeGeometry, id: string, q: Point) {
  const n = [...doc.graph.nodes, ...doc.graph.groups].find(n => n.id === id),
    old = doc.layout.nodes[id];
  if (!n?.parentId) return q;
  const f = nodes[n.parentId],
    pad = doc.layout.containers[n.parentId]?.padding ?? 24;
  const minX = Math.min(old.x, f.x + pad),
    maxX = Math.max(old.x, f.x + f.w - pad - old.w);
  const minY = Math.min(old.y, f.y + pad + 28),
    maxY = Math.max(old.y, f.y + f.h - pad - old.h);
  return { x: clamp(q.x, minX, maxX), y: clamp(q.y, minY, maxY) };
}
/** One brush dab at `options.point`: moves the shapes under it a step toward the brush's goal. */
function dab(input: Diagram, options: DabOptions = {}): DabResult {
  const s = settings(options),
    doc = copy(input),
    nodes = doc.layout.nodes,
    old = copy(nodes),
    point = options.point || { x: 0, y: 0 },
    radius = options.worldRadius ?? s.radius;
  const f = field(
      input,
      point,
      radius,
      s.softness / 100,
      s.mode === 'protect' ? [] : options.protectedIds || [],
    ),
    weights = f.weights;
  if (s.mode === 'protect')
    return {
      document: doc,
      weights,
      locked: f.locked,
      moved: [],
      maxDisplacement: 0,
      blocked: false,
      mode: s.mode,
    };
  if (!Object.keys(weights).length)
    return {
      document: doc,
      weights,
      locked: f.locked,
      moved: [],
      maxDisplacement: 0,
      blocked: false,
      mode: s.mode,
    };
  const idx = index(doc),
    strength = s.strength / 100,
    budget = s.step * strength,
    visible = doc.graph.nodes.filter(n => idx.visible(n.id));
  const forward = LayoutLab.topology(visible, doc.graph.edges, doc.layout.intent || {}).forward;
  const forces = new Map(Object.keys(weights).map(id => [id, { x: 0, y: 0, n: 0 }]));
  const push = (id: string, x: number, y: number, amount = 1) => {
    const f = forces.get(id);
    if (!f) return;
    f.x += x * amount;
    f.y += y * amount;
    f.n += amount;
  };
  if (s.mode === 'restore')
    for (const [id, v] of forces) {
      const ref = options.reference?.[id],
        p = old[id];
      if (!ref) continue;
      // Restoration never resizes containers or re-parents objects. Position only.
      v.x = ref.x - p.x;
      v.y = ref.y - p.y;
      v.n = 1;
    }
  else {
    if (s.mode !== 'space')
      for (const e of doc.graph.edges) {
        const a = old[e.from],
          b = old[e.to];
        if (!a || !b) continue;
        const ac = center(a),
          bc = center(b),
          dx = bc.x - ac.x,
          dy = bc.y - ac.y,
          d = Math.max(1, Math.hypot(dx, dy));
        const ideal =
          (doc.settings.edgeLength || 88) + (Math.hypot(a.w, a.h) + Math.hypot(b.w, b.h)) / 4;
        const amount = (d - ideal) * 0.16;
        push(e.from, (dx / d) * amount, (dy / d) * amount);
        push(e.to, (-dx / d) * amount, (-dy / d) * amount);
        const vert = doc.settings.direction === 'DOWN',
          cross = vert ? dx : dy;
        if (Math.abs(cross) < (doc.settings.nodeGap || 24) + 40) {
          push(e.from, vert ? cross * 0.15 : 0, vert ? 0 : cross * 0.15, 0.5);
          push(e.to, vert ? -cross * 0.15 : 0, vert ? 0 : -cross * 0.15, 0.5);
        }
      }
    if (s.mode === 'flow' || (doc.settings.respectDirection && s.mode === 'tidy'))
      for (const e of forward) {
        const a = old[e.from],
          b = old[e.to];
        if (!a || !b) continue;
        // Use the common container's direction, not either endpoint's private axis.
        const aps = idx.parents(e.from),
          bps = idx.parents(e.to),
          common = aps.find(id => bps.includes(id));
        let direction = doc.settings.direction;
        for (const id of [common, ...(common ? idx.parents(common) : [])]) {
          const d = doc.layout.containers[id!]?.direction;
          if (d && d !== 'inherit') {
            direction = d;
            break;
          }
        }
        const v = direction === 'DOWN',
          need = (v ? a.h : b.w) / 2 + (v ? b.h : a.w) / 2 + (doc.settings.rankGap || 52),
          delta = v ? center(b).y - center(a).y : center(b).x - center(a).x,
          excess = need - delta;
        if (excess > 0) {
          const p = excess * (s.mode === 'flow' ? 0.28 : 0.09);
          push(e.from, v ? 0 : -p, v ? -p : 0, 0.5);
          push(e.to, v ? 0 : p, v ? p : 0, 0.5);
        }
      }
    // Near-box repulsion accounts for the actual rectangles, not point nodes.
    for (let i = 0; i < visible.length; i++)
      for (let j = i + 1; j < visible.length; j++) {
        const a = old[visible[i].id],
          b = old[visible[j].id],
          ac = center(a),
          bc = center(b),
          gap = doc.settings.nodeGap || 24;
        const ox = (a.w + b.w) / 2 + gap - Math.abs(bc.x - ac.x),
          oy = (a.h + b.h) / 2 + gap - Math.abs(bc.y - ac.y);
        if (ox <= 0 || oy <= 0) continue;
        const signX = bc.x >= ac.x ? 1 : -1,
          signY = bc.y >= ac.y ? 1 : -1,
          dx = ox < oy ? ox * signX * 0.65 : 0,
          dy = ox >= oy ? oy * signY * 0.65 : 0;
        push(visible[i].id, -dx, -dy, 0.5);
        push(visible[j].id, dx, dy, 0.5);
      }
  }
  for (const [id, fv] of forces) {
    let dx = fv.x / Math.max(1, s.mode === 'restore' ? 1 : Math.sqrt(fv.n)),
      dy = fv.y / Math.max(1, s.mode === 'restore' ? 1 : Math.sqrt(fv.n));
    const d = Math.hypot(dx, dy),
      limit = budget * weights[id],
      scale = d > limit ? limit / d : 1;
    // Feathering applies even below the cap; at the boundary it tends to zero.
    if (d <= budget) {
      dx *= weights[id] * strength;
      dy *= weights[id] * strength;
    } else {
      dx *= scale;
      dy *= scale;
    }
    const q = constrainedTarget(input, nodes, id, { x: old[id].x + dx, y: old[id].y + dy });
    nodes[id].x = q.x;
    nodes[id].y = q.y;
  }
  // Only changed-versus-visible obstacle pairs can acquire a new collision.
  // Cache ancestry and old areas once, instead of O(n²) repeated scene scans.
  const movers = new Set(Object.keys(weights)),
    obstacles = [...doc.graph.nodes, ...doc.graph.groups].filter(n => idx.visible(n.id)),
    ancestry = new Map(obstacles.map(n => [n.id, new Set(idx.parents(n.id))])),
    pairs: Array<[string, string, number]> = [];
  for (let i = 0; i < obstacles.length; i++)
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i].id,
        b = obstacles[j].id;
      if ((!movers.has(a) && !movers.has(b)) || ancestry.get(a)!.has(b) || ancestry.get(b)!.has(a))
        continue;
      pairs.push([a, b, intersection(old[a], old[b])]);
    }
  const safe = () => pairs.every(([a, b, area]) => intersection(nodes[a], nodes[b]) <= area + 0.01);
  let accepted = false,
    attenuation = 1;
  const proposed = copy(nodes);
  for (let attempt = 0; attempt < 12; attempt++) {
    for (const id of Object.keys(weights)) {
      nodes[id].x = old[id].x + (proposed[id].x - old[id].x) * attenuation;
      nodes[id].y = old[id].y + (proposed[id].y - old[id].y) * attenuation;
    }
    if (safe()) {
      accepted = true;
      break;
    }
    attenuation *= 0.5;
  }
  if (!accepted) doc.layout.nodes = copy(old);
  const moved = Object.keys(weights).filter(id => distance(old[id], doc.layout.nodes[id]) > 0.001),
    maxDisplacement = Math.max(0, ...moved.map(id => distance(old[id], doc.layout.nodes[id])));
  return {
    document: doc,
    weights,
    locked: f.locked,
    moved,
    maxDisplacement,
    blocked: !accepted || attenuation < 0.02,
    attenuation,
    mode: s.mode,
  };
}
function summarizeFrames(frames: TraceFrame[]): TimelineFrame[] {
  let cumulative = 0;
  return frames.map((frame, i) => {
    const prev = frames[i - 1]?.nodes,
      keys = Object.keys(frame.nodes);
    let moved = 0,
      sum = 0,
      max = 0;
    if (prev)
      for (const id of keys) {
        const p = frame.nodes[id],
          q = prev[id];
        if (!q) continue;
        const d = Math.hypot(p.x - q.x, p.y - q.y, p.w - q.w, p.h - q.h);
        if (d > 0.01) moved++;
        sum += d * d;
        max = Math.max(max, d);
      }
    const travel = Math.sqrt(sum / Math.max(1, keys.length));
    cumulative += travel;
    return { ...frame, index: i, moved, travel, cumulative, maxMove: max };
  });
}
/** A rebuild recorded as frames, from the given arrangement to the computed finish. */
async function journey(input: Diagram, options: LayoutOptions = {}): Promise<Timeline> {
  const result = await LayoutLab.compute(input, {
    ...input.settings,
    ...options,
    mode: 'rebuild',
    warmStart: options.rebuild !== true,
    settle: true,
    maxIterations: options.maxIterations || 640,
    trace: true,
  });
  const frames: TraceFrame[] = [
    {
      nodes: copy(input.layout.nodes),
      iteration: 0,
      phase: 'Your arrangement',
      metrics: result.report.before,
    },
  ];
  for (const f of result.trace || []) {
    const prev = frames.at(-1)!;
    if (JSON.stringify(f.nodes) !== JSON.stringify(prev.nodes)) frames.push(f);
  }
  const end = {
    nodes: copy(result.document.layout.nodes),
    iteration: result.report.iterations,
    phase: 'Computed finish',
    metrics: result.report.after,
  };
  if (JSON.stringify(frames.at(-1)!.nodes) !== JSON.stringify(end.nodes)) frames.push(end);
  else frames.at(-1)!.phase = frames.length === 1 ? 'Already settled' : 'Computed finish';
  const checked = LayoutLab.settings({ ...input.settings, ...options });
  // Invocation-only constraints must never become persisted diagram settings.
  // Keep them in the optional history's provenance, not in the graph save.
  const persistent = Object.fromEntries(
    Object.keys(LayoutLab.defaults).map(key => [
      key,
      (checked as unknown as Record<string, unknown>)[key],
    ]),
  ) as unknown as LayoutSettings;
  const execution = {
    scope: options.scope || 'all',
    selected: copy(options.selected || []),
    fixedIds: copy(options.fixedIds || []),
    maxIterations: options.maxIterations || 640,
    warmStart: options.rebuild !== true,
    ...(options.containerId ? { containerId: options.containerId } : {}),
  };
  return {
    schemaVersion: 1,
    kind: 'diagram-studio-journey',
    baseline: copy(input),
    settings: persistent,
    execution,
    report: result.report,
    frames: summarizeFrames(frames),
    finalDocument: result.document,
    bookmarks: [{ index: 0, title: 'Before layout' }],
    createdAt: new Date().toISOString(),
  };
}
function lookahead(frames: TimelineFrame[], index: number, pixels = 48, scale = 1) {
  const a = frames[index];
  if (!a) return index;
  for (let i = index + 1; i < frames.length; i++) {
    const amount = Math.max(
      ...Object.keys(a.nodes).map(id => distance(a.nodes[id], frames[i].nodes[id])),
    );
    if (amount * scale >= pixels) return i;
  }
  return frames.length - 1;
}
export const SculptLab = {
  defaults,
  settings,
  weight,
  rectDistance,
  field,
  dab,
  journey,
  lookahead,
  summarizeFrames,
  violationPairs,
  noWorse,
};
