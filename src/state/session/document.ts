/**
 * The committed diagram, its undo history, selection and browser persistence.
 * Every saved change goes through `transact`, which records exactly one undo step.
 */
import { batch, createSignal } from 'solid-js';
import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import { STORAGE_KEY } from '../../lib/saved-diagram';
import { emptyDiagram, normalize } from '../../model/document';
import { findEntity } from '../../model/graph';
import { DEFAULT_SAMPLE, loadSample } from '../../model/samples';
import type { Camera, Diagram } from '../../model/types';
import { toast } from '../toast';
import type { CanvasTextPart } from './canvas-text';
import type { SessionOptions } from '.';
import type { CameraReason } from './camera';

const LEGACY_KEYS = ['diagram-studio-v4', 'diagram-studio-v3', 'diagram-studio-v2'];
const HISTORY_LIMIT = 80;

export interface HistoryEntry {
  data: string;
  label: string;
  /** Local brush holds before and after this step; holds are session state, not document data. */
  holds?: { before: string[]; after: string[] };
}

type SaveStatus = 'saved' | 'saving' | 'preview' | 'failed';

/**
 * Handles every committed edit instead of the browser history while a diagram file is open, so
 * the edit can be written to the file. Returns whether the edit was kept.
 */
type CommitHandler = (before: string, label: string, kind: EditKind) => boolean;
/**
 * `arrangement`: the edit is a drawing produced by a layout pass, a timeline step or the brush,
 * saved as positions rather than translated move by move.
 */
export type EditKind = 'edit' | 'arrangement';

/** Replaces the browser history while a diagram file is open: undo steps through its source. */
export interface HistoryHandler {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export function createDocument(s: CanvasTextPart, options: SessionOptions) {
  const key = options.storageKey ?? '';

  const state = (() => {
    // The app shows the sample until storage, a file or an example replaces it.
    const [doc, setDoc] = createStore<Diagram>(
      options.storageKey ? loadSample(DEFAULT_SAMPLE) : emptyDiagram(),
    );
    const [undoStack, setUndoStack] = createSignal<HistoryEntry[]>([]);
    const [redoStack, setRedoStack] = createSignal<HistoryEntry[]>([]);
    const [selection, setSelectionSignal] = createSignal<ReadonlySet<string>>(new Set(), {
      equals: false,
    });
    const [saveStatus, setSaveStatus] = createSignal<SaveStatus>('saved');
    const [revision, setRevision] = createSignal(0);
    return {
      doc,
      setDoc,
      undoStack,
      setUndoStack,
      redoStack,
      setRedoStack,
      selection,
      setSelectionSignal,
      saveStatus,
      setSaveStatus,
      revision,
      setRevision,
    };
  })();

  const doc = state.doc;
  const setDoc = state.setDoc;
  const saveStatus = state.saveStatus;
  const undoStack = state.undoStack;
  const redoStack = state.redoStack;
  /** Increments whenever the committed document is replaced or edited. */
  const revision = state.revision;

  /** A plain (non-reactive) copy of the current document. */
  const snapshotDoc = (): Diagram => JSON.parse(snapshot());
  const snapshot = () => JSON.stringify(unwrap(state.doc));

  // --- Selection -------------------------------------------------------------------------------

  const selection = state.selection;
  const selectedIds = () => [...state.selection()];
  const isSelected = (id: string) => state.selection().has(id);
  /** The only selected id, when exactly one object is selected. */
  const singleSelection = () => {
    const s = state.selection();
    return s.size === 1 ? [...s][0] : undefined;
  };

  function setSelection(ids: Iterable<string>) {
    s.setSelectedText(null);
    state.setSelectionSignal(new Set([...ids].filter(id => findEntity(state.doc, id))));
  }

  function selectItems(ids: string[], { add = false, toggle = false } = {}) {
    s.setSelectedText(null);
    const next = new Set<string>(add ? state.selection() : []);
    for (const id of ids) {
      if (!findEntity(state.doc, id)) continue;
      if (toggle && next.has(id)) next.delete(id);
      else next.add(id);
    }
    state.setSelectionSignal(next);
  }

  const clearSelection = () =>
    batch(() => {
      s.setSelectedText(null);
      state.setSelectionSignal(new Set<string>());
    });

  /** Select a title, note, legend row or phase label (a text id) in place of any objects. */
  const selectText = (id: string) =>
    batch(() => {
      state.setSelectionSignal(new Set<string>());
      s.setSelectedText(id);
    });

