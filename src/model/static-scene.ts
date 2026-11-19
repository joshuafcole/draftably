import type { RoutingResult } from '../engines/routing-engine';
import { drawingBounds } from './bounds';
import { center } from './geometry';
import { findGroup, frameRect, makeGeometry, visibleGraph, type VisibleGraph } from './graph';
import { drawRoutes, type DrawnRoute } from './routes';
import type { Diagram, Point, Rect } from './types';

/** A read-only drawing of a document with precomputed routes, e.g. a comparison candidate. */
export interface StaticScene {
  doc: Diagram;
  vg: VisibleGraph;
  rects: Map<string, Rect>;
  routes: DrawnRoute[];
  bounds: Rect;
}

export function buildStaticScene(doc: Diagram, routing: RoutingResult): StaticScene {
  const vg = visibleGraph(doc),
    geometry = makeGeometry(doc),
    rects = new Map<string, Rect>();
  for (const n of vg.nodes) rects.set(n.id, geometry(n.id));
  for (const g of vg.groups) rects.set(g.id, frameRect(doc, geometry, g.id));
  const routes = drawRoutes(doc, vg, rects, routing);
  return { doc, vg, rects, routes, bounds: drawingBounds(doc, vg, rects, routes) };
}

/** Center of an object in a scene, or of its nearest visible container when it is hidden. */
export function anchorPoint(scene: StaticScene, id: string): Point {
  let p: string | undefined = id;
  while (p && !scene.rects.has(p))
    p = scene.doc.graph.nodes.find(n => n.id === p)?.parentId ?? findGroup(scene.doc, p)?.parentId;
  const r = p ? scene.rects.get(p) : undefined;
  return center(r ?? scene.bounds);
}
