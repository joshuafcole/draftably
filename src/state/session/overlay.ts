/**
 * The positioner a host lays its own marks over the drawing with: where each object is drawn, in
 * the drawing's units (`stage`) or in canvas pixels (`screen`); a notice each time any of that
 * moves; and the same clear-space search notes are placed with, so a host's overlays and the
 * drawing's notes agree on what is in the way.
 *
 * The geometry is the drawn geometry, not the compiled layout alone: while shapes glide (a layout
 * animation or a host arrangement's glide) every read follows the frame on screen, and
 * `onGeometry` fires on each of those frames. The reads are Solid accessors over the scene, so a
 * host in the same Solid tree can also read them inside its own memos and follow them reactively.
 *
 * The canvas has two layers for the marks themselves (`CanvasProps.sceneLayer` and `screenLayer`):
 * one moves and zooms with the drawing, the other is fixed to the canvas for chrome attached to a
 * point. What a mark means stays the host's.
 */
import { createEffect, createSignal, on, untrack } from 'solid-js';
import { rectUnion } from '../../model/geometry';
import {
  clearOf,
  NOTE_SIDES,
  obstaclesOf,
  spotsBeside,
  type NoteSide,
  type Obstacles,
} from '../../model/note';
import type { Point, Rect } from '../../model/types';
import type { DocumentPart } from './document';
import type { EditorPart } from './editor';
import type { EmphasisPart } from './emphasis';
import type { ScenePart } from './scene';

/** Which coordinates a rectangle is in: the drawing's own units, or pixels on the canvas. */
export type OverlaySpace = 'stage' | 'screen';

/**
 * Why the geometry changed: a new drawing or layout (`layout`), the camera (`camera`), a frame of
 * a glide or layout animation (`motion`), or the canvas's size (`stage`).
 */
export type GeometryCause = 'layout' | 'camera' | 'motion' | 'stage';

export interface GeometryChange {
  cause: GeometryCause;
}

/** The parts of a connection as drawn. */
export interface EdgeGeometry {
  /** The route's points, in order. */
  route: Point[];
  /** The label's box, when the connection has a label. */
  label?: Rect;
  /** Everything: the route's bounds and the label. */
  rect: Rect;
  /** The bundle whose trunk this is, when the ID is a bundle's or a line it carries. */
  bundle?: string;
}

export interface ClearSpotOptions {
  /** The sides to try, in order. Below, right, left, above by default. */
  sides?: readonly NoteSide[];
  /** The space `near` (when a rectangle), `size` and the answer are in. `stage` by default. */
  space?: OverlaySpace;
  /** Objects, connections or notes (by id) not in the way, such as the overlay's own anchor. */
  ignore?: Iterable<string>;
  /** More rectangles to keep clear of, in `space`, such as other overlays. */
  avoid?: readonly Rect[];
}

export interface KeepOutOptions {
  /** The space `rect` is in. `stage` by default. */
  space?: OverlaySpace;
  /** Objects, connections or notes (by id) not in the way. */
  ignore?: Iterable<string>;
}

type Parts = DocumentPart & ScenePart & EmphasisPart & EditorPart;

const labelRect = (l: { x: number; y: number; w: number; h: number }): Rect => ({
  x: l.x - l.w / 2,
  y: l.y - l.h / 2,
  w: l.w,
  h: l.h,
});

/**
 * A connection's line as drawn: its own route, or, for a bundle's ID or a line a bundle carries,
 * the bundle's trunk. A carried line has no element of its own until its trunk is spread, and the
 * spread is the canvas's (held, focused or picked), so an overlay anchored to it sits on the trunk.
 */
function drawnLine(
  s: Parts,
  id: string,
): { points: Point[]; label?: Rect; bundle?: string } | undefined {
  const bundle = s.bundles().find(b => b.id === id) ?? s.bundleOf().get(id);
  if (bundle?.points.length)
    return { points: bundle.points, label: labelRect(bundle.label), bundle: bundle.id };
  const route = s.routesById().get(id);
  if (!route?.points.length) return undefined;
  return { points: route.points, ...(route.label ? { label: labelRect(route.label) } : {}) };
}

/**
 * Where an object is drawn, in the drawing's units: a shape's or container's box, a connection's
 * route with its label (a bundled one's trunk), or the panel of a note with that ID while the
 * drawn state shows it.
 */
export function drawnRect(s: Parts, id: string): Rect | undefined {
  const box = s.sceneRects().get(id);
  if (box) return box;
  const line = drawnLine(s, id);
  if (!line) return s.viewerFrame().notes.find(n => n.note.id === id && !n.hidden)?.rect;
  return rectUnion([
    ...line.points.map(p => ({ x: p.x, y: p.y, w: 0, h: 0 })),
    ...(line.label ? [line.label] : []),
  ]);
}

