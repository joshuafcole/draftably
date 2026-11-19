import type { LayoutSettings } from '../../model/types.ts';
import type { LayoutAlgorithm } from './types.ts';
import { clamp } from './util.ts';

type RangeKey =
  | 'maxMove'
  | 'stability'
  | 'iterations'
  | 'nodeGap'
  | 'rankGap'
  | 'edgeLength'
  | 'repulsion'
  | 'flowStrength'
  | 'alignment'
  | 'compactness'
  | 'gridStrength'
  | 'boundaryPull'
  | 'hierarchySweeps'
  | 'groupGap';
/** Settings before the checks: any algorithm name, and whatever else the caller passed. */
type Loose = Omit<LayoutSettings, 'algorithm'> & { algorithm: string };

export const ALGORITHMS: LayoutAlgorithm[] = [
  {
    id: 'compound-flow',
    name: 'Compound flow',
    family: 'Cross-hierarchy layered',
    short:
      'Order nested blocks by all their connections; bring inputs and outputs toward the relevant boundary.',
    controls: ['rankGap', 'groupGap', 'boundaryPull', 'hierarchySweeps', 'ordering', 'fold'],
    detail:
      'Bottom-up projected sibling graphs plus global terminal ranks and exact-endpoint boundary forces. Alternating hierarchy sweeps let inner and outer levels inform each other. An original heuristic, not ELK.',
  },
  {
    id: 'boundary-align',
    name: 'Boundary alignment',
    family: 'Cross-hierarchy local repair',
    short: 'Line up connected endpoints across containers without rebuilding the whole structure.',
    controls: ['boundaryPull', 'hierarchySweeps', 'alignment', 'groupGap'],
    detail:
      'Warm-start transverse endpoint alignment and mild link-length relaxation, applied to leaves and translated subtrees. No hard rank assignment during improvement passes. Scope, pins and total displacement caps remain in force.',
  },
  {
    id: 'compound-spring',
    name: 'Compound spring',
    family: 'Hierarchical force-directed',
    short:
      'Relax nested systems using the actual connected children, rather than container centres.',
    controls: ['edgeLength', 'boundaryPull', 'hierarchySweeps', 'groupGap', 'compactness'],
    detail:
      'Size-aware springs at actual leaf endpoints transfer force to their direct sibling owners. External neighbours act as temporary boundary anchors. Rectangular separation and alternating hierarchy sweeps constrain the result. Not CoSE or fCoSE.',
  },
  {
    id: 'tidy',
    name: 'Local tidy',
    family: 'Local optimisation',
    short: 'Shorten stretched links and align nearby neighbours. Keep the overall arrangement.',
    controls: ['edgeLength', 'alignment', 'compactness'],
    detail:
      'A warm-start spring / alignment hybrid with a displacement anchor and rectangular separation. Designed for small repairs, not global crossing optimisation.',
  },
  {
    id: 'stress',
    name: 'Stress descent',
    family: 'Distance optimisation',
    short: 'Balance the whole network using graph distances, without restarting it.',
    controls: ['edgeLength', 'compactness'],
    detail:
      'Weighted all-pairs shortest-path stress, solved with diagonal-preconditioned gradient steps. Anchored and projected; not an implementation of the full stress-majorisation algorithm.',
  },
  {
    id: 'force',
    name: 'Spring network',
    family: 'Force-directed',
    short: 'Let connected clusters find an organic, compact arrangement.',
    controls: ['edgeLength', 'repulsion', 'compactness'],
    detail:
      'Fruchterman–Reingold-style attraction and repulsion with cooling and rectangular collision projection. Quadratic pair evaluation, not Barnes–Hut.',
  },
  {
    id: 'flow',
    name: 'Directional flow',
    family: 'Constraint relaxation',
    short: 'Encourage a reading direction without forcing rows or columns.',
    controls: ['edgeLength', 'flowStrength', 'alignment'],
    detail:
      'Soft directed separation constraints on a cycle-broken graph, plus edge springs and neighbour alignment. Feedback edges remain rendered; they do not impose contradictory directional constraints.',
  },
  {
    id: 'layered',
    name: 'Layered + fold',
    family: 'Hierarchical',
    short: 'Ranks and crossing sweeps, with optional aspect-aware folding.',
    controls: ['rankGap', 'ordering', 'fold'],
    detail:
      'A local Sugiyama-style pipeline: deterministic feedback-edge handling, longest-path ranks, barycentric sweeps, dimension-aware coordinates and optional row folding. Not ELK or Graphviz.',
  },
  {
    id: 'tree',
    name: 'Subtree tree',
    family: 'Tree drawing',
    short: 'Centre parents above their children and give each subtree its own space.',
    controls: ['rankGap', 'rootId'],
    detail:
      'Builds a deterministic breadth-first spanning forest, reserves subtree spans, and centres parents over their children. Non-tree edges are kept. This is a span-based implementation, not Buchheim’s linear-time tidy-tree algorithm.',
  },

  {
    id: 'grid',
    name: 'Soft grid',
    family: 'Assignment + relaxation',
    short: 'Attract boxes toward nearby free cells, without a permanently rigid grid.',
    controls: ['gridStrength', 'compactness'],
    detail:
      'Stable greedy nearest-free-cell assignment around the current centre, followed by soft attraction and rectangular separation. Manual movement remains unrestricted. Not globally optimal matching.',
  },
  {
    id: 'separate',
    name: 'Separate overlaps',
    family: 'Geometric repair',
    short: 'Move only colliding neighbours. Leave clean regions alone.',
    controls: [],
    detail:
      'Pairwise minimum-axis translations of padded rectangles, with hard pins, boundary constraints and a per-action movement limit. Does not optimise connectivity or promise a globally minimum displacement.',
  },
];
export const defaults: LayoutSettings = {
  algorithm: 'tidy',
  direction: 'RIGHT',
  mode: 'pass',
  maxMove: 48,
  stability: 65,
  iterations: 32,
  nodeGap: 24,
  rankGap: 52,
  edgeLength: 88,
  repulsion: 45,
  flowStrength: 65,
  alignment: 55,
  compactness: 35,
  gridStrength: 45,
  aspect: '1.6',
  fold: 'never',
  respectDirection: true,
  ordering: 'stable',
  rootId: '',
  respectManual: false,
  growContainers: false,
  boundaryPull: 65,
  hierarchySweeps: 2,
  groupGap: 48,
};
/** Checked settings: defaults under `values`, old names mapped, numbers held to their ranges. */
export function settings(values: object = {}): LayoutSettings {
  const s: Loose = { ...defaults, ...values };
  if (s.algorithm === 'radial') s.algorithm = 'tree';
  if (s.algorithm === 'compact') s.algorithm = 'layered';
  if (!ALGORITHMS.some(a => a.id === s.algorithm))
    throw Error('Unknown layout algorithm: ' + s.algorithm);
  if (!['RIGHT', 'DOWN'].includes(s.direction)) throw Error('Direction must be RIGHT or DOWN.');
  if (!['pass', 'rebuild'].includes(s.mode)) throw Error('Mode must be pass or rebuild.');
  if (!['auto', 'never'].includes(s.fold)) throw Error('Fold must be auto or never.');
  if (!['stable', 'crossings'].includes(s.ordering))
    throw Error('Ordering must be stable or crossings.');
  const ranges: Record<RangeKey, [number, number]> = {
    maxMove: [4, 300],
    stability: [0, 100],
    iterations: [4, 160],
    nodeGap: [4, 160],
    rankGap: [12, 220],
    edgeLength: [20, 260],
    repulsion: [0, 100],
    flowStrength: [0, 100],
    alignment: [0, 100],
    compactness: [0, 100],
    gridStrength: [0, 100],
    boundaryPull: [0, 100],
    hierarchySweeps: [1, 4],
    groupGap: [12, 180],
  };
  for (const [k, [lo, hi]] of Object.entries(ranges) as Array<[RangeKey, [number, number]]>) {
    if (typeof s[k] !== 'number' || !Number.isFinite(s[k]))
      throw Error(k + ' must be a finite number.');
    s[k] = clamp(s[k], lo, hi);
  }
  s.iterations = Math.round(s.iterations);
  s.hierarchySweeps = Math.round(s.hierarchySweeps);
  if (!['canvas', '1', '1.333', '1.6', '2', '0.75'].includes(String(s.aspect)))
    throw Error('Unknown target aspect ratio.');
  for (const key of ['respectManual', 'growContainers', 'respectDirection'] as const)
    if (typeof s[key] !== 'boolean') throw Error(key + ' must be a boolean.');
  if (typeof s.rootId !== 'string') throw Error('Root must be an object ID.');
  return s as LayoutSettings;
}
