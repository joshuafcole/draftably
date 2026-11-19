import type {
  EdgeLayout,
  Point,
  Rect,
  RoutingSettings,
  ShapeKind,
  Side,
} from '../../model/types.ts';

export interface RouteNodeInput extends Rect {
  id: string;
  parentId?: string;
  shape: ShapeKind;
  /** The stub for lines that end on an open group's frame: the group's rectangle. */
  frame?: boolean;
}

export interface RouteGroupInput extends Rect {
  id: string;
  parentId?: string;
  collapsed: boolean;
  /** Width of the header's icon and title from the group's left edge; the rest of the band is open. */
  titleWidth?: number;
  /** Height of the title band the router keeps clear; 28 when unset. */
  titleHeight?: number;
}

export interface RouteEdgeInput {
  id: string;
  from: string;
  to: string;
  directed?: boolean;
  /** The edge's text. A labelled edge keeps the full port gap in a fan. */
  label?: string;
  cfg: EdgeLayout;
}

export interface RouteInput {
  nodes: RouteNodeInput[];
  groups: RouteGroupInput[];
  edges: RouteEdgeInput[];
}

export interface Route {
  id: string;
  from: string;
  to: string;
  fromSide: Side;
  toSide: Side;
  fromOffset: number;
  toOffset: number;
  points: Point[];
  blocked: boolean;
  reason?: string;
}

export interface PriorRoute {
  id: string;
  fromSide: Side;
  toSide: Side;
}

/** What a set of routes costs: the counts the passes compare and the report shows. */
export interface RouteMetrics {
  crossings: number;
  shared: number;
  lanePairs: number;
  laneDeficit: number;
  minimumConflictingGap: number | null;
  requestedEdgeGap: number;
  blocked: number;
  bends: number;
  length: number;
}

export interface RoutingReport extends RouteMetrics {
  initial: RouteMetrics;
  accepted: number;
  /** Crossing pairs the repair pass rerouted. Absent with `quick` or `facing: false`. */
  repaired?: number;
  nudged: number;
  tidied?: number;
  edges: number;
  milliseconds: number;
  passes: number;
}

export interface RoutingResult {
  routes: Route[];
  report: RoutingReport;
}

export interface RoutingOptions extends Partial<RoutingSettings> {
  previous?: PriorRoute[];
  quick?: boolean;
  /** A reading direction for every edge without its own `cfg.flow`; forward edges run along it. */
  direction?: 'right' | 'down';
  /**
   * Keep fans on the sides facing their other ends, off far sides, and a full standoff away
   * from their own end boxes. On unless false.
   */
  facing?: boolean;
  /**
   * Keep lines out of a group's title band, except a line straight into or out of a member's
   * top. On unless false.
   */
  titleBands?: boolean;
  /** Search each route near its two boxes first, and the whole grid only when that fails. On unless false. */
  window?: boolean;
  /** Even out ports, fans and corridors after routing. On unless false. */
  tidy?: boolean;
  /**
   * In the tidy pass, straighten steps under 12px by sliding a run (and its port, or through a
   * fold lane's waypoints) onto the next. On unless false.
   */
  jogs?: boolean;
}

export type Axis = 'x' | 'y';
/** Which end of an edge: its source or its target. */
export type End = 'from' | 'to';
export type Flow = 'right' | 'down';

/** A shape the router ends lines on: a node, or a collapsed group drawn as a box. */
export type Box = Rect & {
  id: string;
  parentId?: string;
  shape?: ShapeKind;
  frame?: boolean;
};

/**
 * A rectangle no line may enter. `across` lets an upright line cross it but none run along it;
 * with `gates`, only at those x coordinates.
 */
export type Obstacle = Rect & {
  id?: string;
  across?: boolean;
  gates?: number[];
};

/** A box or group border that lines should keep `band` away from, at a cost instead of a wall. */
export type NearBox = Rect & {
  id: string;
  band: number;
  /** A group border: it counts from both sides. */
  border?: boolean;
  weight?: number;
};

/** A side and offset the repair pass fixes at one end of an edge. */
export interface Pin {
  side: Side;
  offset: number;
}

/** An edge as routed: the input edge with a config, and the repair pass's pins. */
export type RouteEdge = RouteEdgeInput & {
  pin?: Partial<Record<End, Pin>>;
};

/** One choice of sides and ports for an edge, with its stubs and the obstacles it sees. */
export interface Candidate {
  /** Source and target sides. */
  fs: Side;
  ts: Side;
  /** Port offsets along those sides. */
  fo: number;
  toff: number;
  start: Point;
  end: Point;
  /** Where the stubs out of each port end. */
  as: Point;
  bs: Point;
  obs: Obstacle[];
  /** A lower bound on the route's score, to order the grid searches. */
  lower: number;
  /** The fan-out cost of the side pair, worked out once. */
  fanout?: number;
}

export type { EdgeLayout, Point, Rect, RoutingSettings, ShapeKind, Side };
