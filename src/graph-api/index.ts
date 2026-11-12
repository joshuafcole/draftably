/**
 * Draftably's layout and router for graphs from any tool: `@draftably/runtime/graph`.
 *
 *   const placed = await layout({ nodes, edges });               // draftably's own shape
 *   const { reactFlow } = await layout({ reactFlow: { nodes, edges } });
 *   const lines = route({ nodes: placedBoxes, edges });          // lines only
 *
 * A keyed call returns the same shape it took, under the same key.
 */
import {
  layout as layoutGraph,
  route as routeGraph,
  type GraphIn,
  type LayoutResult,
  type RouteIn,
  type Routed,
  type RoutingOptions,
} from './core';
import {
  fromFlow,
  placedFlow,
  routedFlow,
  toFlow,
  type FlowEdge,
  type FlowEdgeOut,
  type FlowGraph,
  type FlowNode,
  type FlowNodeOut,
  type FlowOptions,
  type SvelteFlowNodeOut,
} from './react-flow';

import { layoutElk, type ElkNode } from './elk';

export { AUTO_FULL_LIMIT, layoutSync } from './core';
export { DraftablyELK } from './elk';
export { dagreLayout } from './dagre';
export { draftablyLayout } from './cytoscape';
export type { ElkEdge, ElkEdgeSection, ElkLabel, ElkNode, ElkPort } from './elk';
export type { DagreGraph } from './dagre';
export type { CytoscapeLayoutOptions } from './cytoscape';
export type * from './core';
export type {
  DraftablyEdgeData,
  FlowEdge,
  FlowEdgeOut,
  FlowGraph,
  FlowNode,
  FlowNodeOut,
  FlowOptions,
  SvelteFlowNodeOut,
} from './react-flow';

/** Settings a keyed call takes beside its graph. */
export type Common = Pick<GraphIn, 'arrange' | 'direction' | 'gap' | 'fit' | 'fold' | 'routing'>;

type FlowLayout<N extends FlowNode, E extends FlowEdge> = FlowGraph<FlowNodeOut<N>, FlowEdgeOut<E>>;
type SvelteLayout<N extends FlowNode, E extends FlowEdge> = FlowGraph<
  SvelteFlowNodeOut<N>,
  FlowEdgeOut<E>
>;
type FlowRouted<N extends FlowNode, E extends FlowEdge> = FlowGraph<N, FlowEdgeOut<E>>;

export function layout(graph: GraphIn): Promise<LayoutResult>;
export function layout<N extends FlowNode, E extends FlowEdge>(
  input: { reactFlow: FlowGraph<N, E> } & FlowOptions & Common,
): Promise<{ reactFlow: FlowLayout<N, E>; result: LayoutResult }>;
export function layout<N extends FlowNode, E extends FlowEdge>(
  input: { svelteFlow: FlowGraph<N, E> } & FlowOptions & Common,
): Promise<{ svelteFlow: SvelteLayout<N, E>; result: LayoutResult }>;
export function layout(
  input: { elk: ElkNode } & Common,
): Promise<{ elk: ElkNode; result: LayoutResult }>;
export async function layout(input: object): Promise<unknown> {
  if ('elk' in input) {
    const { elk, ...common } = input as { elk: ElkNode } & Common;
    return layoutElk(elk, undefined, common);
  }
  for (const key of ['reactFlow', 'svelteFlow'] as const)
    if (key in input) {
      const {
        [key]: flow,
        shape,
        ...common
      } = input as Record<typeof key, FlowGraph> & FlowOptions & Common;
      const result = await layoutGraph({ ...fromFlow(flow, { shape }), ...common });
      return { [key]: toFlow(flow, result, key === 'svelteFlow'), result };
    }
  return layoutGraph(input as GraphIn);
}

export function route(graph: RouteIn): Routed;
export function route<N extends FlowNode, E extends FlowEdge>(
  input: { reactFlow: FlowGraph<N, E>; routing?: RoutingOptions } & FlowOptions,
): { reactFlow: FlowRouted<N, E>; result: Routed };
export function route<N extends FlowNode, E extends FlowEdge>(
  input: { svelteFlow: FlowGraph<N, E>; routing?: RoutingOptions } & FlowOptions,
): { svelteFlow: FlowRouted<N, E>; result: Routed };
export function route(input: object): unknown {
  for (const key of ['reactFlow', 'svelteFlow'] as const)
    if (key in input) {
      const {
        [key]: flow,
        shape,
        routing,
      } = input as Record<typeof key, FlowGraph> & FlowOptions & { routing?: RoutingOptions };
      const result = routeGraph({ ...placedFlow(flow, { shape }), routing });
      return { [key]: { nodes: flow.nodes, edges: routedFlow(flow.edges, result) }, result };
    }
  return routeGraph(input as RouteIn);
}
