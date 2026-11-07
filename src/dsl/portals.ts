/**
 * Portals: nodes that stand for something outside the drawing (`shape=portal`).
 *
 * A portal is the near end of a line whose far end is not drawn, such as a flow into another
 * system. Layout never sees it: the drawing is laid out without portals or their lines, so a
 * portal never pulls a box out of place or takes a rank (as `constraint=false` keeps a line out
 * of ranking). Once the drawing is laid out, each portal is set just outside its frame, on the
 * side that faces what it connects to, and its lines are routed with the rest.
 */
import type { Diagnostic, Scene, SceneObject } from './compile';
import type { Hint, Model, ModelObject } from './syntax';

/** Room between the drawing's frame and a portal: a line's turn and its arrowhead. */
export const PORTAL_GAP = 56;
/** Least room between two portals on one side. */
const PORTAL_SPACING = 16;
/** Room either side of a label on a line to a portal. */
const LABEL_ROOM = 20;

type Side = 'right' | 'bottom' | 'left' | 'top';

/** A model's portals, and the model without them for layout. */
export interface PortalSplit {
  /** The model layout sees: no portals, no lines to them, no refinements of them. */
  inner: Model;
  /** The portals, in declaration order. */
  portals: ModelObject[];
}

export const isPortal = (o: { shape?: string }) => o.shape === 'portal';

/** Set a model's portals aside, or undefined when it has none. */
export function splitPortals(m: Model): PortalSplit | undefined {
  const portals = m.objects.filter(isPortal);
  if (!portals.length) return undefined;
  const ids = new Set(portals.map(p => p.id)),
    names = (h: Hint) =>
      h.type === 'order' || h.type === 'align'
        ? h.ids.some(id => ids.has(id))
        : h.type === 'near'
          ? ids.has(h.id) || ids.has(h.ref)
          : ids.has(h.id);
  const dropped = m.hints.filter(h => h.type !== 'size' && names(h)),
    warnings = dropped.map(h => ({
      code: 'portal-placed',
      message: `A portal sits at the drawing's edge, facing what it connects to, so ${h.type} does not move it.`,
      line: h.line,
    }));
  return {
    portals,
    inner: {
      ...m,
      objects: m.objects.filter(o => !ids.has(o.id)),
      edges: m.edges.filter(e => !ids.has(e.source) && !ids.has(e.target)),
      hints: m.hints.filter(h => !dropped.includes(h) && !(h.type === 'size' && ids.has(h.id))),
      warnings: [...m.warnings, ...warnings],
    },
  };
}

/** How big a portal is drawn: its `size` refinement, else its title's room as a box. */
type Measure = (
  o: ModelObject,
  hint: Extract<Hint, { type: 'size' }> | undefined,
) => {
  w: number;
  h: number;
};

/**
 * The scene laid out without portals, with them placed at its frame and their lines back. Each
 * portal faces the mean centre of what it connects to: on the frame side nearest that point
 * (measured as a share of the frame's width or height, so a wide drawing still puts a portal
 * above or below a box near its top), lined up with it, and spread along that side from the
 * portals beside it.
 */
