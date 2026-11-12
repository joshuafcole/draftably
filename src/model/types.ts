export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Side = 'left' | 'right' | 'top' | 'bottom';
export type PortSide = Side | 'auto';
export type Direction = 'RIGHT' | 'DOWN';
export type Theme = 'light' | 'dark';
import type { DiagramAppearance, Shade } from './appearance';
import type { EndMarker } from './markers';
import type { Spot, Status } from './status';

export type ShapeKind =
  | 'box'
  | 'pill'
  | 'circle'
  | 'diamond'
  | 'text'
  | 'icon'
  | 'image'
  /** A seam between two cells of a `cells` group. */
  | 'marker'
  /** Something outside the drawing, set at its frame after layout (`dsl/portals.ts`). */
  | 'portal';
/** A color family: a built-in one, one the file defines, or `auto` for the theme's surface. */
export type ColorKey = string;
export type LabelMode = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'detached';

export interface DiagramNode {
  id: string;
  title: string;
  /** Title before a change, from `was=` on a `~` line. */
  was?: string;
  /** Shape before a change, from `was-shape=` on a `~` line. */
  wasShape?: ShapeKind;
  /** Count before a change, from `was-count=` on a `~` line; 1 means a single box. */
  wasCount?: number | string;
  /**
   * Top-left corner before a change, from `was-at=` on a `~` line, in drawing coordinates: the
   * merged drawing's parent content origin plus the file's numbers.
   */
  wasAt?: Point;
  /** Size before a change, from `was-size=` on a `~` line. */
  wasSize?: { w: number; h: number };
  /** A link to open from exported drawings. */
  href?: string;
  /** How many things this box stands for, or a symbol such as `N`; drawn as a stack with a badge. */
  count?: number | string;
  /** A cell's columns (or units), or `var` for a field of variable length. */
  span?: number | 'var';
  parentId?: string;
  image?: string;
  /** A sequence participant: length of the dashed lifeline below the box. */
  lifeline?: number;
}

export interface DiagramGroup {
  id: string;
  title: string;
  /** Title before a change, from `was=` on a `~` line. */
  was?: string;
  /** Top-left corner before a change, from `was-at=` on a `~` line, in drawing coordinates. */
  wasAt?: Point;
  /** A link to open from exported drawings. */
  href?: string;
  parentId?: string;
  /** `soft` draws a tint behind the members instead of a frame; `none` draws nothing. */
  frame?: 'soft' | 'none';
  /** Lines the title wraps to, when more than one; the header grows by a line for each. */
  titleLines?: number;
  /** A soft group's tint: rectangles relative to the group's top left; the first holds the label. */
  hull?: Rect[];
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  /** Label before a change, from `was=` on a `~` line. */
  was?: string;
  directed: boolean;
  /** The mark at the target end, when it isn't the plain arrow; see `headOf`. */
  head?: EndMarker;
  /** The mark at the source end, when it has one; see `tailOf`. */
  tail?: EndMarker;
  emphasis: boolean;
  dashed: boolean;
  /** How it differs between two versions of the diagram. */
  status?: Status;
  /** How the drawn emphasis state treats it; see `withState`. */
  spot?: Spot;
}

export interface NodeLayout extends Rect {
  manual?: boolean;
  pinned?: boolean;
}

export interface EdgeLayout {
  fromSide?: PortSide;
  toSide?: PortSide;
  labelDx?: number;
  labelDy?: number;
  waypoints?: Point[];
  /**
   * The waypoints are a soft `route`: when the router finds no way through them the line is
   * routed without them and marked `gaveWay`. Without it, waypoints hold as drawn.
   */
  softRoute?: boolean;
  /**
   * Where the label sits, from a `label` statement: `at` is a fraction of the drawn line's length
   * from its source, and `offset` a distance off it, positive to the left of its way. Without it
   * the label takes the clearest spot on its line, plus `labelDx`/`labelDy`.
   */
  labelAt?: { at: number; offset: number };
  /** The reading direction of the layout that places both ends; the edge runs along it. */
  flow?: 'right' | 'down';
  /** Set by the compiler for a fold's wrap edge: the line it returns along, between two bands. */
  lane?: Lane;
  /** From a lane, at route time: where along its target's side the edge arrives, off centre. */
  toOffset?: number;
  /** A sequence message: drawn straight between the two lifelines at this height, not routed. */
  row?: number;
  /**
   * Set by the compiler for a forward line in a `flow` scope: its route planned from the ranks.
   * The quick router takes it as it is when it clears every box.
   */
  plan?: { points: Point[]; fromOffset: number; toOffset: number };
}

/**
 * A channel between two bands of a fold: a level line at `y`, or an upright one at `x`. With
 * `leave`, the edge leaves its source's side and turns onto the lane at that coordinate; with
 * `enter`, it runs on along the lane to that coordinate and turns into its target's side.
 * With `out`, it is a return or skip lane beyond both ends.
 */
export type Lane = ({ y: number } | { x: number }) & {
  leave?: number;
  enter?: number;
  /**
   * A lane beyond both ends, outside their band: the edge leaves by the side facing it, runs
   * along it, and at `enter` turns into the target's side that faces back toward the source.
   */
  out?: boolean;
  /**
   * With `out`: the gap beside the target holds another edge's label, so the edge arrives square
   * on the target's face toward the lane, at `enter` (its middle), instead of turning into that gap.
   */
  face?: boolean;
};

export interface LabelLayout {
  mode?: LabelMode;
  dx?: number;
  dy?: number;
  width?: number;
  leader?: boolean;
}

