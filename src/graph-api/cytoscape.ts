/**
 * A Cytoscape.js layout: `cytoscape.use(draftablyLayout)`, then
 * `cy.layout({ name: 'draftably' }).run()`. It places nodes with draftably's layout. Cytoscape
 * draws edges itself; the routed lines are on `layout.result` for an app that draws its own.
 */
import { layoutSync, type GraphIn, type LayoutResult, type RoutingOptions } from './core';

/** The parts of a Cytoscape collection element this layout reads. */
interface CyElement {
  id(): string;
  data(key: string): unknown;
  isParent(): boolean;
  parent(): { length: number; id(): string };
  isNode(): boolean;
  outerWidth(): number;
  outerHeight(): number;
  source(): { id(): string };
  target(): { id(): string };
}

interface CyCollection {
  nodes(): CyElement[] & {
    layoutPositions(
      layout: unknown,
      options: object,
      at: (n: CyElement) => { x: number; y: number },
    ): void;
  };
  edges(): CyElement[];
}

export interface CytoscapeLayoutOptions {
  name: 'draftably';
  eles: CyCollection;
  cy: unknown;
  direction?: 'right' | 'down';
  gap?: number;
  routing?: RoutingOptions;
  fit?: boolean;
  padding?: number;
  animate?: boolean;
}

function DraftablyLayout(
  this: { options: CytoscapeLayoutOptions; result?: LayoutResult },
  options: CytoscapeLayoutOptions,
) {
  this.options = options;
}

DraftablyLayout.prototype.run = function (this: {
  options: CytoscapeLayoutOptions;
  result?: LayoutResult;
}) {
  const o = this.options,
    nodes = o.eles.nodes(),
    label = (n: CyElement) => {
      const v = n.data('label');
      return typeof v === 'string' ? v : n.id();
    },
    parentOf = (n: CyElement) => (n.parent().length ? n.parent().id() : undefined);
  const graph: GraphIn = {
    direction: o.direction,
    gap: o.gap,
    routing: o.routing,
    groups: nodes
      .filter(n => n.isParent())
      .map(n => ({ id: n.id(), label: label(n), parent: parentOf(n) })),
    nodes: nodes
      .filter(n => !n.isParent())
      .map(n => ({
        id: n.id(),
        label: label(n),
        parent: parentOf(n),
        width: n.outerWidth(),
        height: n.outerHeight(),
      })),
    edges: o.eles.edges().map(e => ({
      id: e.id(),
      source: e.source().id(),
      target: e.target().id(),
      label: typeof e.data('label') === 'string' ? (e.data('label') as string) : undefined,
    })),
  };
  const result = layoutSync(graph);
  this.result = result;
  // Cytoscape positions are centres. A parent's box follows its children.
  nodes.layoutPositions(this, { fit: true, padding: 30, animate: false, ...o }, (n: CyElement) => {
    const b = result.nodes[n.id()] ?? result.groups[n.id()];
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : { x: 0, y: 0 };
  });
  return this;
};

DraftablyLayout.prototype.stop = function () {
  return this;
};

/** The Cytoscape extension: pass it to `cytoscape.use`. */
export function draftablyLayout(cytoscape: (type: 'layout', name: string, impl: unknown) => void) {
  cytoscape('layout', 'draftably', DraftablyLayout);
}
