/** The camera as a host drives it: read it, frame some objects, or bring one into view. */
import { createEffect, on } from 'solid-js';
import { clamp, rectUnion } from '../../model/geometry';
import type { Camera, Rect } from '../../model/types';
import type { DocumentPart } from './document';
import { MAX_ZOOM, MIN_ZOOM, type EditorPart } from './editor';
import type { ScenePart } from './scene';

/** `api` for the host's calls, `user` for everything else, as in the viewer's `camera` event. */
export type CameraReason = 'user' | 'api';

export interface CameraEvent {
  camera: Camera;
  reason: CameraReason;
}

export interface FitOptions {
  /** Screen pixels kept clear round the objects. */
  margin?: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface RevealOptions {
  /** Screen pixels kept clear round the object. */
  margin?: number;
  /** The least zoom a reveal zooms out to. */
  minZoom?: number;
}

export const FIT_MARGIN = 40;
export const FIT_MAX_ZOOM = 1;
export const REVEAL_MARGIN = 40;
/** Below this, titles stop being legible. */
export const REVEAL_MIN_ZOOM = 0.55;

export function createCamera(s: DocumentPart & ScenePart & EditorPart) {
  const getCamera = (): Camera => ({ ...s.doc.camera });

  const stage = () => {
    const size = s.stageSize();
    return size.width > 1 && size.height > 1 ? size : undefined;
  };

  /** A shape's or group's box, or a connection's path and label. */
  function rectOf(id: string): Rect | undefined {
    const box = s.sceneRects().get(id);
    if (box) return box;
    const route = s.routesById().get(id);
    if (!route?.points.length) return undefined;
    const l = route.label;
    return rectUnion([
      ...route.points.map(p => ({ x: p.x, y: p.y, w: 0, h: 0 })),
      ...(l ? [{ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h }] : []),
    ]);
  }

  function move(next: Camera) {
    const c = s.doc.camera;
    if (next.x === c.x && next.y === c.y && next.k === c.k) return false;
    s.setCamera(next, 'api');
    return true;
  }

  // A move asked for before the canvas has a size runs once it has one.
  let pending: (() => void) | undefined;
  createEffect(
    on(s.measuredStageSize, () => {
      if (!pending || !stage()) return;
      const run = pending;
      pending = undefined;
      run();
    }),
  );
  const whenSized = (run: () => boolean) => {
    if (stage()) {
      pending = undefined;
      return run();
    }
    pending = () => void run();
    return false;
  };

  /** Frame `ids`, centred. Returns whether the camera moved. */
  function fitTo(ids: Iterable<string>, options: FitOptions = {}) {
    const rects = [...ids].map(rectOf).filter((r): r is Rect => !!r);
    if (!rects.length) return false;
    return whenSized(() => {
      const { width: w, height: h } = s.stageSize(),
        margin = options.margin ?? FIT_MARGIN,
        b = rectUnion(rects),
        k = clamp(
          Math.min((w - margin * 2) / Math.max(1, b.w), (h - margin * 2) / Math.max(1, b.h)),
          options.minZoom ?? MIN_ZOOM,
          Math.min(options.maxZoom ?? FIT_MAX_ZOOM, MAX_ZOOM),
        );
      return move({ x: w / 2 - (b.x + b.w / 2) * k, y: h / 2 - (b.y + b.h / 2) * k, k });
    });
  }

  /** Bring `id` into view with the least pan, zooming out only if it can't fit. */
  function reveal(id: string, options: RevealOptions = {}) {
    if (!rectOf(id)) return false;
    return whenSized(() => {
      const r = rectOf(id);
      if (!r) return false;
      const { width: w, height: h } = s.stageSize(),
        c = s.doc.camera,
        margin = options.margin ?? REVEAL_MARGIN,
        left = r.x * c.k + c.x,
        top = r.y * c.k + c.y;
      if (left >= 0 && top >= 0 && left + r.w * c.k <= w && top + r.h * c.k <= h) return false;
      const room = { w: Math.max(1, w - margin * 2), h: Math.max(1, h - margin * 2) },
        fits = Math.min(room.w / Math.max(1, r.w), room.h / Math.max(1, r.h)),
        k = fits >= c.k ? c.k : Math.max(fits, Math.min(options.minZoom ?? REVEAL_MIN_ZOOM, c.k));
      const next = {
        x: w / 2 - ((w / 2 - c.x) / c.k) * k,
        y: h / 2 - ((h / 2 - c.y) / c.k) * k,
        k,
      };
      const pan = (at: number, size: number, view: number, offset: number) => {
        const lo = at * k + offset,
          hi = lo + size * k;
        if (size * k > view - margin * 2) return view / 2 - (at + size / 2) * k;
        if (lo < margin) return offset + margin - lo;
        if (hi > view - margin) return offset - (hi - (view - margin));
        return offset;
      };
      next.x = pan(r.x, r.w, w, next.x);
      next.y = pan(r.y, r.h, h, next.y);
      return move(next);
    });
  }

  return { getCamera, fitTo, reveal };
}

export type CameraPart = ReturnType<typeof createCamera>;
