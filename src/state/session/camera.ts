/**
 * The camera as a host drives it: read it, set it, frame some objects (`fitTo`) or bring one into
 * view (`reveal`), and hear every move through `SessionOptions.onCamera`, with who made it. A
 * host's camera policy (when to frame, how close) stays the host's; these are the moves.
 *
 * `reveal` keeps to the defaults an automatic move owes the reader: nothing moves if the object is
 * already in view; otherwise the smallest pan; the zoom changes only when the object can't fit at
 * the current zoom, and then only outward, never below `minZoom`.
 */
import { createEffect, on } from 'solid-js';
import { clamp, rectUnion } from '../../model/geometry';
import { drawnRect } from './overlay';
import type { Camera, Rect } from '../../model/types';
import type { DocumentPart } from './document';
import type { EmphasisPart } from './emphasis';
import { MAX_ZOOM, MIN_ZOOM, type EditorPart } from './editor';
import type { ScenePart } from './scene';

/**
 * Who moved the camera: the host through this part, the reader (a drag, a pinch, the wheel, a key,
 * a zoom button, an undo, or the Fit command), or `'fit'` for the editor's own automatic fits and
 * reveals (the first fit once the canvas has a size, a fit after a layout or an opened diagram).
 */
export type CameraMover = 'user' | 'host' | 'fit';

export interface FitOptions {
  /** Zoom no further out than this; the objects may then not all fit. MIN_ZOOM by default. */
  minZoom?: number;
  /** Zoom no further in than this. 1 (100%) by default. */
  maxZoom?: number;
}

export interface RevealOptions {
  /** Screen pixels kept clear between the object and the canvas edge after a move. 40 by default. */
  margin?: number;
  /** The least zoom a reveal zooms out to when the object can't fit. 0.55 by default. */
  minZoom?: number;
}

/** The least zoom a reveal zooms out to: below it, titles stop being legible. */
export const LEGIBLE_ZOOM = 0.55;

const sameCamera = (a: Camera, b: Camera) => a.x === b.x && a.y === b.y && a.k === b.k;

export function createCamera(s: DocumentPart & ScenePart & EmphasisPart & EditorPart) {
  /** The camera now: the screen point of the world origin (`x`, `y`) and the zoom (`k`). */
  const camera = (): Camera => ({ ...s.doc.camera });

  /** Move the camera for the host. Reports `by: 'host'`; returns whether it moved. */
  function moveCamera(next: Camera) {
    if (sameCamera(next, s.doc.camera)) return false;
    s.setCamera(next, 'host');
    return true;
  }

  /** The canvas size, or undefined before it has been laid out. */
  const stage = () => {
    const size = s.stageSize();
    return size.width > 1 && size.height > 1 ? size : undefined;
  };

  /** The world rectangle the canvas shows. */
  function visibleRect(): Rect {
    const { width, height } = s.stageSize(),
      c = s.doc.camera;
    return { x: -c.x / c.k, y: -c.y / c.k, w: width / c.k, h: height / c.k };
  }

  /** Where an object is drawn, in the drawing's units (`overlay.ts`). */
  const rectOf = (id: string) => drawnRect(s, id);

  // A move asked for before the canvas had a size runs on its first real size.
  let pending: (() => void) | undefined;
  createEffect(
    on(s.measuredStageSize, () => {
      if (!pending || !stage()) return;
      const run = pending;
      pending = undefined;
      run();
    }),
  );
  const whenSized = (move: () => boolean) => {
    if (stage()) {
      pending = undefined;
      return move();
    }
    pending = () => void move();
    return false;
  };

  /**
   * Frame `ids` (objects, connections, or notes by their ID) in the canvas with `margin` screen
   * pixels round them, centred. Ids the drawing does not have are skipped; with none left nothing moves. Before the canvas has a size the
   * fit waits for it. Returns whether the camera moved.
   */
  function fitTo(ids: Iterable<string>, margin = 40, options: FitOptions = {}) {
    const rects = [...ids].map(rectOf).filter((r): r is Rect => !!r);
    if (!rects.length) return false;
    return whenSized(() => {
      const { width: w, height: h } = s.stageSize(),
        b = rectUnion(rects),
        k = clamp(
          Math.min((w - margin * 2) / Math.max(1, b.w), (h - margin * 2) / Math.max(1, b.h)),
          options.minZoom ?? MIN_ZOOM,
          Math.min(options.maxZoom ?? 1, MAX_ZOOM),
        );
      return moveCamera({ x: w / 2 - (b.x + b.w / 2) * k, y: h / 2 - (b.y + b.h / 2) * k, k });
    });
  }

  /**
   * Bring `id` into view. Nothing moves if it is wholly on the canvas already. Otherwise the
   * camera pans the least that leaves `margin` round it, zooming out first only if it can't fit
   * at the current zoom, and never below `minZoom` (or the current zoom, when that is lower).
   * Returns whether the camera moved.
   */
  function reveal(id: string, options: RevealOptions = {}) {
    if (!rectOf(id)) return false;
    return whenSized(() => {
      const r = rectOf(id);
      if (!r) return false;
      const { width: w, height: h } = s.stageSize(),
        c = s.doc.camera,
        margin = options.margin ?? 40,
        left = r.x * c.k + c.x,
        top = r.y * c.k + c.y;
      if (left >= 0 && top >= 0 && left + r.w * c.k <= w && top + r.h * c.k <= h) return false;
      const room = { w: Math.max(1, w - margin * 2), h: Math.max(1, h - margin * 2) },
        fits = Math.min(room.w / Math.max(1, r.w), room.h / Math.max(1, r.h)),
        k = fits >= c.k ? c.k : Math.max(fits, Math.min(options.minZoom ?? LEGIBLE_ZOOM, c.k));
      // A zoom keeps the canvas centre where it is, then the pan starts from there.
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
      return moveCamera(next);
    });
  }

  return { camera, moveCamera, visibleRect, fitTo, reveal };
}

export type CameraPart = ReturnType<typeof createCamera>;
