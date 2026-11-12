/**
 * One camera for the viewer and the editor: the world point at the viewport's centre and a zoom.
 * Both handles frame and reveal through these functions, so the same call moves both the same way.
 */
import type { Box } from '../graph-api/core';

/** World units at the centre of the viewport. Independent of the viewport size. */
export interface Camera {
  centerX: number;
  centerY: number;
  zoom: number;
}
export type CameraReason = 'user' | 'api' | 'fit' | 'resize' | 'restore';
/** `pending`: the viewport has no size yet; the latest call runs once it has one. */
export type MoveResult = 'moved' | 'unchanged' | 'missing' | 'pending';

export interface FrameOptions {
  /** Screen pixels kept clear, for example under a host panel. Default 32. */
  padding?: number | { top: number; right: number; bottom: number; left: number };
  minZoom?: number;
  /** Default 1 for `fit`, so a small diagram is not blown up. */
  maxZoom?: number;
}

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 8;
const PADDING = 32;

type View = { width: number; height: number };

export const clampZoom = (zoom: number, min = ZOOM_MIN, max = ZOOM_MAX) =>
  Math.min(Math.max(zoom, Math.max(ZOOM_MIN, min)), Math.min(ZOOM_MAX, max));

function sides(options: FrameOptions = {}) {
  const p = options.padding ?? PADDING;
  return typeof p === 'number' ? { top: p, right: p, bottom: p, left: p } : p;
}

/** The union of boxes, or undefined for none. */
export function unionBox(boxes: readonly Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map(b => b.x)),
    y = Math.min(...boxes.map(b => b.y)),
    right = Math.max(...boxes.map(b => b.x + b.width)),
    bottom = Math.max(...boxes.map(b => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** The camera that shows `box`, centred in the padded viewport, at most `maxZoom` (default 1). */
export function fitCamera(box: Box, view: View, options: FrameOptions = {}): Camera {
  const p = sides(options),
    w = Math.max(1, view.width - p.left - p.right),
    h = Math.max(1, view.height - p.top - p.bottom),
    zoom = clampZoom(
      Math.min(w / Math.max(1, box.width), h / Math.max(1, box.height)),
      options.minZoom,
      options.maxZoom ?? 1,
    );
  return {
    centerX: box.x + box.width / 2 - (p.left - p.right) / 2 / zoom,
    centerY: box.y + box.height / 2 - (p.top - p.bottom) / 2 / zoom,
    zoom,
  };
}

/** The least move that brings `box` fully into the padded viewport; zooms out only if needed. */
export function revealCamera(
  camera: Camera,
  box: Box,
  view: View,
  options: FrameOptions = {},
): Camera {
  const p = sides(options),
    room = { width: view.width - p.left - p.right, height: view.height - p.top - p.bottom };
  let { centerX, centerY, zoom } = camera;
  if (box.width * zoom > room.width || box.height * zoom > room.height)
    return fitCamera(box, view, { ...options, maxZoom: zoom });
  zoom = clampZoom(zoom, options.minZoom, options.maxZoom);
  const left = (box.x - centerX) * zoom + view.width / 2,
    top = (box.y - centerY) * zoom + view.height / 2;
  if (left < p.left) centerX -= (p.left - left) / zoom;
  else if (left + box.width * zoom > view.width - p.right)
    centerX += (left + box.width * zoom - (view.width - p.right)) / zoom;
  if (top < p.top) centerY -= (p.top - top) / zoom;
  else if (top + box.height * zoom > view.height - p.bottom)
    centerY += (top + box.height * zoom - (view.height - p.bottom)) / zoom;
  return { centerX, centerY, zoom };
}

export const sameCamera = (a: Camera, b: Camera) =>
  Math.abs(a.centerX - b.centerX) < 0.01 &&
  Math.abs(a.centerY - b.centerY) < 0.01 &&
  Math.abs(a.zoom - b.zoom) < 1e-6;
