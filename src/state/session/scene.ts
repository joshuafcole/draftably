/**
 * Everything drawn on the canvas, derived from the committed document plus any temporary
 * geometry (layout animation, a held "before" preview, or a timeline/brush preview).
 */
import { createMemo, createSignal } from 'solid-js';
import type { PriorRoute, RoutingResult } from '../../engines/routing-engine.js';
import { routingFingerprint } from '../../model/document';
import { drawingBounds } from '../../model/bounds';
import { resolveAppearance } from '../../model/appearance';
import { diagramFrame, FRAME_PAD } from '../../model/frame';
import { placeNotes } from '../../model/note';
import { drawnLegend, usedStatuses } from '../../model/status';
import {
  frameRect,
  makeGeometry,
  styleOf,
  visibleGraph,
  type VisibleGraph,
} from '../../model/graph';
import { startEngineTask, type RunningTask } from '../../lib/engine-tasks';
import {
  computeRoutes,
  drawRoutes,
  knownRoutes,
  rememberRoutes,
  routeInput,
  type DrawnRoute,
} from '../../model/routes';
import type { NodeGeometry, NodeLayout, Rect } from '../../model/types';
import type { DocumentPart } from './document';
import type { FileSessionPart } from './file-session';

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

export function createScene(s: DocumentPart & FileSessionPart) {
  const state = (() => {
    /** Timeline scrubbing and brush strokes; takes priority over everything else. */
    const [sculptGeometry, setSculptGeometry] = createSignal<NodeGeometry | null>(null);
    /** Layout animation and "hold to see before". */
    const [animationGeometry, setAnimationGeometry] = createSignal<NodeGeometry | null>(null);
    /** Use the fast, single-pass router while something is being dragged. */
    const [quickRouting, setQuickRouting] = createSignal(false);
    /** Earlier routes that a timeline should keep stable while it scrubs. */
    const [routePrior, setRoutePrior] = createSignal<PriorRoute[] | null>(null);
    /** Routes already computed for a document (e.g. by a comparison candidate) to show as-is. */
    const [adoptedRoutes, setAdoptedRoutes] = createSignal<{
      fingerprint: string;
      result: RoutingResult;
    } | null>(null);

    const geometry = (id: string): NodeLayout =>
      sculptGeometry()?.[id] ?? animationGeometry()?.[id] ?? makeGeometry(s.doc)(id);

    const visible = createMemo<VisibleGraph>(() => visibleGraph(s.doc));
    const nodeIds = createMemo(() => visible().nodes.map(n => n.id), [], { equals: sameIds });
    const groupIds = createMemo(() => visible().groups.map(g => g.id), [], { equals: sameIds });
    const edgeIds = createMemo(() => visible().edges.map(e => e.id), [], { equals: sameIds });

    const rects = createMemo(() => {
      const vg = visible(),
        map = new Map<string, Rect>();
      for (const n of vg.nodes) map.set(n.id, { ...geometry(n.id) });
      for (const g of vg.groups) map.set(g.id, frameRect(s.doc, geometry, g.id));
      return map;
    });

    let lastRoutes: DrawnRoute[] = [];
    let cache: {
      signature: string;
      value: { routes: DrawnRoute[]; result: RoutingResult };
    } | null = null;

    /** Bumped to force routes to be recomputed from scratch. */
    const [epoch, setEpoch] = createSignal(0);

    /** Full routes being drawn in a worker for the document with this fingerprint. */
    let refining: { fingerprint: string; task: RunningTask<RoutingResult> } | null = null;
    const [refinePending, setRoutesPending] = createSignal(false);
    /** A shown file revision's routes are coming from its compile in the worker. */
    const [awaiting, setAwaiting] = createSignal(false);
    const routesPending = () => refinePending() || awaiting();
    const stopRefining = () => {
      refining?.task.cancel();
      refining = null;
      setRoutesPending(false);
    };
    /**
     * Route the drawing in a worker, as the file would be routed, then show those routes. Not when
     * an edit is compiling: its compile routes the file in the worker already.
     */
    const refine = (fingerprint: string) =>
      queueMicrotask(() => {
        if (s.fileCompiling() || refining?.fingerprint === fingerprint) return;
        if (routingFingerprint(s.doc) === fingerprint) startRefining(fingerprint);
      });
    function startRefining(fingerprint: string) {
      stopRefining();
      const task = startEngineTask({
        kind: 'route',
        input: routeInput(s.doc, visible(), rects()),
        options: { ...s.doc.settings.routing, previous: [] },
      });
      refining = { fingerprint, task };
      setRoutesPending(true);
      const done = () => {
        if (refining?.task !== task) return false;
        refining = null;
        setRoutesPending(false);
        return true;
      };
      task.promise.then(
        result => {
          if (done() && routingFingerprint(s.doc) === fingerprint)
            setAdoptedRoutes({ fingerprint, result });
        },
        () => void done(),
      );
    }

    const routing = createMemo(() => {
      epoch();
      const vg = visible(),
        map = rects(),
        quick = quickRouting(),
        temporary = !!sculptGeometry() || !!animationGeometry();
      const adopted = adoptedRoutes(),
        fingerprint = routingFingerprint(s.doc),
        ready = !quick && !temporary && adopted?.fingerprint === fingerprint,
        // A file's full routes come from the engine worker, with each compiled revision or from
        // `refine`: routing a large file here would block the page for seconds.
        known = s.fileMode() && !quick && !temporary && !ready ? knownRoutes(s.doc, vg, map) : null,
        deferred = s.fileMode() && !quick && !temporary && !ready && !known;
      if (deferred && !s.fileCompiling() && !awaiting()) refine(fingerprint);
      else if (!deferred && refining) queueMicrotask(stopRefining);
      const signature = JSON.stringify([
        vg.edges,
        [...map],
        s.doc.layout.edges,
        s.doc.settings.routing,
        vg.groups.map(g => [g.id, g.parentId, s.doc.collapsed.includes(g.id)]),
        vg.nodes.map(n => [n.id, n.parentId, styleOf(s.doc, n.id).shape]),
        quick,
        temporary,
        deferred,
        !!known,
      ]);
      if (cache?.signature === signature) return cache.value;
      let value;
      if (ready) {
        const result = structuredClone(adopted.result);
        rememberRoutes(s.doc, vg, map, result);
        value = { result, routes: drawRoutes(s.doc, vg, map, result) };
      } else if (known) value = { result: known, routes: drawRoutes(s.doc, vg, map, known) };
      else if (deferred)
        value = computeRoutes(s.doc, vg, map, { previous: lastRoutes, quick: true });
      else {
        value = computeRoutes(s.doc, vg, map, {
          // A diagram file must draw the same routes as `draftably inspect`, so no earlier routes,
          // except while dragging: quick routes keep each line's sides from the last frame, so a
          // drag doesn't search every line from scratch on every pointer move. The drop redraws
          // without them.
          previous: s.fileMode() && !quick ? [] : (routePrior() ?? lastRoutes),
          quick: quick || !!animationGeometry(),
        });
      }
      lastRoutes = value.routes;
      cache = { signature, value };
      return value;
    });

    const routesById = createMemo(() => new Map(routing().routes.map(r => [r.id, r])));
    /** Connections in draw order: `drawRoutes` puts a line that stays whole last. */
    const routeIds = createMemo(() => routing().routes.map(r => r.id), [], { equals: sameIds });

    return {
      sculptGeometry,
      setSculptGeometry,
      animationGeometry,
      setAnimationGeometry,
      quickRouting,
      setQuickRouting,
      routePrior,
      setRoutePrior,
      setAdoptedRoutes,
      geometry,
      visible,
      nodeIds,
      groupIds,
      edgeIds,
      rects,
      routing,
      routesById,
      routeIds,
      routesPending,
      setAwaiting,
      resetRoutes() {
        cache = null;
        lastRoutes = [];
        setEpoch(n => n + 1);
      },
      routeInputFor: () => routeInput(s.doc, visible(), rects()),
    };
  })();

  const {
    sculptGeometry,
    setSculptGeometry,
    animationGeometry,
    setAnimationGeometry,
    setQuickRouting,
    routePrior,
    setRoutePrior,
    setAdoptedRoutes,
    geometry,
    visible: visibleScene,
    nodeIds,
    groupIds,
    edgeIds,
    rects: sceneRects,
    routing,
    routesById,
    routeIds,
    routesPending,
    resetRoutes,
    routeInputFor,
  } = state;

  s.setRouteSink({ adopt: setAdoptedRoutes, quick: setQuickRouting, awaiting: state.setAwaiting });

  const routes = () => routing().routes;
  const routingReport = () => routing().result.report;
  const blockedRouteIds = () =>
    routes()
      .filter(r => r.blocked)
      .map(r => r.id);

  /** Bounds of everything drawn: shapes with labels, containers, and connections. */
  function sceneBounds(): Rect {
    return drawingBounds(s.doc, visibleScene(), sceneRects(), routes());
  }

  /** The frame the viewer draws round the drawing, which the editor's exports draw as well. */
  const viewerFrame = createMemo(() => {
    const look = resolveAppearance(s.doc.appearance);
    return diagramFrame(
      look,
      s.doc.appearance.heading,
      drawnLegend(s.doc),
      usedStatuses(s.doc),
      drawingBounds(s.doc, visibleScene(), sceneRects(), routes(), FRAME_PAD),
      placeNotes(s.doc, look, sceneRects(), routes()),
      s.doc.appearance.footnotes,
    );
  });
  return {
    sculptGeometry,
    setSculptGeometry,
    animationGeometry,
    setAnimationGeometry,
    setQuickRouting,
    routePrior,
    setRoutePrior,
    setAdoptedRoutes,
    geometry,
    visibleScene,
    nodeIds,
    groupIds,
    edgeIds,
    sceneRects,
    routing,
    routesById,
    routeIds,
    routesPending,
    resetRoutes,
    routeInputFor,
    routes,
    routingReport,
    blockedRouteIds,
    sceneBounds,
    viewerFrame,
  };
}

export type ScenePart = ReturnType<typeof createScene>;
