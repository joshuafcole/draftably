/**
 * Pointer gestures on the canvas: select, move, resize, draw, connect, bend, pan and zoom.
 * A drag edits the document directly and is committed as one undo step when it ends;
 * cancelling restores the snapshot taken when it began.
 */
import { batch } from 'solid-js';
import { produce } from 'solid-js/store';
import { wheelZoomFactor } from '../../model/camera';
import { normalize } from '../../model/document';
import * as edits from '../../model/edits';
import {
  center,
  clamp,
  clone,
  contains,
  overlaps,
  rectFromPoints,
  rounded,
} from '../../model/geometry';
import {
  descendants,
  findObject,
  frameRect,
  isCell,
  isGroup,
  makeGeometry,
  objectRect,
  selectionRoots,
} from '../../model/graph';
import type { NodeLayout, Point, Rect, Side } from '../../model/types';
import { isDrawTool, MAX_ZOOM, MIN_ZOOM, type DrawTool, type Guide } from './editor';
import { noteAnchor, noteSide } from '../../model/note';
import { parseTextId } from './canvas-text';
import { toast } from '../toast';
import type { EditorPart } from './editor';
import type { EmphasisPart } from './emphasis';
import type { DocumentPart } from './document';
import type { ScenePart } from './scene';
import type { SculptPart } from './sculpt';
import type { ActionsPart } from './actions';
import type { LayoutPart } from './layout';
import type { ViewPart } from './view';

type DragKind =
  | 'pan'
  | 'zoom'
  | 'resize'
  | 'draw'
  | 'waypoint'
  | 'edge-label'
  | 'connect'
  | 'objects'
  | 'edge-click'
  | 'text'
  | 'marquee';

interface Gesture {
  kind: DragKind;
  start: Point;
  current: Point;
  startClient: Point;
  camera: { x: number; y: number; k: number };
  before: string;
  moved: boolean;
  pointerId: number;
  id?: string;
  /** Click on an object while panning selects it. */
  clickId?: string;
  handle?: edits.ResizeHandle;
  rect?: NodeLayout;
  /** A dragged note's box when the drag began. */
  noteRect?: Rect;
  shape?: DrawTool;
  index?: number;
  point?: Point;
  offset?: { labelDx?: number; labelDy?: number };
  roots?: string[];
  moving?: Set<string>;
  positions?: Record<string, NodeLayout>;
  frames?: Map<string, Rect>;
  refRect?: Rect;
  keepParent?: boolean;
  dropId?: string | null;
  doubleCandidate?: boolean;
  /** An edge click that started on the connection's label. */
  onLabel?: boolean;
  previousSelection?: ReadonlySet<string>;
  guides?: Guide[];
  /** A pan that began on an object in a read-only session, which already selected it. */
  selected?: boolean;
}

// --- Pointer down ----------------------------------------------------------------------------

const targetData = (t: Element, selector: string) =>
  (t.closest(selector) as SVGElement | null)?.dataset;