  // --- Edits and history -----------------------------------------------------------------------

  const beforeEditHandlers: Array<() => void> = [];
  const sourceIdHandlers: Array<(mapId: (id: string) => string) => void> = [];

  /**
   * Register work that must finish before any edit: close a timeline, accept a layout
   * preview, commit an inline label, or end a drag.
   */
  function onBeforeEdit(handler: () => void) {
    beforeEditHandlers.push(handler);
  }

  function prepareForEdit() {
    for (const handler of beforeEditHandlers) handler();
  }

  /** Keep active editor state aligned when a file edit assigns source ids to new objects. */
  function onSourceIdMap(handler: (mapId: (id: string) => string) => void) {
    sourceIdHandlers.push(handler);
  }

  function mapSourceIds(mapId: (id: string) => string) {
    for (const handler of sourceIdHandlers) handler(mapId);
  }
  let commitHandler: CommitHandler | null = null;
  const setCommitHandler = (handler: CommitHandler | null) => (commitHandler = handler);
  /** Edits are written to a diagram file rather than kept as browser snapshots. */
  const editsGoToFile = () => commitHandler !== null;

  /** Push an undo step if the document changed since `before`. Returns whether it did. */
  function commit(before: string, label = 'Edit', kind: EditKind = 'edit'): boolean {
    if (before === snapshot()) return false;
    if (commitHandler) return commitHandler(before, label, kind);
    pushUndo({ data: before, label });
    return true;
  }

  function pushUndo(entry: HistoryEntry) {
    batch(() => {
      state.setUndoStack(stack => [...stack, entry].slice(-HISTORY_LIMIT));
      state.setRedoStack([]);
      state.setRevision(r => r + 1);
    });
    persist();
  }

  /** Attach brush-hold changes to the most recent undo step. */
  function annotateLastUndo(holds: HistoryEntry['holds']) {
    state.setUndoStack(stack => {
      if (!stack.length) return stack;
      const next = [...stack];
      next[next.length - 1] = { ...next[next.length - 1], holds };
      return next;
    });
  }

  /** Run `fn` against the document as one undoable step. */
  function transact(label: string, fn: (draft: Diagram) => void, kind: EditKind = 'edit'): boolean {
    prepareForEdit();
    const before = snapshot();
    state.setDoc(produce(fn));
    return commit(before, label, kind);
  }

  /** Change the document without recording history, e.g. layout settings. */
  function mutate(fn: (draft: Diagram) => void) {
    state.setDoc(produce(fn));
    persist();
  }

  /** Replace the document while keeping the current camera. */
  function restoreDocument(next: Diagram, { keepCamera = true } = {}) {
    const camera = { ...state.doc.camera };
    batch(() => {
      state.setDoc(reconcile(next));
      if (keepCamera) state.setDoc('camera', camera);
      state.setRevision(r => r + 1);
    });
    // Undo, a cancelled gesture and a restore from storage bring their own camera back.
    const c = state.doc.camera;
    if (c.x !== camera.x || c.y !== camera.y || c.k !== camera.k)
      options.onCamera?.({ camera: { ...c }, reason: 'user' });
  }

  const historyHandlers: Array<(entry: HistoryEntry, direction: 'undo' | 'redo') => void> = [];
  function onHistoryStep(handler: (entry: HistoryEntry, direction: 'undo' | 'redo') => void) {
    historyHandlers.push(handler);
  }

  function step(direction: 'undo' | 'redo') {
    const from = direction === 'undo' ? state.undoStack() : state.redoStack();
    const entry = from.at(-1);
    if (!entry) return;
    const inverse: HistoryEntry = { ...entry, data: snapshot() };
    batch(() => {
      if (direction === 'undo') {
        state.setUndoStack(s => s.slice(0, -1));
        state.setRedoStack(s => [...s, inverse]);
      } else {
        state.setRedoStack(s => s.slice(0, -1));
        state.setUndoStack(s => [...s, inverse]);
      }
      for (const handler of historyHandlers) handler(entry, direction);
      // Undo restores the view along with the diagram, so the restored change is on screen.
      restoreDocument(normalize(JSON.parse(entry.data)), { keepCamera: false });
      clearSelection();
    });
    persist();
    toast((direction === 'undo' ? 'Undid ' : 'Redid ') + entry.label.toLowerCase());
  }
  let historyHandler: HistoryHandler | null = null;
  const setHistoryHandler = (handler: HistoryHandler | null) => (historyHandler = handler);

