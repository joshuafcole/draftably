/**
 * `check --metrics` finding `route-blocked`: the router found no clear way for a line, so it is
 * drawn as a plain elbow between its ends, over whatever is in the way. The editor draws it red
 * and dashed and counts it in its status bar; an export draws it like any other line, so a
 * reader cannot tell it from a route that was chosen.
 *
 * It is the drawing's form of a relation the picture loses. An edge whose ends are missing is a
 * source error, and every edge of a file that compiles is routed, so nothing is left undrawn:
 * what can go wrong is a line drawn where no route was found.
 */
import { rectUnion } from '../model/geometry';
import type { Diagnostic } from './compile';
import { blame } from './conflicts';
import type { Drawing } from './metrics';

export function routeBlockedNotes(d: Drawing): Diagnostic[] {
  return d.routes.flatMap(route => {
    if (!route.blocked) return [];
    const cause = blame(d.scene, [route.from, route.to]);
    return [
      {
        level: 'warning' as const,
        code: 'route-blocked',
        message: `Edge ${route.id} (${route.from} -> ${route.to}) has no clear route, so it is drawn as a plain elbow over what is in its way.${cause.text}`,
        ...(cause.line ? { line: cause.line } : {}),
        ids: [route.id],
        box: rectUnion(route.points.map(p => ({ ...p, w: 0, h: 0 }))),
      },
    ];
  });
}
