/**
 * Which emphasis state the viewer draws, and whether it shows all of them as a grid. Both are
 * view state, like the camera: they live in the URL (`?state=write`), never in the file. The frame
 * round the drawing is here too, since the drawn state decides which notes it holds.
 */
import { createMemo, createSignal } from 'solid-js';
import { resolveAppearance } from '../../model/appearance';
import { drawingBounds } from '../../model/bounds';
import { diagramFrame, FRAME_PAD } from '../../model/frame';
import { placeNotes } from '../../model/note';
import { panelDoc, type PanelSide } from '../../model/panels';
import { drawnLegend, listedStates, usedStatuses, withState } from '../../model/status';
import type { DocumentPart } from './document';
import type { ScenePart } from './scene';

export function createEmphasis(s: DocumentPart & ScenePart) {
  const state = (() => {
    const [active, setActive] = createSignal<string | null>(
      s.options.urlState ? new URLSearchParams(location.search).get('state') : null,
    );
    const [grid, setGrid] = createSignal(false);
    const [panel, setPanel] = createSignal<PanelSide | null>(s.options.panel ?? null);
    return { active, setActive, grid, setGrid, panel, setPanel };
  })();

  /** The side of a marked document this session draws, or null for the whole merge. */
  const panel = state.panel;
  /**
   * Draw one side of a marked document, as a comparison panel does: `before` leaves out what was
   * added and shows old values, `after` leaves out what was removed. The layout stays the
   * merge's, so every object kept sits where it does in the other panel. Null draws the merge.
   */
  const showPanel = (side: PanelSide | null) => state.setPanel(side);

  /**
   * The states the chips list, in file order: every state but those with `chips=hidden`. The grid
   * and `stepState` go through these too.
   */
  const states = () => listedStates(s.doc);

  /**
   * The drawn state's ID, or null for none; a stale ID from the URL counts as none. A hidden state
   * counts once `showState` draws it, though no chip is pressed for it.
   */
  const activeState = () => {
    const id = state.active();
    return id && (s.doc.appearance.states ?? []).some(s => s.id === id) ? id : null;
  };

  const gridOpen = state.grid;
  const setGridOpen = state.setGrid;

  /** Draw state `id`, hidden from the chips or not, or none with null. */
  function showState(id: string | null) {
    state.setActive(id);
    if (!s.options.urlState) return;
    const url = new URL(location.href);
    if (id) url.searchParams.set('state', id);
    else url.searchParams.delete('state');
    history.replaceState(history.state, '', url);
  }

  /**
   * Step through None and each listed state in file order; false when the file lists none. From a
   * hidden state, a step goes to the first or last listed state.
   */
  function stepState(by: 1 | -1) {
    const ids = [null, ...states().map(s => s.id)];
    if (ids.length < 2) return false;
    // A hidden state is not on the list, so a step from it starts as if from None.
    const at = Math.max(0, ids.indexOf(activeState()));
    showState(ids[(at + by + ids.length) % ids.length]);
    return true;
  }

  /** The document as the canvas draws it: in the active state, or as it is, on the shown side. */
  const drawnDoc = () => {
    const id = activeState(),
      doc = id ? withState(s.doc, id) : s.doc,
      side = panel();
    return side ? panelDoc(doc, side) : doc;
  };
  /**
   * The frame the viewer draws round the drawing, which the editor's exports draw as well. It
   * holds the notes the drawn state shows; a note with `states=` is `hidden` in any other. One
   * memo for every reader (the frame, the notes, text hits, a host's overlay): a glide changes the
   * routes every frame, and each reader placing the notes again cost a frame that much more.
   */
  const viewerFrame = createMemo(() => {
    const look = resolveAppearance(s.doc.appearance),
      id = activeState(),
      side = panel();
    return diagramFrame(
      look,
      s.doc.appearance.heading,
      drawnLegend(s.doc),
      // A panel's key counts what that panel shows; the merge counts both versions.
      usedStatuses(side ? panelDoc(s.doc, side) : s.doc),
      drawingBounds(s.doc, s.visibleScene(), s.sceneRects(), s.routes(), FRAME_PAD),
      placeNotes(id ? { ...s.doc, drawnState: id } : s.doc, look, s.sceneRects(), s.routes()),
      s.doc.appearance.footnotes,
    );
  });
  return {
    panel,
    showPanel,
    viewerFrame,
    states,
    activeState,
    gridOpen,
    setGridOpen,
    showState,
    stepState,
    drawnDoc,
  };
}

export type EmphasisPart = ReturnType<typeof createEmphasis>;
