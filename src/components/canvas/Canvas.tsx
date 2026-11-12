import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { setActiveSession } from '../../state/active-session';
import { BrushDock } from '../sculpt/BrushDock';
import { TimelineDeck } from '../sculpt/TimelineDeck';
import { CrossingView, EdgeView } from '../scene/EdgeView';
import { BundleView } from '../scene/BundleView';
import { GroupView } from '../scene/GroupView';
import { NodeChrome, NodeView } from '../scene/NodeView';
import { Lifelines, SequenceBackdrop } from '../scene/Lifelines';
import { PositionMarks } from '../scene/PositionMarks';
import { InlineEditor } from './InlineEditor';
import { Overlay } from './Overlay';
import { Frame } from './Frame';
import { Notes } from './Notes';
import { TextHits } from './TextHits';
import { StateBar } from './StateBar';
import { ZoomControls } from './ZoomControls';
import { LayoutPreviewBar } from '../LayoutPreviewBar';
import { Icon } from '../Icon';
import './canvas.css';
import { useDiagramSession } from '../session-context';

const CANVAS_LABEL =
  'Diagram canvas. N adds a box. Enter edits. C connects. Drag nodes to edit; drag background to pan. ' +
  'Escape returns to Edit. Shift drag selects. The wheel zooms; Shift + wheel pans. Question mark opens shortcuts.';

export interface CanvasProps {
  /** Open the host's context menu; the canvas has already selected what was clicked. */
  onContextMenu?: (e: MouseEvent) => void;
  /** Files dropped on the canvas. Without it the canvas takes no drops. */
  onDropFiles?: (files: File[]) => Promise<void> | void;
  /** Shown under the hint on an empty canvas, such as a button that builds from a list. */
  emptyAction?: JSX.Element;
  /** The host's slot targets, above the drawing and below the chrome layer. */
  anchorLayer?: HTMLElement;
  /** Nodes a host body covers: their titles hide, and their ports and handles draw on top. */
  bodies?: () => ReadonlySet<string>;
  /**
   * A host's marks that move and zoom with the drawing, above it: an HTML layer whose origin is
   * the drawing's, so a child positioned at an object's `rectOf(id)` sits on it at any camera.
   * It takes no pointer events itself; a child that wants them sets `pointer-events: auto`.
   */
  sceneLayer?: JSX.Element;
  /**
   * A host's chrome fixed to the canvas, above the scene layer: positioned in canvas pixels
   * (`rectOf(id, 'screen')`), so a mark attached to a point pans with it but keeps its size.
   * Pointer events as for `sceneLayer`; the wheel over either layer still zooms the canvas.
   */
  screenLayer?: JSX.Element;
}

/** Host content and form fields that take their own focus and keys. */
const FIELD = '[data-draft-input], input, textarea, select, [contenteditable]';

/**
 * The canvas for the session in context: drawing, selection, dragging, inline editing, layout
 * previews, the timeline and the brush. Pointing at it or focusing it makes its session active.
 */
