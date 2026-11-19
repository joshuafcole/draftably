import type {
  Diagram,
  Direction,
  IntentPlacement,
  LayoutAlgorithmId,
  LayoutIntent,
  LayoutSettings,
  NodeGeometry,
  NodeLayout,
  Point,
  Rect,
} from '../../model/types.ts';

export type LayoutSettingKey =
  | 'boundaryPull'
  | 'hierarchySweeps'
  | 'groupGap'
  | 'rankGap'
  | 'edgeLength'
  | 'repulsion'
  | 'flowStrength'
  | 'alignment'
  | 'compactness'
  | 'gridStrength'
  | 'ordering'
  | 'fold'
  | 'rootId';

export interface LayoutAlgorithm {
  id: LayoutAlgorithmId;
  name: string;
  family: string;
  short: string;
  detail: string;
  controls: LayoutSettingKey[];
}

export interface LayoutMetrics {
  overlaps: number;
  overlapArea: number;
  width: number;
  height: number;
  aspect: number;
  area: number;
  linkLength: number;
}

export type LayoutScope = 'all' | 'selection' | 'neighbourhood' | 'container';

export interface LayoutOptions extends Partial<LayoutSettings> {
  scope?: LayoutScope;
  containerId?: string;
  selected?: string[];
  fixedIds?: string[];
  viewport?: { w: number; h: number };
  warmStart?: boolean;
  settle?: boolean;
  maxIterations?: number;
  trace?: boolean;
  rebuild?: boolean;
  /** Travel per tick below which a settling solve counts the tick as quiet; 0.08 when unset. */
  tolerance?: number;
  /** False restores the v7 order within ranks: a rebuild never keeps the authored order. */
  orderPrior?: boolean;
}

export type Termination = 'settled' | 'objective plateau' | 'iteration limit' | 'bounded pass';

/** Why one solve of one container's children stopped. */
export interface SolverStop {
  parentId: string | null;
  iterations: number;
  reason: Exclude<Termination, 'bounded pass'>;
}

export interface LayoutReport {
  intent: Array<{
    role: string;
    id: string;
    placement: IntentPlacement;
    error: number;
    satisfied: boolean;
    pinned: boolean;
  }>;
  backwardEdges: number;
  directedEdges: number;
  feedbackEdges: number;
  algorithm: LayoutAlgorithmId;
  name: string;
  mode: 'pass' | 'rebuild' | 'journey';
  scope: LayoutScope;
  moved: number;
  maxDisplacement: number;
  rmsDisplacement: number;
  movementLimit: number | null;
  iterations: number;
  batches: number;
  before: LayoutMetrics;
  after: LayoutMetrics;
  warnings: string[];
  milliseconds: number;
  deterministic: boolean;
  termination: Termination;
  solverStops: SolverStop[];
  /** Added by the app: where the computation ran. */
  thread?: string;
  /** Added by the app when a timeline step is kept. */
  selectedStep?: number;
}

export interface TraceFrame {
  nodes: NodeGeometry;
  iteration: number;
  phase: string;
  metrics: LayoutMetrics;
}

export interface LayoutResult {
  document: Diagram;
  report: LayoutReport;
  trace?: TraceFrame[];
}

/**
 * Settings inside a solve. `radial` is an old name that `settings` maps to `tree`, so no solve
 * runs with it; the radial target and its branches stay as the original engine had them.
 */
export interface Settings extends Omit<LayoutSettings, 'algorithm'> {
  algorithm: LayoutAlgorithmId | 'radial';
}

/** A box a solve places: a shape or a whole group, with its top-left corner and size. */
export type Item = Rect & { id: string; fixed?: boolean };

/** A link between two items of one solve. */
export interface Link {
  from: string;
  to: string;
  directed?: boolean;
}

export interface Topology<E extends Link = Link> {
  intent: LayoutIntent;
  /** Item IDs, sorted. */
  ids: string[];
  index: Map<string, number>;
  /** Directed neighbours out of, into, and (with undirected links) beside each item. */
  out: Map<string, string[]>;
  inc: Map<string, string[]>;
  adj: Map<string, string[]>;
  rank: Map<string, number>;
  /** `from + '\0' + to` of each directed link that runs against the ranks. */
  feedback: Set<string>;
  edges: E[];
  forward: E[];
  components: string[][];
  /** Source order of each item, when a rebuild keeps the authored order within ranks. */
  declared?: Map<string, number>;
  /** Which side of a centred start each item sits on: 1, -1, or 0 for the start. */
  branchSides?: Map<string, number>;
}

/** Centre points by item ID. */
export type Centres = Map<string, Point>;

export type Axis = 'x' | 'y';

export type { Diagram, Direction, LayoutIntent, NodeLayout, Point, Rect };