  const undo = () => (historyHandler ? historyHandler.undo() : step('undo'));
  const redo = () => (historyHandler ? historyHandler.redo() : step('redo'));
  const canUndo = () => (historyHandler ? historyHandler.canUndo() : state.undoStack().length > 0);
  const canRedo = () => (historyHandler ? historyHandler.canRedo() : state.redoStack().length > 0);

  // --- Camera ----------------------------------------------------------------------------------

  /**
   * Move the camera, and report it to `SessionOptions.onCamera` with `reason`. A host calling
   * this gets `api`; the editor's own moves (gestures, zoom, its fits) pass `user`. A camera
   * that is already where it was reports nothing.
   */
  function setCamera(camera: Camera, reason: CameraReason = 'api') {
    const c = state.doc.camera;
    if (c.x === camera.x && c.y === camera.y && c.k === camera.k) return;
    state.setDoc('camera', camera);
    persist();
    options.onCamera?.({ camera: { ...camera }, reason });
  }

  // --- Persistence -----------------------------------------------------------------------------

  let saveTimer: number | undefined;
  let persistenceBlocked = false;
  /** A diagram file is the source of truth; browser storage must never replace it. */
  let storageDisabled = !key;
  const disableBrowserStorage = () => (storageDisabled = true);

  /** Pause saving while a layout preview is showing unaccepted geometry. */
  function setPersistenceBlocked(blocked: boolean) {
    persistenceBlocked = blocked;
    window.clearTimeout(saveTimer);
    state.setSaveStatus(blocked ? 'preview' : 'saved');
  }

  function persist() {
    if (persistenceBlocked || storageDisabled) return;
    state.setSaveStatus('saving');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (persistenceBlocked) return;
      if (writeStorage()) state.setSaveStatus('saved');
      else {
        state.setSaveStatus('failed');
        toast('Device storage is unavailable or full. Export JSON to keep your work.');
      }
    }, 150);
  }

  function writeStorage() {
    try {
      localStorage.setItem(key, snapshot());
      return true;
    } catch (error) {
      console.warn('[diagram-studio] persistence failed', error);
      return false;
    }
  }

  function persistNow() {
    if (persistenceBlocked || storageDisabled) return;
    window.clearTimeout(saveTimer);
    writeStorage();
  }

  /** Load the saved diagram. Returns whether one was restored and any notice for the user. */
  function restoreSavedDocument(): { restored: boolean; notice?: string } {
    if (storageDisabled) return { restored: false };
    let stored: string | null;
    try {
      stored =
        [key, ...(key === STORAGE_KEY ? LEGACY_KEYS : [])]
          .map(k => localStorage.getItem(k))
          .find(Boolean) ?? null;
    } catch {
      return {
        restored: false,
        notice: 'Browser storage is unavailable. Save a diagram file to keep edits.',
      };
    }
    if (!stored) return { restored: false };
    try {
      restoreDocument(normalize(JSON.parse(stored)), { keepCamera: false });
      return { restored: true };
    } catch (error) {
      console.warn('[diagram-studio] recovery', error);
      try {
        localStorage.setItem(key + '-recovery', stored);
      } catch {
        // Nothing more can be kept.
      }
      return {
        restored: false,
        notice: 'The saved file could not be read. A recovery copy was kept.',
      };
    }
  }

  /** Warn when another tab saves the same storage key. */
  function watchOtherTabs() {
    if (storageDisabled) return () => {};
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue && e.newValue !== snapshot())
        toast('Another tab saved this diagram. Save a copy before reloading.');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }
  return {
    options,
    doc,
    setDoc,
    saveStatus,
    undoStack,
    redoStack,
    revision,
    snapshotDoc,
    snapshot,
    selection,
    selectedIds,
    isSelected,
    singleSelection,
    setSelection,
    selectItems,
    clearSelection,
    selectText,
    onBeforeEdit,
    prepareForEdit,
    onSourceIdMap,
    mapSourceIds,
    setCommitHandler,
    editsGoToFile,
    commit,
    pushUndo,
    annotateLastUndo,
    transact,
    mutate,
    restoreDocument,
    onHistoryStep,
    setHistoryHandler,
    undo,
    redo,
    canUndo,
    canRedo,
    setCamera,
    disableBrowserStorage,
    setPersistenceBlocked,
    persist,
    persistNow,
    restoreSavedDocument,
    watchOtherTabs,
  };
}

export type DocumentPart = ReturnType<typeof createDocument>;