export interface ContainerLayout {
  direction: 'inherit' | Direction;
  padding: number;
  manualSize: boolean;
  /** Set for a `cells` group: its members touch, under a title band this tall. */
  cellsBand?: number;
  /** A byte or bit layout's extra marks, relative to the group's top-left corner. */
  cellsChrome?: CellsChrome;
}

/** What a byte or bit layout draws besides its cells. */
export interface CellsChrome {
  /** Unit numbers in a strip under the title band. */
  ruler?: { y: number; h: number; ticks: Array<{ x: number; label: string }> };
  /** Further pieces of fields that run on past a row's end, by field. */
  pieces?: Record<string, Rect[]>;
  /** Fields of variable length, drawn with broken ends. */
  open?: string[];
}

export type IntentRole = 'start' | 'end';
export type IntentPlacement =
  | 'top-left'
  | 'left-center'
  | 'center'
  | 'top-center'
  | 'top-right'
  | 'right-center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';
export type LayoutIntent = Partial<Record<IntentRole, { id: string; placement: IntentPlacement }>>;

export interface NodeStyle {
  shape: ShapeKind;
  color: ColorKey;
  /** Numeric shade; omitted means the default for the object (500 for nodes, 100 for groups). */
  shade?: Shade;
  icon: string;
  /** How it differs between two versions of the diagram. */
  status?: Status;
  /** How the drawn emphasis state treats it; see `withState`. */
  spot?: Spot;
}

export type LayoutAlgorithmId =
  | 'compound-flow'
  | 'boundary-align'
  | 'compound-spring'
  | 'tidy'
  | 'stress'
  | 'force'
  | 'flow'
  | 'layered'
  | 'tree'
  | 'grid'
  | 'separate';

export type AspectSetting = 'canvas' | '1' | '1.333' | '1.6' | '2' | '0.75';

export interface LayoutSettings {
  algorithm: LayoutAlgorithmId;
  direction: Direction;
  mode: 'pass' | 'rebuild';
  maxMove: number;
  stability: number;
  iterations: number;
  nodeGap: number;
  rankGap: number;
  edgeLength: number;
  repulsion: number;
  flowStrength: number;
  alignment: number;
  compactness: number;
  gridStrength: number;
  aspect: AspectSetting;
  fold: 'auto' | 'never';
  respectDirection: boolean;
  ordering: 'stable' | 'crossings';
  rootId: string;
  respectManual: boolean;
  growContainers: boolean;
  boundaryPull: number;
  hierarchySweeps: number;
  groupGap: number;
}

export interface RoutingSettings {
  /**
   * `on` draws a small arc where a level run passes over an upright line it doesn't share an end
   * with. Drawing only: the routes are unchanged.
   */
  hops?: 'on' | 'off';
  clearance: number;
  portGap: number;
  edgeGap: number;
  bendPenalty: number;
  crossingPenalty: number;
  sharedPenalty: number;
  parallelPenalty: number;
  portStability: number;
  fanoutPenalty: number;
  passes: number;
  cornerRadius: number;
  standoff: number;
  /**
   * Run this many or more lines between one pair of ends as one trunk (`model/bundles.ts`);
   * unset or 0 draws every line on its own. Read after routing, never by the router.
   */
  bundle?: number;
}

export interface DiagramSettings extends LayoutSettings {
  snap: boolean;
  showManual: boolean;
  routing: RoutingSettings;
}

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface Diagram {
  schemaVersion: 2;
  id: string;
  title: string;
  graph: { nodes: DiagramNode[]; edges: DiagramEdge[]; groups: DiagramGroup[] };
  layout: {
    nodes: Record<string, NodeLayout>;
    edges: Record<string, EdgeLayout>;
    labels: Record<string, LabelLayout>;
    containers: Record<string, ContainerLayout>;
    intent: LayoutIntent;
    /** A sequence diagram's frame and the row bands of its `phase` statements. */
    sequence?: SequenceLayout;
  };
  styles: Record<string, NodeStyle>;
  collapsed: string[];
  settings: DiagramSettings;
  camera: Camera;
  /** Editor light or dark mode; independent of the diagram's appearance. */
  theme: Theme;
  /** Diagram theme, overrides and color definitions. Saved with the diagram. */
  appearance: DiagramAppearance;
  /**
   * The emphasis state this document is drawn in, set by `withState` and never saved. Notes read
   * it: a note with `states=` shows only in the states it lists.
   */
  drawnState?: string;
}

export type NodeGeometry = Record<string, NodeLayout>;

/** The panel a sequence diagram is drawn on, and a row band for each `phase`. */
export interface SequenceLayout {
  panel: Rect;
  phases: SequencePhase[];
  /** Left edge for phase labels, when a note in the left margin widens the panel past them. */
  phaseX?: number;
  /** Spots of the notes that sit in a side margin, by index in `appearance.notes`. */
  notes?: Array<Rect | null>;
  /** With `notes`: the panel without those margins, for drawings with their notes in the frame. */
  inner?: Rect;
  /**
   * From `was-order`: each message's row and the phase bands in the older message order, and how
   * much further that order runs down the panel.
   */
  before?: { rows: Record<string, number>; phases: SequencePhase[]; grow: number };
}

export type SequencePhase = { id: string; label: string; y: number; h: number };

/** Any object that can be selected: a shape, a container, or a connection. */
export type Entity = DiagramNode | DiagramGroup | DiagramEdge;
