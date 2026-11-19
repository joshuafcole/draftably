/* Reproducible experiments, not persisted views.
 * Every candidate starts from the same frozen document and explicit settings.
 * The engine is DOM-free and runs in a worker or in Node-based tests.
 */
import type { Diagram, LayoutAlgorithmId, LayoutIntent } from '../model/types.ts';
import { LayoutLab } from './layout-engine.ts';
import type { LayoutReport, LayoutScope } from './layout-engine.ts';
import { RouteLab } from './routing-engine.ts';
import type { PriorRoute, RouteInput, RoutingResult } from './routing-engine.ts';

export type ParamValue = string | number | boolean;

export interface ParamDefinition {
  name: string;
  values: ParamValue[];
  passOnly?: boolean;
}

export type ComparisonMode = 'layout' | 'routing';
export type ComparisonRun = 'rebuild' | 'warm' | 'pass';

export interface ComparisonConfig {
  mode: ComparisonMode;
  /** Engines, the suggested routing alternatives, or a grid of parameter values. */
  kind: 'algorithms' | 'routes' | 'parameters';
  algorithm: LayoutAlgorithmId;
  algorithms: LayoutAlgorithmId[];
  axisA: string;
  valuesA: string;
  axisB: string;
  valuesB: string;
  run: ComparisonRun;
  maxIterations: number;
  scope: LayoutScope;
  autoPorts: boolean;
  selected: string[];
  containerId?: string;
  fixedIds: string[];
  intent: LayoutIntent;
  viewport: { w: number; h: number };
  priorRoutes: PriorRoute[];
}

export interface CandidateSpec {
  key: string;
  title: string;
  subtitle: string;
  patch: Record<string, ParamValue>;
}