export function Canvas(props: CanvasProps) {
  const s = useDiagramSession();
  let stage!: HTMLElement;
  let svg!: SVGSVGElement;
  let world!: SVGGElement;
  const [dropping, setDropping] = createSignal(false);
  let dragDepth = 0;

  onMount(() => {
    s.registerCanvas(svg);
    const observer = new ResizeObserver(([entry]) =>
      s.setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(stage);
    svg.addEventListener('wheel', s.onWheel, { passive: false });
    // Before any handler inside it runs, so menus, shortcuts and commands act on this session.
    const activate = () => setActiveSession(s);
    // A press on the drawing takes focus from anything outside it, such as a host's field in a
    // viewer's slot, so the next key reaches this editor. Most presses call preventDefault, so
    // the browser would leave focus where it was. A press on a field keeps the field's focus.
    const press = (e: PointerEvent) => {
      activate();
      if (e.composedPath().some(n => n instanceof Element && n.matches(FIELD))) return;
      // The page's focus, through every shadow root: it may sit far outside this editor.
      let active = stage.ownerDocument.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (active && active !== stage.ownerDocument.body && !stage.contains(active)) s.focusCanvas();
    };
    stage.addEventListener('pointerdown', press, true);
    stage.addEventListener('focusin', activate, true);
    // A click with no press before it (assistive tech, a host's script) acts on this session too:
    // the zoom controls run on the active session, and none, or a closed map's, is a Fit that
    // frames nothing.
    stage.addEventListener('click', activate, true);
    onCleanup(() => {
      observer.disconnect();
      svg.removeEventListener('wheel', s.onWheel);
      stage.removeEventListener('pointerdown', press, true);
      stage.removeEventListener('focusin', activate, true);
      stage.removeEventListener('click', activate, true);
    });
  });

  const camera = () => s.doc.camera;
  // The drawing in the chosen emphasis state; edits still go to `doc`.
  const shown = createMemo(s.drawnDoc);
  // A comparison panel leaves out the other side's objects; the scene still lays out the merge.
  const kept = createMemo(() => {
    const d = shown();
    return new Set([...d.graph.nodes, ...d.graph.groups, ...d.graph.edges].map(o => o.id));
  });
  const keep = (ids: string[]) => (s.panel() ? ids.filter(id => kept().has(id)) : ids);
  const isSelected = (id: string) => s.selection().has(id);
  /** The bundle the pointer or focus holds, and the one a press picked: each draws spread. */
  const [heldBundle, setHeldBundle] = createSignal<string | null>(null);
  const [pickedBundle, setPickedBundle] = createSignal<string | null>(null);
  const bundleIds = createMemo(() => s.bundles().map(b => b.id), [], {
    equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
  });
  const bundleById = createMemo(() => new Map(s.bundles().map(b => [b.id, b])));
  const empty = () => !s.nodeIds().length && !s.groupIds().length;

  const onPointerUp = (e: PointerEvent) => {
    s.onPointerUp(e);
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth = 0;
    setDropping(false);
    void props.onDropFiles?.([...(e.dataTransfer?.files ?? [])]);
  };
  const hasFiles = (e: DragEvent) =>
    !!props.onDropFiles && !!e.dataTransfer?.types.includes('Files');

  return (
    <main
      ref={stage}
      class="stage"
      classList={{
        'is-dragging': !!s.drag() && s.drag()!.kind === 'pan',
        'space-held': s.spaceHeld(),
        'has-timeline': s.timelineOpen(),
        'has-brush': s.brushActive(),
        'read-only': s.readOnly(),
      }}
      data-tool={s.tool()}
      aria-label="Diagram workspace"
      onDragEnter={e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth++;
        setDropping(true);
      }}
      onDragOver={e => hasFiles(e) && e.preventDefault()}
      onDragLeave={() => {
        if (--dragDepth <= 0) setDropping(false);
      }}
      onDrop={onDrop}
    >
      <svg
        ref={svg}
        class="canvas"
        role="application"
        tabindex="0"
        aria-label={CANVAS_LABEL}
        onPointerDown={s.onPointerDown}
        onPointerMove={s.onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => s.resetModifiers()}
        onPointerLeave={() => {
          s.pointAt(null);
          s.brushPointerLeave();
        }}
        onLostPointerCapture={() => s.brushActive() && s.cancelStroke()}
        onDblClick={s.onDoubleClick}
        onContextMenu={e => {
          e.preventDefault();
          s.selectForContextMenu(e);
          props.onContextMenu?.(e);
        }}
      >
        <defs>
          <pattern
            id="canvas-dots"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${camera().x % (24 * camera().k)},${camera().y % (24 * camera().k)}) scale(${camera().k})`}
          >
            <circle cx="1" cy="1" r=".7" fill="var(--dot)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#canvas-dots)" />
        <g
          ref={world}
          class="scene"
          classList={{ connecting: s.tool() === 'connect' }}
          transform={`translate(${camera().x},${camera().y}) scale(${camera().k})`}
        >
          <Show when={!empty()}>
            <Frame />
          </Show>
          <SequenceBackdrop doc={shown()} part="panel" />
          <g>
            <For each={keep(s.groupIds())}>
              {id => (
                <GroupView
                  doc={shown()}
                  id={id}
                  rect={s.sceneRects().get(id)!}
                  selected={isSelected(id)}
                  hovered={s.hoveredId() === id}
                  dropTarget={s.drag()?.dropTargetId === id}
                  editing={s.inlineEditId() === id}
                  interactive
                  zoom={camera().k}
                />
              )}
            </For>
          </g>
          <SequenceBackdrop doc={shown()} part="phases" />
          <Lifelines doc={s.doc} ids={s.nodeIds()} rect={id => s.sceneRects().get(id)} />
          <g>
            <For each={keep(s.routeIds()).filter(id => !s.bundleOf().has(id))}>
              {id => (
                <Show when={s.routesById().get(id)}>
                  {route => (
                    <EdgeView
                      doc={shown()}
                      route={route()}
                      selected={isSelected(id)}
                      hovered={s.hoveredId() === id}
                      editing={s.inlineEditId() === id}
                      interactive
                    />
                  )}
                </Show>
              )}
            </For>
            <For each={bundleIds()}>
              {id => (
                <Show when={bundleById().get(id)}>
                  {bundle => (
                    <BundleView
                      doc={shown()}
                      bundle={bundle()}
                      route={member => s.routesById().get(member)}
                      selected={isSelected}
                      hovered={member => s.hoveredId() === member}
                      editing={member => s.inlineEditId() === member}
                      spread={heldBundle() === id || pickedBundle() === id}
                      onHold={held => setHeldBundle(now => (held ? id : now === id ? null : now))}
                      onPick={() => setPickedBundle(now => (now === id ? null : id))}
                      onName={
                        s.readOnly()
                          ? undefined
                          : name => s.nameBundle(bundle().a, bundle().b, name)
                      }
                      interactive
                    />
                  )}
                </Show>
              )}
            </For>
          </g>
          <g>
            <For each={keep(s.nodeIds())}>
              {id => (
                <NodeView
                  doc={shown()}
                  id={id}
                  rect={s.geometry(id)}
                  selected={isSelected(id)}
                  hovered={s.hoveredId() === id}
                  editing={s.inlineEditId() === id}
                  interactive
                  zoom={camera().k}
                  body={props.bodies?.().has(id)}
                />
              )}
            </For>
          </g>
          <PositionMarks doc={shown()} rects={s.sceneRects()} bounds={s.sceneBounds()} />
          <g>
            <For each={keep(s.edgeIds())}>
              {id => (
                <Show when={s.routesById().get(id)?.cross && s.routesById().get(id)}>
                  {route => <CrossingView doc={s.doc} route={route()} selected={isSelected(id)} />}
                </Show>
              )}
            </For>
          </g>
          <Show when={s.doc.appearance.notes?.length}>
            <Notes />
          </Show>
          <Show when={!empty()}>
            <TextHits />
          </Show>
          <Overlay />
        </g>
      </svg>
      {props.anchorLayer}
      <Show when={props.bodies?.().size}>
        {/* Above the host's bodies: the ports and handles of the nodes they cover. A gesture
            that starts here captures the pointer here, so this layer takes the canvas's
            handlers too. */}
        <svg
          class="canvas-chrome"
          aria-hidden="true"
          onPointerDown={s.onPointerDown}
          onPointerMove={s.onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => s.resetModifiers()}
          onDblClick={s.onDoubleClick}
        >
          <g transform={`translate(${camera().x},${camera().y}) scale(${camera().k})`}>
            <For each={s.nodeIds().filter(id => props.bodies!().has(id))}>
              {id => (
                <NodeChrome
                  doc={shown()}
                  id={id}
                  rect={s.geometry(id)}
                  selected={isSelected(id)}
                  zoom={camera().k}
                />
              )}
            </For>
          </g>
        </svg>
      </Show>
      <div class="host-layers" onWheel={e => s.onWheel(e)}>
        <div
          class="host-layer host-layer--scene"
          style={{
            transform: `translate(${camera().x}px, ${camera().y}px) scale(${camera().k})`,
          }}
        >
          {props.sceneLayer}
        </div>
        <div class="host-layer host-layer--screen">{props.screenLayer}</div>
      </div>

      <Show when={empty()}>
        <div class="empty-canvas">
          <h2>Draw something.</h2>
          <p>
            <kbd>N</kbd> adds a box. Type a title, then <kbd>Tab</kbd> to keep going.
          </p>
          {props.emptyAction}
        </div>
      </Show>
      <InlineEditor />
      <StateBar />
      <ZoomControls />
      <TimelineDeck />
      <BrushDock />
      <LayoutPreviewBar />
      <Show when={dropping()}>
        <div class="drop-overlay">
          <Icon name="upload" />
          Drop an image or a saved diagram
        </div>
      </Show>
    </main>
  );
}