export function placePortals(
  scene: Scene,
  full: Model,
  split: PortalSplit,
  measure: Measure,
  labelWidth: (text: string) => number,
) {
  const top = scene.objects.filter(o => o.parent === 'root'),
    frame = top.length
      ? {
          x: Math.min(...top.map(o => o.x)),
          y: Math.min(...top.map(o => o.y)),
          r: Math.max(...top.map(o => o.x + o.w)),
          b: Math.max(...top.map(o => o.y + o.h)),
        }
      : { x: 0, y: 0, r: 0, b: 0 },
    ids = new Set(split.portals.map(p => p.id)),
    sizes = new Map(
      split.portals.map(p => {
        const hint = full.hints.find(
          (h): h is Extract<Hint, { type: 'size' }> => h.type === 'size' && h.id === p.id,
        );
        return [p.id, measure(p, hint)] as const;
      }),
    ),
    diagnostics: Diagnostic[] = [];
  const centre = (o: SceneObject) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
  const wants: Array<{ portal: ModelObject; side: Side; at: number }> = [];
  for (const portal of split.portals) {
    const ends = full.edges
      .flatMap(e =>
        e.source === portal.id ? [e.target] : e.target === portal.id ? [e.source] : [],
      )
      .filter(id => !ids.has(id))
      .map(id => scene.byId.get(id))
      .filter((o): o is SceneObject => !!o);
    if (!ends.length) {
      diagnostics.push({
        level: 'warning',
        code: 'portal-alone',
        message: `${portal.id} is a portal with no line to anything drawn, so it has nothing to face; it sits at the right.`,
        line: portal.line,
        ids: [portal.id],
      });
    }
    const c = ends.length
        ? {
            x: ends.reduce((s, o) => s + centre(o).x, 0) / ends.length,
            y: ends.reduce((s, o) => s + centre(o).y, 0) / ends.length,
          }
        : { x: frame.r, y: (frame.y + frame.b) / 2 },
      w = Math.max(1, frame.r - frame.x),
      h = Math.max(1, frame.b - frame.y),
      reach: Array<[Side, number]> = [
        ['right', (frame.r - c.x) / w],
        ['bottom', (frame.b - c.y) / h],
        ['left', (c.x - frame.x) / w],
        ['top', (c.y - frame.y) / h],
      ],
      side = reach.reduce((a, b) => (b[1] < a[1] - 1e-9 ? b : a))[0];
    wants.push({ portal, side, at: side === 'left' || side === 'right' ? c.y : c.x });
  }
  // A side's gap holds the widest label on a line to one of its portals, a bundle's name among
  // them, so a label is never squeezed between the frame and its portal.
  const labels = (p: ModelObject) => [
    ...full.edges.filter(e => e.source === p.id || e.target === p.id).map(e => e.label),
    ...(full.appearance.bundles ?? []).filter(x => x.a === p.id || x.b === p.id).map(x => x.name),
  ];
  const placed: SceneObject[] = [];
  for (const side of ['right', 'bottom', 'left', 'top'] as const) {
    const run = wants.filter(w => w.side === side).sort((a, b) => a.at - b.at),
      across0 = side === 'left' || side === 'right',
      gap = Math.max(
        PORTAL_GAP,
        ...run.flatMap(w =>
          labels(w.portal)
            .filter((t): t is string => !!t)
            .map(t => (across0 ? labelWidth(t) : 24) + 2 * LABEL_ROOM),
        ),
      ),
      across = side === 'left' || side === 'right',
      length = (p: ModelObject) => (across ? sizes.get(p.id)!.h : sizes.get(p.id)!.w);
    // Each portal centred on what it faces, then pushed along so none overlaps the one before.
    const starts: number[] = [];
    run.forEach((w, i) => {
      const want = w.at - length(w.portal) / 2,
        after = i ? starts[i - 1] + length(run[i - 1].portal) + PORTAL_SPACING : -Infinity;
      starts.push(Math.max(want, after));
    });
    // A run pushed past the frame's far end slides back, as long as that keeps it on the frame.
    const end = across ? frame.b : frame.r,
      begin = across ? frame.y : frame.x,
      last = run.length ? starts[run.length - 1] + length(run[run.length - 1].portal) : 0,
      back = run.length ? Math.min(Math.max(0, last - end), Math.max(0, starts[0] - begin)) : 0;
    run.forEach((w, i) => {
      const { w: pw, h: ph } = sizes.get(w.portal.id)!,
        along = Math.round(starts[i] - back),
        x = side === 'right' ? frame.r + gap : side === 'left' ? frame.x - gap - pw : along,
        y = side === 'bottom' ? frame.b + gap : side === 'top' ? frame.y - gap - ph : along;
      placed.push({
        ...w.portal,
        parent: 'root',
        x: Math.round(x),
        y: Math.round(y),
        w: pw,
        h: ph,
        localX: Math.round(x),
        localY: Math.round(y),
        baseX: Math.round(x),
        baseY: Math.round(y),
        depth: 0,
      });
    });
  }
  const order = new Map(full.objects.map((o, i) => [o.id, i])),
    objects = [...scene.objects, ...placed].sort((a, b) => order.get(a.id)! - order.get(b.id)!),
    laid = new Map(scene.edges.map(e => [e.id, e]));
  return {
    ...scene,
    model: full,
    objects,
    byId: new Map(objects.map(o => [o.id, o])),
    edges: full.edges.map(e => laid.get(e.id) ?? e),
    diagnostics: [...scene.diagnostics, ...diagnostics],
  } satisfies Scene;
}