export function createPointer(
  s: EditorPart &
    DocumentPart &
    ScenePart &
    EmphasisPart &
    SculptPart &
    ActionsPart &
    LayoutPart &
    ViewPart,
) {
  let gesture: Gesture | null = null;
  let lastClick: { id: string; index?: number; time: number; x: number; y: number } | null = null;
  let suppressDoubleClickUntil = 0;

  const isDragging = () => !!gesture;

  function begin(kind: DragKind, e: PointerEvent, canvas: Element, extra: Partial<Gesture> = {}) {
    const p = s.screenToWorld(e.clientX, e.clientY);
    gesture = {
      kind,
      start: p,
      current: p,
      startClient: { x: e.clientX, y: e.clientY },
      camera: { ...s.doc.camera },
      before: s.snapshot(),
      moved: false,
      pointerId: e.pointerId,
      ...extra,
    };
    s.setDrag({ kind });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best effort.
    }
  }

  /** `keepQuick` leaves quick routes up for a file edit, which ends them once it is redrawn. */
  function end(keepQuick = false) {
    gesture = null;
    batch(() => {
      s.setDrag(null);
      if (!keepQuick) s.setQuickRouting(false);
    });
  }

  /** Restore the document from before the gesture. */
  function cancelGesture() {
    s.cancelStroke();
    if (!gesture) return;
    const before = gesture.before;
    end();
    s.restoreDocument(normalize(JSON.parse(before)), { keepCamera: false });
  }

  // A keyboard edit during a drag first commits the drag as its own undo step.
  s.onBeforeEdit(() => {
    if (gesture && ['objects', 'resize', 'waypoint', 'edge-label'].includes(gesture.kind))
      onPointerUp(null);
  });

  // --- Touch zoom ------------------------------------------------------------------------------

  const touches = new Map<number, Point>();
  let pinch: {
    distance: number;
    world: Point;
    camera: { x: number; y: number; k: number };
  } | null = null;

  function beginTouch(e: PointerEvent, canvas: Element) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size < 2) return false;
    if (gesture) cancelGesture();
    const [a, b] = [...touches.values()],
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      world: s.screenToWorld(mid.x, mid.y),
      camera: { ...s.doc.camera },
    };
    for (const id of touches.keys())
      try {
        canvas.setPointerCapture(id);
      } catch {
        // Best effort.
      }
    return true;
  }

  function moveTouch(e: PointerEvent, canvas: Element) {
    if (!touches.has(e.pointerId)) return false;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || touches.size < 2) return false;
    const [a, b] = [...touches.values()],
      r = canvas.getBoundingClientRect(),
      mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top },
      k = clamp(
        (pinch.camera.k * Math.hypot(b.x - a.x, b.y - a.y)) / pinch.distance,
        MIN_ZOOM,
        MAX_ZOOM,
      );
    s.setDoc('camera', { x: mid.x - pinch.world.x * k, y: mid.y - pinch.world.y * k, k });
    return true;
  }

  function endTouch(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (!pinch) return false;
    if (touches.size < 2) {
      pinch = null;
      end();
      s.persist();
    }
    return true;
  }

  function resetModifiers() {
    touches.clear();
    pinch = null;
    if (gesture) cancelGesture();
  }

  // --- Wheel -----------------------------------------------------------------------------------

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (s.stroking()) return;
    s.finishInlineEdit(true);
    if (gesture || pinch) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? s.stageSize().height : 1;
    // Shift + wheel pans; the wheel and a pinch zoom around the pointer.
    if (e.shiftKey) {
      const c = s.doc.camera,
        // Browsers turn Shift + a vertical wheel into a horizontal delta.
        dx = e.deltaX || 0,
        dy = e.deltaX ? 0 : e.deltaY;
      s.setCamera({ ...c, x: c.x - dx * unit, y: c.y - dy * unit });
      return;
    }
    const canvas = e.currentTarget as Element,
      r = canvas.getBoundingClientRect(),
      c = s.doc.camera,
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      k = clamp(c.k * wheelZoomFactor(e, unit), MIN_ZOOM, MAX_ZOOM);
    s.setCamera({ x: x - ((x - c.x) / c.k) * k, y: y - ((y - c.y) / c.k) * k, k });
  }

  function onPointerDown(e: PointerEvent) {
    const canvas = e.currentTarget as Element,
      t = e.target as Element;
    if (e.pointerType === 'touch' && beginTouch(e, canvas)) return e.preventDefault();
    if (s.readOnly()) return viewPointerDown(e, canvas, t);
    if (s.timelineOpen() && e.button === 0 && !e.ctrlKey && !e.metaKey && !s.spaceHeld()) {
      // While previewing a timeline the canvas only pans.
      e.preventDefault();
      begin('pan', e, canvas);
      return;
    }
    if (!s.spaceHeld() && s.brushPointerDown(e, canvas)) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      begin('zoom', e, canvas, { start: s.screenToWorld(e.clientX, e.clientY) });
      return;
    }
    if (e.button > 1) return;
    if (s.inlineEditId()) {
      s.finishInlineEdit(true);
      return;
    }
    s.options.onInteract?.();
    const pos = s.screenToWorld(e.clientX, e.clientY);
    s.setPointer(pos);
    const object = targetData(t, '[data-kind]'),
      objectId = object?.id,
      kind = object?.kind,
      port = targetData(t, '[data-port]'),
      quickAdd = targetData(t, '[data-quick-add]'),
      link = targetData(t, '[data-open-link]'),
      collapse = targetData(t, '[data-collapse]'),
      resize = targetData(t, '[data-resize]'),
      waypoint = targetData(t, '[data-waypoint]'),
      edgeLabel = t.closest('[data-edge-label]'),
      text = targetData(t, '[data-text]')?.text,
      special = collapse || resize || waypoint;
    // Leaving the title field commits it before the canvas handles the click.
    if (
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.classList.contains('title-input')
    ) {
      document.activeElement.blur();
      s.focusCanvas();
    }
    if (e.button === 1 || s.spaceHeld()) {
      e.preventDefault();
      begin('pan', e, canvas);
      return;
    }
    if (link) {
      e.preventDefault();
      if (s.options.openLink) s.options.openLink(link.openLink!);
      else if (/^[a-z][a-z0-9+.-]*:/i.test(link.openLink!))
        window.open(link.openLink!, '_blank', 'noopener');
      return;
    }
    if (quickAdd) {
      e.preventDefault();
      s.setSelection([quickAdd.owner!]);
      s.quickExtend({ side: quickAdd.quickAdd as Side });
      return;
    }
    if (s.tool() === 'pan' && !e.shiftKey && !special) {
      e.preventDefault();
      begin('pan', e, canvas, { clickId: objectId });
      return;
    }
    if (s.layoutPreview()) s.acceptPreview();
    if (text && !isDrawTool(s.tool()) && s.tool() !== 'connect') {
      e.preventDefault();
      s.selectText(text);
      const note = parseTextId(text)?.kind === 'note';
      begin('text', e, canvas, {
        id: text,
        noteRect: note ? s.viewerFrame().notes[Number(parseTextId(text)!.key)]?.rect : undefined,
        doubleCandidate:
          lastClick?.id === text &&
          performance.now() - lastClick.time < 380 &&
          Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 7,
      });
      return;
    }
    if (collapse) {
      e.preventDefault();
      s.toggleCollapse(objectId);
      return;
    }
    if (resize && objectId) {
      e.preventDefault();
      begin('resize', e, canvas, {
        id: objectId,
        handle: (resize.resize as edits.ResizeHandle) || 'se',
        rect: clone(s.doc.layout.nodes[objectId]),
      });
      s.setDrag({ kind: 'resize', resizingContainer: isGroup(s.doc, objectId) });
      return;
    }
    const current = s.tool();
    if (isDrawTool(current)) {
      e.preventDefault();
      begin('draw', e, canvas, { shape: current });
      return;
    }
    if (waypoint && objectId) {
      e.preventDefault();
      const index = Number(waypoint.waypoint);
      begin('waypoint', e, canvas, {
        id: objectId,
        index,
        point: clone(s.doc.layout.edges[objectId].waypoints![index]),
        doubleCandidate:
          lastClick?.id === objectId &&
          lastClick.index === index &&
          performance.now() - lastClick.time < 350,
      });
      return;
    }
    // A selected line's label slides with a plain drag; any line's with Alt held.
    if (edgeLabel && objectId && (e.altKey || (s.isSelected(objectId) && !e.shiftKey))) {
      e.preventDefault();
      begin('edge-label', e, canvas, {
        id: objectId,
        offset: clone(s.doc.layout.edges[objectId] || {}),
      });
      return;
    }
    const sideFromPort = () => (e.altKey ? ((port?.port as Side) ?? 'auto') : 'auto');
    if (kind === 'node' && objectId && (current === 'connect' || s.connectFrom())) {
      e.preventDefault();
      if (s.connectFrom()) return s.completeConnection(objectId, sideFromPort());
      batch(() => {
        s.setConnectFrom({ id: objectId, side: sideFromPort() });
        s.setSelection([objectId]);
      });
      begin('connect', e, canvas);
      return;
    }
    if (port && objectId) {
      e.preventDefault();
      batch(() => {
        s.setConnectFrom({ id: objectId, side: e.altKey ? (port.port as Side) : 'auto' });
        s.setSelection([objectId]);
      });
      begin('connect', e, canvas);
      return;
    }
    if ((kind === 'node' || kind === 'group') && objectId) {
      e.preventDefault();
      const doubleCandidate =
        !e.shiftKey &&
        lastClick?.id === objectId &&
        performance.now() - lastClick.time < 380 &&
        Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 7;
      if (e.shiftKey) s.selectItems([objectId], { add: true, toggle: true });
      else if (!s.isSelected(objectId)) s.setSelection([objectId]);
      if (!s.isSelected(objectId)) return;
      startObjectDrag(e, canvas, objectId, doubleCandidate);
      return;
    }
    if (kind === 'edge' && objectId) {
      e.preventDefault();
      begin('edge-click', e, canvas, {
        id: objectId,
        doubleCandidate: lastClick?.id === objectId && performance.now() - lastClick.time < 350,
        onLabel: !!edgeLabel,
      });
      s.selectItems([objectId], { add: e.shiftKey, toggle: e.shiftKey });
      return;
    }
    e.preventDefault();
    if (current === 'connect') {
      const from = s.connectFrom();
      if (from) s.quickExtend({ from: from.id, at: pos });
      else s.setConnectFrom(null);
      return;
    }
    if (!e.shiftKey) {
      begin('pan', e, canvas);
      return;
    }
    begin('marquee', e, canvas, { previousSelection: new Set(s.selection()) });
    s.focusCanvas();
  }

  /**
   * A read-only canvas: a click selects (Shift adds or removes), a drag anywhere pans, Shift on
   * the background draws a marquee, and links still open. Nothing edits the drawing.
   */
  function viewPointerDown(e: PointerEvent, canvas: Element, t: Element) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      begin('zoom', e, canvas, { start: s.screenToWorld(e.clientX, e.clientY) });
      return;
    }
    if (e.button > 1) return;
    s.options.onInteract?.();
    s.setPointer(s.screenToWorld(e.clientX, e.clientY));
    const object = targetData(t, '[data-kind]'),
      link = targetData(t, '[data-open-link]');
    e.preventDefault();
    if (e.button === 1 || s.spaceHeld()) return begin('pan', e, canvas);
    if (link) {
      if (s.options.openLink) s.options.openLink(link.openLink!);
      else if (/^[a-z][a-z0-9+.-]*:/i.test(link.openLink!))
        window.open(link.openLink!, '_blank', 'noopener');
      return;
    }
    if (object?.id && s.viewItem(object.id)) {
      if (e.shiftKey) s.selectItems([object.id], { add: true, toggle: true });
      else if (!s.isSelected(object.id) || s.selection().size > 1) s.setSelection([object.id]);
      begin('pan', e, canvas, { selected: true });
      s.focusCanvas();
      return;
    }
    if (e.shiftKey) {
      begin('marquee', e, canvas, { previousSelection: new Set(s.selection()) });
      s.focusCanvas();
      return;
    }
    begin('pan', e, canvas);
  }

  function startObjectDrag(e: PointerEvent, canvas: Element, id: string, doubleCandidate: boolean) {
    const roots = selectionRoots(s.doc, s.selection()),
      moving = new Set(roots);
    for (const root of roots)
      if (isGroup(s.doc, root)) descendants(s.doc, root).forEach(n => moving.add(n));
    const positions = Object.fromEntries([...moving].map(m => [m, clone(s.doc.layout.nodes[m])]));
    const lookup = makeGeometry(s.doc);
    // Container frames are captured once so drop targets do not shift during the drag.
    const frames = new Map(
      s.doc.graph.groups.map(g => [g.id, clone(frameRect(s.doc, lookup, g.id))]),
    );
    begin('objects', e, canvas, {
      id,
      roots,
      moving,
      positions,
      frames,
      refRect: clone(objectRect(s.doc, lookup, id)),
      // A dragged cell stays in its group, and a participant in its band: the drop reorders them.
      keepParent: e.altKey || !!s.doc.layout.sequence || roots.some(r => isCell(s.doc, r)),
      doubleCandidate,
    });
  }

  // --- Pointer move ----------------------------------------------------------------------------

  function onPointerMove(e: PointerEvent) {
    const canvas = e.currentTarget as Element;
    if (e.pointerType === 'touch' && moveTouch(e, canvas)) return e.preventDefault();
    if (!gesture && s.brushPointerMove(e)) return;
    if (!gesture) s.pointAt(targetData(e.target as Element, '[data-kind]')?.id ?? null);
    const pos = s.screenToWorld(e.clientX, e.clientY);
    s.setPointer(pos);
    const g = gesture;
    if (!g) return;
    g.current = pos;
    const dx = pos.x - g.start.x,
      dy = pos.y - g.start.y;
    if (!g.moved && Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) > 3) {
      g.moved = true;
      // Quick routes only once something really moves: a click alone must not redraw every line.
      if (g.kind === 'objects' || g.kind === 'resize') s.setQuickRouting(true);
    }

    if (g.kind === 'zoom') {
      const k = clamp(
          g.camera.k * Math.exp((g.startClient.y - e.clientY) * 0.008),
          MIN_ZOOM,
          MAX_ZOOM,
        ),
        r = canvas.getBoundingClientRect();
      s.setDoc('camera', {
        x: g.startClient.x - r.left - g.start.x * k,
        y: g.startClient.y - r.top - g.start.y * k,
        k,
      });
      return;
    }
    if (g.kind === 'pan') {
      s.setDoc('camera', {
        ...g.camera,
        x: g.camera.x + e.clientX - g.startClient.x,
        y: g.camera.y + e.clientY - g.startClient.y,
      });
      return;
    }
    if (g.kind === 'connect') return;
    if (g.kind === 'draw') {
      s.setDrag({ kind: 'draw', draw: rectFromPoints(g.start, g.current) });
      return;
    }
    if (g.kind === 'marquee') {
      const r = rectFromPoints(g.start, g.current),
        next = new Set(g.previousSelection);
      if (g.moved) {
        const vg = s.visibleScene();
        for (const n of vg.nodes) if (overlaps(s.geometry(n.id), r)) next.add(n.id);
        for (const group of vg.groups)
          if (contains(r, frameRect(s.doc, s.geometry, group.id))) {
            next.add(group.id);
            descendants(s.doc, group.id).forEach(id => next.delete(id));
          }
      }
      batch(() => {
        s.setSelection(next);
        s.setDrag({ kind: 'marquee', marquee: r });
      });
      return;
    }
    if (!g.moved) return;
    if (g.kind === 'objects') moveObjects(g, dx, dy, e);
    else if (g.kind === 'resize') {
      const next = edits.resizedRect(s.doc, g.id!, g.rect!, dx, dy, g.handle!, e.shiftKey);
      s.setDoc('layout', 'nodes', g.id!, next);
      if (isGroup(s.doc, g.id!)) s.setDoc('layout', 'containers', g.id!, 'manualSize', true);
    } else if (g.kind === 'waypoint') {
      s.setDoc('layout', 'edges', g.id!, 'waypoints', g.index!, {
        x: rounded(g.point!.x + dx),
        y: rounded(g.point!.y + dy),
      });
    } else if (g.kind === 'text') {
      if (g.noteRect) moveNote(g, dx, dy);
    } else if (g.kind === 'edge-label') {
      s.setDoc('layout', 'edges', g.id!, cfg => ({
        ...cfg,
        labelDx: rounded((g.offset!.labelDx || 0) + dx),
        labelDy: rounded((g.offset!.labelDy || 0) + dy),
      }));
    }
  }

  /** Move the dragged objects, snapping the dragged one's center to other shapes' centers. */
  function moveObjects(g: Gesture, dx: number, dy: number, e: PointerEvent) {
    let xDelta = dx,
      yDelta = dy;
    const guides: Guide[] = [];
    if (s.doc.settings.snap && !e.ctrlKey && !e.metaKey) {
      const r = g.refRect!,
        c = center({ ...r, x: r.x + dx, y: r.y + dy }),
        tolerance = 5 / s.doc.camera.k;
      for (const n of s.visibleScene().nodes) {
        if (g.moving!.has(n.id)) continue;
        const p = s.geometry(n.id),
          o = center(p);
        if (Math.abs(c.x - o.x) < tolerance && !guides.some(q => q.axis === 'x')) {
          xDelta += o.x - c.x;
          guides.push({
            axis: 'x',
            value: o.x,
            from: Math.min(p.y, r.y + dy) - 30,
            to: Math.max(p.y + p.h, r.y + dy + r.h) + 30,
          });
        }
        if (Math.abs(c.y - o.y) < tolerance && !guides.some(q => q.axis === 'y')) {
          yDelta += o.y - c.y;
          guides.push({
            axis: 'y',
            value: o.y,
            from: Math.min(p.x, r.x + dx) - 30,
            to: Math.max(p.x + p.w, r.x + dx + r.w) + 30,
          });
        }
      }
    }
    const frames = g.frames!;
    for (const id of g.moving!)
      if (isGroup(s.doc, id)) {
        const start = g.positions![id];
        frames.set(id, { ...frames.get(id)!, x: start.x + xDelta, y: start.y + yDelta });
      }
    g.keepParent = e.altKey;
    s.setDoc(
      produce(d => {
        for (const [id, p] of Object.entries(g.positions!))
          d.layout.nodes[id] = { ...p, x: rounded(p.x + xDelta), y: rounded(p.y + yDelta) };
      }),
    );
    g.dropId =
      g.roots!.length === 1
        ? edits.dropTarget(s.doc, g.id!, s.doc.layout.nodes[g.id!], frames)?.id
        : null;
    s.setDrag({ kind: 'objects', guides, dropTargetId: g.keepParent ? null : g.dropId });
  }

  /** Where a dragged note would go: its box under the pointer and the object it would sit by. */
  function noteTarget(g: Gesture) {
    return noteAnchor(
      g.current,
      s.sceneRects(),
      s.doc.layout.sequence
        ? s.routes().filter(r => s.doc.layout.edges[r.id]?.row !== undefined)
        : [],
    );
  }

  function moveNote(g: Gesture, dx: number, dy: number) {
    const r = g.noteRect!;
    s.setDrag({
      kind: 'text',
      text: { rect: { ...r, x: r.x + dx, y: r.y + dy }, near: noteTarget(g)?.near },
    });
  }

  /** A dropped note sits beside the object it was dropped by, on that side: `near=` and `side=`. */
  function finishNoteMove(g: Gesture) {
    const i = Number(parseTextId(g.id)!.key),
      note = s.doc.appearance.notes?.[i],
      target = noteTarget(g);
    if (!note) return;
    if (!target) return toast('Drop a note beside a shape, container or message.');
    if (note.near === target.near && noteSide(s.doc, note) === target.side) return;
    s.transact('Move note', d => {
      Object.assign(d.appearance.notes![i], target);
    });
  }

  // --- Pointer up ------------------------------------------------------------------------------

  function onPointerUp(e: PointerEvent | null) {
    if (e?.pointerType === 'touch' && endTouch(e)) return;
    if (s.brushPointerUp(e ?? undefined)) return;
    const g = gesture;
    if (!g) return;
    end(g.moved && (g.kind === 'objects' || g.kind === 'resize') && s.editsGoToFile());
    if (g.kind === 'connect') return finishConnect(g, e);
    if (g.kind === 'zoom') return s.persist();
    if (g.kind === 'pan') {
      if (g.moved) s.persist();
      else if (g.selected) return;
      else if (g.clickId) s.setSelection([g.clickId]);
      else s.clearSelection();
      return;
    }
    if (g.kind === 'marquee') return;
    if (g.kind === 'draw') return finishDraw(g);
    if (!g.moved) {
      if (g.doubleCandidate) {
        suppressDoubleClickUntil = performance.now() + 450;
        lastClick = null;
        if (g.kind === 'waypoint') s.removeWaypoint(g.id!, g.index!);
        else if (g.kind === 'edge-click' && !g.onLabel) s.addWaypointAt(g.id!, g.start);
        else s.startInlineEdit(g.id!);
        return;
      }
      if (g.id && e)
        lastClick = {
          id: g.id,
          index: g.index,
          time: performance.now(),
          x: e.clientX,
          y: e.clientY,
        };
      return;
    }
    lastClick = null;
    if (g.kind === 'text') return finishNoteMove(g);
    if (g.kind === 'objects') {
      // Moving a container does not mark its children as manually placed.
      s.setDoc(
        produce(d => {
          for (const id of g.roots!) {
            d.layout.nodes[id].manual = true;
            if (!g.keepParent) {
              const target = edits.dropTarget(d, id, d.layout.nodes[id], g.frames),
                object = findObject(d, id)!;
              if (target) object.parentId = target.id;
              else delete object.parentId;
            }
            edits.ensureParentsFit(d, id);
          }
        }),
      );
    }
    if (g.kind === 'resize') s.setDoc(produce(d => edits.ensureParentsFit(d, g.id!)));
    if (g.kind === 'waypoint') {
      const p = s.doc.layout.edges[g.id!]?.waypoints?.[g.index!];
      if (p && edits.bendInsideShape(s.doc, p)) {
        s.restoreDocument(normalize(JSON.parse(g.before)), { keepCamera: true });
        toast('A bend must stay outside shapes.');
        return;
      }
    }
    const labels: Partial<Record<DragKind, string>> = {
      objects: 'Move objects',
      resize: isGroup(s.doc, g.id!) ? 'Resize container' : 'Resize shape',
      waypoint: 'Move bend',
      'edge-label': 'Move connection label',
    };
    s.commit(g.before, labels[g.kind] || 'Edit');
  }

  function finishConnect(g: Gesture, e: PointerEvent | null) {
    const target = e ? document.elementFromPoint(e.clientX, e.clientY) : null,
      node = target?.closest('[data-kind="node"]') as SVGElement | null,
      port = (target?.closest('[data-port]') as SVGElement | null)?.dataset.port as
        Side | undefined;
    if (g.moved && node)
      s.completeConnection(node.dataset.id!, e?.altKey ? (port ?? 'auto') : 'auto');
    else if (g.moved && e && target?.closest('.canvas') && s.connectFrom())
      s.quickExtend({ from: s.connectFrom()!.id, at: s.screenToWorld(e.clientX, e.clientY) });
    else if (g.moved) s.setConnectFrom(null);
  }

  function finishDraw(g: Gesture) {
    const r: Rect = g.moved
      ? {
          ...rectFromPoints(g.start, g.current),
          w: Math.max(40, Math.abs(g.current.x - g.start.x)),
          h: Math.max(28, Math.abs(g.current.y - g.start.y)),
        }
      : { x: g.start.x - 82, y: g.start.y - 28, w: 164, h: 56 };
    s.setToolSignal('select');
    if (g.shape === 'container') {
      const frame = g.moved
        ? { ...r, w: Math.max(180, r.w), h: Math.max(120, r.h) }
        : { x: g.start.x - 170, y: g.start.y - 120, w: 340, h: 240 };
      s.drawContainer(frame);
      return;
    }
    const target = edits.dropTarget(s.doc, '', r);
    s.addNode(
      {
        title: g.shape === 'text' ? 'Text' : 'New box',
        style: { shape: g.shape, icon: '', color: g.shape === 'text' ? 'slate' : 'blue' },
        position: { x: r.x, y: r.y },
        w: r.w,
        h: r.h,
        ...(target ? { parentId: target.id } : {}),
      },
      center(r),
      true,
    );
  }

  // --- Double click ----------------------------------------------------------------------------

  function onDoubleClick(e: MouseEvent) {
    if (s.readOnly()) {
      // The canvas holds the pointer during a pan, so the object is also found by position.
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const id =
        targetData(e.target as Element, '[data-kind]')?.id ??
        (under && targetData(under, '[data-kind]')?.id);
      return void s.activate(id);
    }
    if (s.timelineOpen() || s.stroking()) return e.preventDefault();
    if (s.inlineEditId() || performance.now() < suppressDoubleClickUntil) return;
    const t = e.target as Element,
      // The canvas holds the pointer during a background gesture, so the heading is found by position.
      under = document.elementFromPoint(e.clientX, e.clientY) ?? t,
      text = targetData(under, '[data-text]')?.text,
      hint = targetData(under, '[data-text-hint]')?.textHint,
      waypoint = targetData(t, '[data-waypoint]'),
      object = targetData(t, '[data-kind]') ?? targetData(under, '[data-kind]');
    if (text) return s.startInlineEdit(text);
    if (hint) return toast(hint);
    if (under.closest('[data-frame-edge]')) return;
    if (waypoint && object?.id) return s.removeWaypoint(object.id, Number(waypoint.waypoint));
    if (object?.kind === 'node') return s.startInlineEdit(object.id!);
    if (object?.kind === 'group' && under.closest('[data-group-header],.group-title'))
      return s.startInlineEdit(object.id!);
    if (object?.kind === 'edge') {
      if (under.closest('[data-edge-label]')) s.startInlineEdit(object.id!);
      else s.addWaypointAt(object.id!, s.screenToWorld(e.clientX, e.clientY));
      return;
    }
    const p = s.screenToWorld(e.clientX, e.clientY),
      target = edits.dropTarget(s.doc, '', { x: p.x, y: p.y, w: 0, h: 0 });
    s.addNode(target ? { parentId: target.id } : {}, p, true);
  }

  /** Right-click selects the object under the pointer before the edit menu opens. */
  function selectForContextMenu(e: MouseEvent) {
    const object = targetData(e.target as Element, '[data-kind]');
    if (object?.id && !s.isSelected(object.id)) s.setSelection([object.id]);
  }

  const dragKind = () => s.drag()?.kind;
  return {
    isDragging,
    cancelGesture,
    resetModifiers,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    selectForContextMenu,
    dragKind,
  };
}

export type PointerPart = ReturnType<typeof createPointer>;