export interface CandidateResult {
  spec: CandidateSpec;
  document: Diagram;
  report: LayoutReport | null;
  routing: RoutingResult;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const LAYOUT_PARAMS: Record<string, ParamDefinition> = {
  direction: { name: 'Flow direction', values: ['RIGHT', 'DOWN'] },
  nodeGap: { name: 'Shape gap', values: [12, 24, 44] },
  rankGap: { name: 'Rank gap', values: [28, 52, 88] },
  edgeLength: { name: 'Link length', values: [48, 88, 144] },
  aspect: { name: 'Target aspect', values: ['1', '1.6', '2'] },
  respectDirection: { name: 'Respect arrows', values: [true, false] },
  flowStrength: { name: 'Forward pressure', values: [25, 65, 100] },
  ordering: { name: 'Rank ordering', values: ['stable', 'crossings'] },
  fold: { name: 'Sequence folding', values: ['never', 'auto'] },
  alignment: { name: 'Alignment', values: [20, 55, 90] },
  compactness: { name: 'Compactness', values: [10, 35, 80] },
  repulsion: { name: 'Repulsion', values: [20, 45, 80] },
  gridStrength: { name: 'Grid attraction', values: [20, 45, 90] },
  boundaryPull: { name: 'Boundary pull', values: [25, 65, 100] },
  hierarchySweeps: { name: 'Hierarchy sweeps', values: [1, 2, 4] },
  groupGap: { name: 'Container gap', values: [24, 48, 80] },
  growContainers: { name: 'Grow frames', values: [false, true] },
  respectManual: { name: 'Protect manual placement', values: [false, true] },
  maxMove: { name: 'Pass movement cap', values: [24, 48, 96], passOnly: true },
  stability: { name: 'Pass stability', values: [20, 65, 90], passOnly: true },
  iterations: { name: 'Pass iterations', values: [16, 32, 64], passOnly: true },
};
const ROUTE_PARAMS: Record<string, ParamDefinition> = {
  edgeGap: { name: 'Parallel edge gap', values: [10, 18, 28] },
  bendPenalty: { name: 'Bend cost', values: [16, 64] },
  clearance: { name: 'Shape clearance', values: [6, 12, 22] },
  portGap: { name: 'Port spacing', values: [10, 18, 26] },
  crossingPenalty: { name: 'Crossing cost', values: [100, 360, 900] },
  parallelPenalty: { name: 'Lane separation cost', values: [6, 18, 40] },
  sharedPenalty: { name: 'Shared-path cost', values: [2, 8, 16] },
  fanoutPenalty: { name: 'Fan-out cost', values: [0, 50, 120] },
  portStability: { name: 'Previous-side stability', values: [0, 40, 100] },
  passes: { name: 'Refinement passes', values: [1, 3, 5] },
  cornerRadius: { name: 'Corner radius', values: [0, 6, 12] },
};
/* Routing alternatives that together covered every feasible case in the layout-config study. */
const ROUTE_ALTERNATIVES: Array<Omit<CandidateSpec, 'key'>> = [
  { title: 'Tighter clearance', subtitle: 'clearance=4', patch: { clearance: 4 } },
  { title: 'More clearance', subtitle: 'clearance=22', patch: { clearance: 22 } },
  { title: 'Wider endpoints', subtitle: 'port-gap=28', patch: { portGap: 28 } },
];
function parseValues(key: string, text: string, mode: ComparisonMode = 'layout'): ParamValue[] {
  const def = (mode === 'routing' ? ROUTE_PARAMS : LAYOUT_PARAMS)[key];
  if (!def) throw Error('Unknown parameter: ' + key);
  const strings = String(text)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  if (!strings.length || strings.length > 6)
    throw Error('Enter between one and six comma-separated values for ' + def.name + '.');
  return strings.map(v => {
    if (typeof def.values[0] === 'boolean') {
      if (!['true', 'false'].includes(v.toLowerCase()))
        throw Error(def.name + ' accepts true or false.');
      return v.toLowerCase() === 'true';
    }
    if (typeof def.values[0] === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw Error(def.name + ' requires numbers.');
      return n;
    }
    return v;
  });
}
function effectiveParams(
  algorithm: LayoutAlgorithmId,
  run: ComparisonRun,
): Record<string, ParamDefinition> {
  const a = LayoutLab.algorithms.find(a => a.id === algorithm);
  const keys = new Set<string>([
    'direction',
    'nodeGap',
    'rankGap',
    'respectDirection',
    'flowStrength',
    'respectManual',
    'growContainers',
    ...(a?.controls || []),
  ]);
  if (
    a?.controls.includes('fold') ||
    ['force', 'stress', 'grid', 'tidy', 'compound-spring'].includes(algorithm)
  )
    keys.add('aspect');
  if (run === 'pass')
    for (const [key, p] of Object.entries(LAYOUT_PARAMS)) if (p.passOnly) keys.add(key);
  if (algorithm === 'separate')
    return Object.fromEntries(
      Object.entries(LAYOUT_PARAMS).filter(
        ([k, p]) =>
          ['nodeGap', 'respectManual', 'growContainers'].includes(k) ||
          (p.passOnly && run === 'pass'),
      ),
    );
  return Object.fromEntries(
    Object.entries(LAYOUT_PARAMS).filter(
      ([k, p]) => keys.has(k) && (!p.passOnly || run === 'pass'),
    ),
  );
}
function specs(config: ComparisonConfig): CandidateSpec[] {
  const mode = config.mode === 'routing' ? 'routing' : 'layout',
    result: CandidateSpec[] = [];
  if (mode === 'routing' && config.kind === 'routes') {
    ROUTE_ALTERNATIVES.forEach((spec, i) => result.push({ key: 'route-' + i, ...spec }));
  } else if (mode === 'layout' && config.kind === 'algorithms') {
    const ids = [...new Set(config.algorithms || [])];
    if (!ids.length) throw Error('Choose at least one approach.');
    for (const id of ids) {
      const a = LayoutLab.algorithms.find(a => a.id === id);
      if (!a) throw Error('Unknown algorithm: ' + id);
      result.push({ key: id, title: a.name, patch: { algorithm: id }, subtitle: a.family });
    }
  } else {
    const defs = mode === 'routing' ? ROUTE_PARAMS : effectiveParams(config.algorithm, config.run);
    if (!defs[config.axisA]) throw Error('Choose a parameter used by this approach.');
    if (config.axisB && config.axisA === config.axisB)
      throw Error('Choose different row and column parameters.');
    if (config.axisB && !defs[config.axisB])
      throw Error('The second parameter is not active for this approach.');
    const a = parseValues(config.axisA, config.valuesA, mode),
      b = config.axisB ? parseValues(config.axisB, config.valuesB, mode) : [null];
    for (const bv of b)
      for (const av of a) {
        const patch = {
          [config.axisA]: av,
          ...(config.axisB ? { [config.axisB]: bv as ParamValue } : {}),
        };
        result.push({
          key: 'cell-' + result.length,
          title: defs[config.axisA].name + ' = ' + av,
          subtitle: config.axisB ? defs[config.axisB].name + ' = ' + bv : 'One-parameter sweep',
          patch: mode === 'layout' ? { algorithm: config.algorithm, ...patch } : patch,
        });
      }
  }
  if (result.length > 12)
    throw Error('This grid has ' + result.length + ' candidates. Keep it to 12 or fewer.');
  return result;
}
/** The scene as the router sees it: collapsed groups stand in for their members. */
function sceneInput(doc: Diagram): RouteInput {
  const by = new Map([...doc.graph.nodes, ...doc.graph.groups].map(n => [n.id, n]));
  function ancestors(id: string) {
    const list: string[] = [];
    for (let p = by.get(id)?.parentId; p; p = by.get(p)?.parentId) list.push(p);
    return list;
  }
  function proxy(id: string) {
    let p = id;
    for (const a of ancestors(id)) if (doc.collapsed.includes(a)) p = a;
    return p;
  }
  const nodes = doc.graph.nodes
    .filter(n => proxy(n.id) === n.id)
    .map(n => ({ ...n, ...doc.layout.nodes[n.id], shape: doc.styles[n.id]?.shape || 'box' }));
  const groups = doc.graph.groups
    .filter(g => !ancestors(g.id).some(p => doc.collapsed.includes(p)))
    .map(g => {
      const r = doc.layout.nodes[g.id],
        collapsed = doc.collapsed.includes(g.id);
      return { ...g, ...r, ...(collapsed ? { w: Math.min(r.w, 210), h: 58 } : {}), collapsed };
    });
  const edges = doc.graph.edges
    .map(e => ({ ...e, from: proxy(e.from), to: proxy(e.to), cfg: doc.layout.edges[e.id] || {} }))
    .filter(
      e =>
        e.from !== e.to ||
        doc.graph.edges.find(x => x.id === e.id)!.from ===
          doc.graph.edges.find(x => x.id === e.id)!.to,
    );
  return { nodes, groups, edges };
}
async function candidate(
  baseline: Diagram,
  spec: CandidateSpec,
  config: ComparisonConfig,
): Promise<CandidateResult> {
  let document = copy(baseline),
    report: LayoutReport | null = null;
  if (config.mode !== 'routing') {
    document.layout.intent = LayoutLab.normalizeIntent(
      config.intent || document.layout.intent || {},
      new Set(document.graph.nodes.map(n => n.id)),
    );
    const raw = { ...document.settings, ...spec.patch };
    const checked = LayoutLab.settings(raw);
    for (const [key, v] of Object.entries(spec.patch))
      if ((checked as unknown as Record<string, unknown>)[key] !== v)
        throw Error('Value for ' + key + ' is outside the supported range.');
    const result = await LayoutLab.compute(document, {
      ...checked,
      fixedIds: config.fixedIds || [],
      mode: config.run === 'pass' ? 'pass' : 'rebuild',
      warmStart: config.run === 'warm',
      settle: config.run !== 'pass',
      maxIterations: config.maxIterations || 640,
      scope: config.scope || 'all',
      selected: config.selected || [],
      containerId: config.containerId,
      viewport: config.viewport || { w: 1200, h: 760 },
    });
    document = result.document;
    report = result.report;
  } else {
    const raw = { ...document.settings.routing, ...spec.patch },
      checked = RouteLab.settings(raw);
    for (const [key, v] of Object.entries(spec.patch))
      if ((checked as unknown as Record<string, unknown>)[key] !== v)
        throw Error('Value for ' + key + ' is outside the supported range.');
    document.settings.routing = checked;
    if (config.autoPorts)
      for (const cfg of Object.values(document.layout.edges)) {
        cfg.fromSide = 'auto';
        cfg.toSide = 'auto';
      }
  }
  // A shared prior route set makes port-stability experiments comparable.
  // It is geometry-only session data; it is never imported as graph meaning.
  const routing = RouteLab.compute(sceneInput(document), {
    ...document.settings.routing,
    previous: config.priorRoutes || [],
  });
  return { spec: copy(spec), document, report, routing };
}
export const ExplorerLab = {
  layoutParams: LAYOUT_PARAMS,
  routeParams: ROUTE_PARAMS,
  parseValues,
  effectiveParams,
  specs,
  sceneInput,
  candidate,
};
