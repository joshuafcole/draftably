/**
 * Interaction state that is never saved: the active tool, temporary geometry, drag feedback,
 * and the canvas camera helpers.
 */
import { createSignal } from 'solid-js';
import { clamp, rectUnion } from '../../model/geometry';
import { findNode, objectRect } from '../../model/graph';
import type { NodeGeometry, Point, PortSide, Rect } from '../../model/types';
import type { DocumentPart } from './document';
import type { ScenePart } from './scene';
import type { EmphasisPart } from './emphasis';

export type Tool =
  'select' | 'pan' | 'box' | 'diamond' | 'circle' | 'text' | 'container' | 'connect' | 'brush';

export const DRAW_TOOLS = ['box', 'diamond', 'circle', 'text', 'container'] as const;
export type DrawTool = (typeof DRAW_TOOLS)[number];
export const isDrawTool = (tool: Tool): tool is DrawTool =>
  (DRAW_TOOLS as readonly string[]).includes(tool);

export interface Guide {
  axis: 'x' | 'y';
  value: number;
  from: number;
  to: number;
}

/** Visual feedback for the gesture in progress. */
export interface DragFeedback {
  kind: string;
  marquee?: Rect;
  draw?: Rect;
  guides?: Guide[];
  dropTargetId?: string | null;
  resizingContainer?: boolean;
  /** A note being dragged: its box, and the object it would sit beside if dropped. */
  text?: { rect: Rect; near?: string };
}

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 4;
/** The share of the stage a fitted diagram fills. */
const FIT_SHARE = 0.92;
export { NodeGeometry };

