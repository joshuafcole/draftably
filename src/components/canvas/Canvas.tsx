import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { setActiveSession } from '../../state/active-session';
import { BrushDock } from '../sculpt/BrushDock';
import { TimelineDeck } from '../sculpt/TimelineDeck';
import { CrossingView, EdgeView } from '../scene/EdgeView';
import { GroupView } from '../scene/GroupView';
import { NodeView } from '../scene/NodeView';
import { Lifelines, SequenceBackdrop } from '../scene/Lifelines';
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
}

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
    stage.addEventListener('pointerdown', activate, true);
    stage.addEventListener('focusin', activate, true);
    onCleanup(() => {
      observer.disconnect();
      svg.removeEventListener('wheel', s.onWheel);
      stage.removeEventListener('pointerdown', activate, true);
      stage.removeEventListener('focusin', activate, true);
    });
  });

  const camera = () => s.doc.camera;
  // The drawing in the chosen emphasis state; edits still go to `doc`.
  const shown = createMemo(s.drawnDoc);
  const isSelected = (id: string) => s.selection().has(id);
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
            <For each={s.groupIds()}>
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
            <For each={s.routeIds()}>
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
          </g>
          <g>
            <For each={s.nodeIds()}>
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
                />
              )}
            </For>
          </g>
          <g>
            <For each={s.edgeIds()}>
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