export function createOverlay(s: Parts) {
  /** A rectangle in the drawing's units, on the canvas in pixels. */
  function toScreen(r: Rect): Rect {
    const c = s.doc.camera;
    return { x: r.x * c.k + c.x, y: r.y * c.k + c.y, w: r.w * c.k, h: r.h * c.k };
  }
  /** A rectangle on the canvas in pixels, in the drawing's units. */
  function toStage(r: Rect): Rect {
    const c = s.doc.camera;
    return { x: (r.x - c.x) / c.k, y: (r.y - c.y) / c.k, w: r.w / c.k, h: r.h / c.k };
  }
  const inSpace = (r: Rect | undefined, space: OverlaySpace): Rect | undefined =>
    r && (space === 'screen' ? toScreen(r) : { x: r.x, y: r.y, w: r.w, h: r.h });
  const pointIn = (p: Point, space: OverlaySpace): Point => {
    if (space === 'stage') return { x: p.x, y: p.y };
    const c = s.doc.camera;
    return { x: p.x * c.k + c.x, y: p.y * c.k + c.y };
  };

  /**
   * Where `id` is drawn now: a shape, a container, a connection (its route and label) or a note
   * with that ID. In `screen` space the rectangle is in pixels from the canvas's top-left corner.
   * Undefined when the drawing has no such object, or the drawn state hides the note.
   */
  function rectOf(id: string, space: OverlaySpace = 'stage'): Rect | undefined {
    return inSpace(drawnRect(s, id), space);
  }

  /**
   * A connection's route and label as drawn (a bundle's, or a carried line's, is the trunk), or
   * undefined when there is no such connection.
   */
  function edgeOf(id: string, space: OverlaySpace = 'stage'): EdgeGeometry | undefined {
    const line = drawnLine(s, id);
    if (!line) return undefined;
    return {
      route: line.points.map(p => pointIn(p, space)),
      ...(line.label ? { label: inSpace(line.label, space)! } : {}),
      ...(line.bundle ? { bundle: line.bundle } : {}),
      rect: rectOf(id, space)!,
    };
  }

  /**
   * The drawing's obstacle set, with the notes the drawn state shows placed in it: what a note
   * keeps clear of (`model/note.ts`), so a host's spot is clear of the drawing's notes too.
   */
  function obstacles(): Obstacles {
    const set = obstaclesOf(s.doc, s.sceneRects(), s.routes());
    set.notes = s
      .viewerFrame()
      .notes.filter(n => !n.hidden && !n.inFrame)
      .map(n => ({ ...(n.note.id ? { id: n.note.id } : {}), rect: n.rect }));
    return set;
  }

  /**
   * Whether `rect` must be kept out of where it is: true when it covers a shape, a line, a label or
   * a note, or crosses a container's border, as a note placed there would. Objects in `ignore` are
   * not in the way.
   */
  function keepOut(rect: Rect, options: KeepOutOptions = {}): boolean {
    const r = options.space === 'screen' ? toStage(rect) : rect;
    return !clearOf(obstacles(), r, new Set(options.ignore ?? []));
  }

  /**
   * The first clear spot for a box of `size` beside `near` (an object's id, or a rectangle), trying
   * each of `sides` in turn with the spots a note tries there; undefined when none is clear. The
   * anchor itself is never in its own way. In `screen` space `size` is in pixels and stays that
   * size whatever the zoom, and the spot comes back in pixels.
   */
  function clearSpot(
    near: string | Rect,
    size: { w: number; h: number },
    options: ClearSpotOptions = {},
  ): Rect | undefined {
    const space = options.space ?? 'stage',
      k = space === 'screen' ? s.doc.camera.k : 1,
      at =
        typeof near === 'string' ? drawnRect(s, near) : space === 'screen' ? toStage(near) : near;
    if (!at) return undefined;
    const ignore = new Set(options.ignore ?? []);
    if (typeof near === 'string') ignore.add(near);
    const set = obstacles(),
      avoid = (options.avoid ?? []).map(r => (space === 'screen' ? toStage(r) : r));
    set.notes.push(...avoid.map(rect => ({ rect })));
    const w = size.w / k,
      h = size.h / k;
    for (const side of options.sides ?? NOTE_SIDES) {
      const spot = spotsBeside(at, w, h, side).find(r => clearOf(set, r, ignore));
      if (spot) return space === 'screen' ? toScreen(spot) : spot;
    }
    return undefined;
  }

  // --- The notice ------------------------------------------------------------------------------

  const listeners = new Set<(change: GeometryChange) => void>();
  /** Counts geometry changes, for a host that tracks them as a signal rather than a callback. */
  const [geometryVersion, setGeometryVersion] = createSignal(0);
  let last: { rects: unknown; routes: unknown; x: number; y: number; k: number } | undefined;
  createEffect(
    on(
      () => {
        const c = s.doc.camera,
          size = s.stageSize();
        return {
          rects: s.sceneRects(),
          routes: s.routes(),
          notes: s.activeState(),
          x: c.x,
          y: c.y,
          k: c.k,
          w: size.width,
          h: size.height,
          motion: !!s.animationGeometry() || !!s.animationRoutes(),
        };
      },
      now => {
        const was = last;
        last = now;
        const cause: GeometryCause = now.motion
          ? 'motion'
          : !was || was.rects !== now.rects || was.routes !== now.routes
            ? 'layout'
            : was.x !== now.x || was.y !== now.y || was.k !== now.k
              ? 'camera'
              : 'stage';
        setGeometryVersion(v => v + 1);
        untrack(() => {
          for (const listen of [...listeners]) listen({ cause });
        });
      },
    ),
  );

  /**
   * Hear every change to where things are drawn: after each compile or layout, each camera move,
   * each frame of a glide or layout animation, and each resize of the canvas. Returns the call that
   * stops listening.
   */
  function onGeometry(listen: (change: GeometryChange) => void): () => void {
    listeners.add(listen);
    return () => listeners.delete(listen);
  }

  return { rectOf, edgeOf, toScreen, toStage, keepOut, clearSpot, onGeometry, geometryVersion };
}

export type OverlayPart = ReturnType<typeof createOverlay>;