export function createEditor(s: DocumentPart & ScenePart & EmphasisPart) {
  const state = (() => {
    const [tool, setTool] = createSignal<Tool>('select');
    const [connectFrom, setConnectFrom] = createSignal<{ id: string; side: PortSide } | null>(null);
    const [pointer, setPointer] = createSignal<Point | null>(null);
    const [drag, setDrag] = createSignal<DragFeedback | null>(null);
    const [inlineEditId, setInlineEditId] = createSignal<string | null>(null);
    const [spaceHeld, setSpaceHeld] = createSignal(false);
    const [stageSize, setStageSize] = createSignal({ width: 1, height: 1 });
    const [reducedMotion, setReducedMotion] = createSignal(
      matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    return {
      tool,
      setTool,
      connectFrom,
      setConnectFrom,
      pointer,
      setPointer,
      drag,
      setDrag,
      inlineEditId,
      setInlineEditId,
      spaceHeld,
      setSpaceHeld,
      stageSize,
      setStageSize,
      reducedMotion,
      setReducedMotion,
    };
  })();

  const {
    tool,
    setTool: setToolSignal,
    connectFrom,
    setConnectFrom,
    pointer,
    setPointer,
    drag,
    setDrag,
    inlineEditId,
    setInlineEditId,
    spaceHeld,
    setSpaceHeld,
    stageSize: measuredStageSize,
    setStageSize: setMeasuredStageSize,
    reducedMotion,
    setReducedMotion,
  } = state;

  // --- Canvas element and coordinates -----------------------------------------------------------

  let canvas: SVGSVGElement | undefined;
  const registerCanvas = (el: SVGSVGElement) => (canvas = el);
  const canvasElement = () => canvas;
  const focusCanvas = () => canvas?.focus({ preventScroll: true });

  const canvasRect = () => canvas?.getBoundingClientRect() ?? new DOMRect(0, 0, 1, 1);

  /**
   * Size of the canvas in pixels. Tracks resizes reactively, but reads the element directly so
   * code running before the first resize notification (or in a hidden tab) gets the real size.
   */
  function stageSize() {
    const measured = measuredStageSize();
    return canvas?.clientWidth
      ? { width: canvas.clientWidth, height: canvas.clientHeight }
      : measured;
  }

  function screenToWorld(clientX: number, clientY: number): Point {
    const r = canvasRect(),
      c = s.doc.camera;
    return { x: (clientX - r.left - c.x) / c.k, y: (clientY - r.top - c.y) / c.k };
  }

  /** World coordinates of the middle of the visible canvas. */
  function canvasCenter(): Point {
    const r = canvasRect();
    return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  /** Zoom by `factor` around a screen point. */
  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    const bounds = canvasRect(),
      x = (clientX ?? bounds.left + bounds.width / 2) - bounds.left,
      y = (clientY ?? bounds.top + bounds.height / 2) - bounds.top,
      c = s.doc.camera,
      world = { x: (x - c.x) / c.k, y: (y - c.y) / c.k },
      k = clamp(c.k * factor, MIN_ZOOM, MAX_ZOOM);
    s.setCamera({ x: x - world.x * k, y: y - world.y * k, k });
  }

  function panBy(dx: number, dy: number) {
    const c = s.doc.camera;
    s.setCamera({ ...c, x: c.x + dx, y: c.y + dy });
  }

  /** A fit asked for before the canvas had a size, run on its first real size. */
  let fitPending = false;

  /** Record the canvas size from its resize observer, and run a fit that was waiting for it. */
  function setStageSize(size: { width: number; height: number }) {
    setMeasuredStageSize(size);
    if (fitPending && size.width > 1 && size.height > 1) fitView();
  }

  /**
   * Fit the whole diagram and its frame in view, leaving room for the zoom controls. The frame takes
   * about 92% of the stage, never more than its actual size: edge to edge reads as overwhelming on a
   * large monitor. Before the canvas is laid out its size is unknown, so the fit waits for it rather
   * than zoom out to the minimum.
   */
  function fitView() {
    const { width: w, height: h } = stageSize();
    if (!s.doc.graph.nodes.length && !s.doc.graph.groups.length) return;
    fitPending = w <= 1 || h <= 1;
    if (fitPending) return;
    const b = s.viewerFrame(),
      pad = 16,
      bottom = 60,
      k = clamp(
        FIT_SHARE *
          Math.min((w - pad * 2) / Math.max(1, b.w), (h - pad - bottom) / Math.max(1, b.h)),
        MIN_ZOOM,
        1,
      );
    s.setCamera({
      x: (w - b.w * k) / 2 - b.x * k,
      y: (h - bottom + pad - b.h * k) / 2 - b.y * k,
      k,
    });
  }

  /** Some of the diagram lies outside the canvas, or under the zoom controls. */
  function diagramClipped() {
    const b = s.viewerFrame(),
      c = s.doc.camera,
      { width: w, height: h } = stageSize(),
      left = b.x * c.k + c.x,
      top = b.y * c.k + c.y;
    return left < 0 || top < 0 || left + b.w * c.k > w || top + b.h * c.k > h - 60;
  }

  /** Fit an arbitrary set of rectangles, e.g. every frame of a timeline. */
  function fitRects(rects: Rect[], reservedBottom = 0) {
    const b = rectUnion(rects, 40),
      { width: w } = stageSize(),
      h = stageSize().height - reservedBottom,
      k = clamp(Math.min(w / b.w, h / b.h), MIN_ZOOM, 1.2);
    s.setCamera({ x: (w - b.w * k) / 2 - b.x * k, y: (h - b.h * k) / 2 - b.y * k, k });
  }

  /** Pan just enough to bring an object fully into view. */
  function revealObject(id: string) {
    const r = objectRect(s.doc, s.geometry, id),
      c = { ...s.doc.camera },
      { width: w, height: h } = stageSize(),
      pad = 42;
    if (r.x * c.k + c.x < pad) c.x = pad - r.x * c.k;
    if ((r.x + r.w) * c.k + c.x > w - pad) c.x = w - pad - (r.x + r.w) * c.k;
    if (r.y * c.k + c.y < pad) c.y = pad - r.y * c.k;
    if ((r.y + r.h) * c.k + c.y > h - pad) c.y = h - pad - (r.y + r.h) * c.k;
    s.setCamera(c);
  }

  /** Center the selected objects without changing the zoom. */
  function centerSelection() {
    const rects = s
      .selectedIds()
      .filter(id => findNode(s.doc, id) || s.doc.layout.nodes[id])
      .map(id => objectRect(s.doc, s.geometry, id));
    if (!rects.length) return;
    const b = rectUnion(rects),
      c = s.doc.camera,
      { width: w, height: h } = stageSize();
    s.setCamera({ ...c, x: w / 2 - (b.x + b.w / 2) * c.k, y: h / 2 - (b.y + b.h / 2) * c.k });
  }
  return {
    tool,
    setToolSignal,
    connectFrom,
    setConnectFrom,
    pointer,
    setPointer,
    drag,
    setDrag,
    inlineEditId,
    setInlineEditId,
    spaceHeld,
    setSpaceHeld,
    measuredStageSize,
    setMeasuredStageSize,
    reducedMotion,
    setReducedMotion,
    registerCanvas,
    canvasElement,
    focusCanvas,
    stageSize,
    screenToWorld,
    canvasCenter,
    zoomAt,
    panBy,
    setStageSize,
    fitView,
    diagramClipped,
    fitRects,
    revealObject,
    centerSelection,
  };
}

export type EditorPart = ReturnType<typeof createEditor>;
