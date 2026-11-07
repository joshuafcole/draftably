/**
 * Authored routes and label places: `route id via=…` and `label id at=… offset=…`.
 *
 * A route's points are kept relative to the content area of the container that holds both of the
 * line's ends, as `stay` keeps a box's place relative to its parent, so moving that container
 * carries the bends with it. After layout each point is made absolute in the drawing. A soft
 * route (the default) gives way when a point lands inside a box or a group the line does not
 * enter: the line is routed afresh and `route-gave-way` says so with the statement's line. A
 * required route keeps its points whatever is in the way; `check` then reports what it crosses.
 *
 * A label place is a fraction along the drawn line and a distance off it (positive is to the
 * left of the line's way, from its source to its target: above a line running right). It needs
 * the routed line, so it is resolved when the routes are drawn (`model/routes.ts`).
 */
import { inside } from '../model/geometry';
import type { Point } from '../model/types';
import type { Diagnostic, Scene, SceneObject } from './compile';
import { layoutParent } from './syntax';

/** How close to a box a soft route's point may come before the route gives way. */
export const ROUTE_POINT_CLEARANCE = 4;

/**
 * The container whose content area a line's route is relative to: the innermost framed container
 * that holds both ends, or `root`.
 */
export function routeParent(scene: Scene, from: string, to: string): string {
  const by = new Map(scene.model.objects.map(o => [o.id, o])),
    chain = (id: string) => {
      const out: string[] = [];
      for (let p = layoutParent(by, id); ; p = layoutParent(by, p)) {
        out.push(p);
        if (p === 'root') return out;
      }
    };
  const above = new Set(chain(to));
  return chain(from).find(p => above.has(p)) ?? 'root';
}

/** Top-left of a container's content area in the drawing: what its children's local places add to. */
export function contentOriginOf(scene: Scene, scope: string): Point {
  if (scope === 'root') return { x: 0, y: 0 };
  const child = scene.objects.find(o => o.parent === scope);
  if (child) return { x: child.x - child.localX, y: child.y - child.localY };
  const g = scene.byId.get(scope);
  return g ? { x: g.x, y: g.y } : { x: 0, y: 0 };
}

const ancestorsOf = (scene: Scene, id: string) => {
  const out = new Set<string>();
  for (let p = scene.byId.get(id)?.parent; p && p !== 'root'; p = scene.byId.get(p)?.parent)
    out.add(p);
  return out;
};

/** What a point of a line's route would land in: a box, or a group the line does not enter. */
function obstacleAt(scene: Scene, p: Point, from: string, to: string): SceneObject | undefined {
  const entered = new Set([...ancestorsOf(scene, from), ...ancestorsOf(scene, to), from, to]);
  return scene.objects.find(o =>
    o.type === 'group'
      ? !o.frame && !entered.has(o.id) && inside(p, o, 0)
      : inside(p, o, ROUTE_POINT_CLEARANCE),
  );
}

/**
 * The scene with each `route` made absolute on its edge (`SceneEdge.route`) and each `label`
 * place on its edge (`SceneEdge.labelAt`). A soft route that lands in something gives way.
 */
export function withAuthoredRoutes(scene: Scene): Scene {
  const { routes, labels } = scene.model;
  if (!routes.length && !labels.length) return scene;
  const byEdge = new Map(scene.edges.map(e => [e.id, e])),
    diagnostics: Diagnostic[] = [],
    resolved = new Map<string, { points: Point[]; strength: 'soft' | 'required' }>();
  for (const r of routes) {
    const e = byEdge.get(r.id);
    if (!e) continue;
    const o = contentOriginOf(scene, routeParent(scene, e.source, e.target)),
      points = r.via.map(p => ({ x: o.x + p.x, y: o.y + p.y }));
    if (r.strength === 'soft') {
      const at = points.findIndex(p => obstacleAt(scene, p, e.source, e.target));
      if (at >= 0) {
        const hit = obstacleAt(scene, points[at], e.source, e.target)!;
        diagnostics.push({
          level: 'warning',
          code: 'route-gave-way',
          message: `The route of ${r.id} gave way: its point ${r.via[at].x},${r.via[at].y} is inside ${hit.id}, so the line is routed afresh. Move the point clear, remove the route, or make it strength=required.`,
          line: r.line,
          ids: [r.id, hit.id],
          box: { x: points[at].x - 4, y: points[at].y - 4, w: 8, h: 8 },
        });
        continue;
      }
    }
    resolved.set(r.id, { points, strength: r.strength });
  }
  const spots = new Map(labels.map(l => [l.id, { at: l.at, offset: l.offset }]));
  return {
    ...scene,
    edges: scene.edges.map(e => {
      const route = resolved.get(e.id),
        labelAt = spots.get(e.id);
      return route || labelAt
        ? { ...e, ...(route ? { route } : {}), ...(labelAt ? { labelAt } : {}) }
        : e;
    }),
    diagnostics: [...scene.diagnostics, ...diagnostics],
  };
}
