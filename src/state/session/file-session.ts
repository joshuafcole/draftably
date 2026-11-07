/**
 * A `.draft` file opened through `pnpm draftably open` (or `DIAGRAM_ROOT=… pnpm dev`), or an example
 * opened as a scratch copy.
 *
 * The file on disk is the source of truth. Each valid revision is compiled and projected into the
 * editor document; browser storage is switched off. An invalid revision keeps the last valid
 * drawing on screen and reports the error line.
 *
 * Committed viewer edits are translated into source statements (`dsl/translate.ts`), shown, and
 * saved with the revision they were based on. Undo and redo step through source versions. If the
 * file changes on disk while an edit is unsaved, the edit is kept aside and the file is shown;
 * the user then keeps the file or explicitly saves the edit over it.
 *
 * An example works the same way, except that nothing is sent to disk: its edits live in browser
 * storage until the user saves the example as a new file.
 */
import { batch, createSignal } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { checkSource, compile, type Diagnostic, type Scene } from '../../dsl/compile';
import { projectScene } from '../../dsl/project';
import { DslError, printSource, readSource } from '../../dsl/syntax';
import {
  anchorSurroundings,
  type Drop,
  keepDropped,
  movedOutsideEdit,
  reflowGroup,
  translateEdit,
  UnsupportedEdit,
} from '../../dsl/translate';
import { sourceOperations, type SourceOperation } from '../../dsl/operations';
import {
  setLayoutRecipe,
  setLayoutShape,
  type ShapeChange,
  setRouting,
  UnstorableLayout,
  writeArrangement,
} from '../../dsl/layout-edits';
import type { RoutingResult } from '../../engines/routing-engine.js';
import { runShared } from '../../lib/engine-tasks';
import { cacheScene, cachedScene } from '../../lib/scene-cache';
import { normalize, routingFingerprint } from '../../model/document';
import type { Diagram, LayoutSettings, RoutingSettings } from '../../model/types';
import { clone } from '../../model/geometry';
import { type EditKind } from './document';
import { toast, type ToastAction } from '../toast';
import type { DocumentPart } from './document';
import type { CanvasTextPart } from './canvas-text';

/**
 * Where a host has placed a drawing: each object's rectangle by id, and the routes to draw as they
 * are. Objects it leaves out keep the compile's place. The routes must be the host's for exactly
 * these places (`makeRoom`, `relaxRoom`).
 */
export interface HostArrangement {
  nodes: Readonly<Record<string, { x: number; y: number; w: number; h: number }>>;
  routes: RoutingResult;
}

/** Put a projected document's objects where the arrangement says. */
function arrange(doc: Diagram, arrangement: HostArrangement) {
  for (const [id, r] of Object.entries(arrangement.nodes)) {
    const at = doc.layout.nodes[id];
    if (at) doc.layout.nodes[id] = { ...at, x: r.x, y: r.y, w: r.w, h: r.h };
  }
}

export interface FileSessionInfo {
  name: string;
  path: string;
  source: string;
  revision: string;
  /** Where the file's relative links start (files only). */
  root?: string;
  /** Set for an example: its id. The source is never written to disk. */
  example?: string;
  /** The file's path relative to the served folder (files only). */
  file?: string;
}

/**
 * One kept edit, for a host that stores the diagram itself (`SessionOptions.onEdit`): the source
 * before and after it, and the statements it changed.
 */
export interface SessionEdit {
  /** What the edit was, as the editor names it: `Move objects`, `Add connection`, … */
  label: string;
  /** The source the edit was made on. */
  previous: string;
  /** The source with the edit. */
  source: string;
  /** The statements the edit added, removed and changed (`dsl/operations.ts`). */
  operations: SourceOperation[];
  /** Short descriptions of what was saved, such as `anchored 4 nearby`. */
  notes: string[];
  /** Editor ids of new objects and connections, mapped to their ids in the source. */
  ids: Record<string, string>;
  /**
   * The edit completes the one before it rather than being a step of its own: a drop kept at its
   * exact point, or more text typed in the same focus of the Source panel. A host that keeps
   * history folds it into the previous step.
   */
  amends: boolean;
}

export type FileStatus = 'saved' | 'saving' | 'invalid' | 'conflict' | 'failed' | 'offline';

interface SourceStep {
  before: string;
  after: string;
  label: string;
  /** Set for text typed in the Source panel: one focus of the panel undoes as one step. */
  burst?: number;
}
/** The id of the blank draft that New opens: a scratch copy with no example behind it. */
export const DRAFT_ID = 'untitled';

type Routes = { fingerprint: string; result: RoutingResult };
interface Compiled {
  scene: Scene;
  /** Routes drawn off the main thread, for the document `fingerprint` describes, or on their way. */
  routes?: Routes | Promise<Routes | undefined>;
}

/** The source scope a layout scope maps to: `root`, a group, or null for a loose selection. */
export function sourceScope(scope: { scope: string; containerId?: string }): string | null {
  if (scope.scope === 'all') return 'root';
  if (scope.scope === 'container' && scope.containerId) return scope.containerId;
  return null;
}
export { UnstorableLayout };

// --- Scratch edits ----------------------------------------------------------------------------

/** Unsaved example edits by key: `example:<id>`, or the `#s=` data of a shared diagram. */
const SCRATCH_STORE = 'draftably.scratch';

function readScratch(): Record<string, { source: string; at: number }> {
  try {
    return JSON.parse(localStorage.getItem(SCRATCH_STORE) ?? '{}');
  } catch {
    return {};
  }
}

export function createFileSession(s: DocumentPart & CanvasTextPart) {
  const state = (() => {
    const [info, setInfo] = createSignal<FileSessionInfo | null>(null);
    const [status, setStatus] = createSignal<FileStatus>('saved');
    const [sourceError, setSourceError] = createSignal<{ message: string; line: number } | null>(
      null,
    );
    const [scene, setScene] = createSignal<Scene | null>(null);
    /** An edit that could not be saved because the file changed first. */
    const [proposal, setProposal] = createSignal<string | null>(null);
    const [undoStack, setUndoStack] = createSignal<SourceStep[]>([]);
    const [redoStack, setRedoStack] = createSignal<SourceStep[]>([]);
    /** Objects outside the last external change that moved anyway. */
    const [movedByChange, setMovedByChange] = createSignal<string[]>([]);
    /** A revision is being laid out; layout engines run asynchronously. */
    const [compiling, setCompiling] = createSignal(false);
    /** The open example came back with unsaved edits from an earlier visit. */
    const [restored, setRestored] = createSignal(false);
    return {
      restored,
      setRestored,
      compiling,
      setCompiling,
      movedByChange,
      setMovedByChange,
      info,
      setInfo,
      status,
      setStatus,
      sourceError,
      setSourceError,
      scene,
      setScene,
      proposal,
      setProposal,
      undoStack,
      setUndoStack,
      redoStack,
      setRedoStack,
    };
  })();

  /** The open file or example, or null when the editor works on browser storage as usual. */
  const fileSession = state.info;
  const fileMode = () => !!state.info();
  /** True while an example is open: edits are kept in this browser only. */
  const exampleMode = () => !!state.info()?.example;
  /** What a scratch copy is called on screen. */
  const scratchName = () => (state.info()?.example === DRAFT_ID ? 'Draft' : 'Example');
  /** The example has edits that are not in any file. */
  const exampleEdited = () => exampleMode() && state.undoStack().length > 0;
  /** The user already agreed to leave the page, so the browser need not ask again. */
  let leaving = false;
  const leaveAgreed = () => leaving;
  const agreeToLeave = () => void (leaving = true);
  const fileStatus = state.status;
  const sourceError = state.sourceError;
  const fileScene = state.scene;
  const fileDiagnostics = (): Diagnostic[] => state.scene()?.diagnostics ?? [];
  const conflictProposal = state.proposal;
  const movedByChange = state.movedByChange;
  const fileCompiling = state.compiling;
  /** The open example's unsaved edits were restored from browser storage. */
  const exampleRestored = () => exampleMode() && state.restored();

  /** The last source confirmed on disk and its revision. */
  let diskSource = '',
    diskRevision = '';
  /** Selects this file's session on the server: `?file=…`. */
  let fileQuery = '';
  /** What an edit is called once it is kept: saved to disk, or only in the example. */
  const keptLabel = () => (exampleMode() ? `${scratchName()} only` : 'Saved');
  /** The source the viewer shows; it differs from `diskSource` while a save is pending. */
  let localSource = '';
  /**
   * Source ids given to new objects whose saved version is not drawn yet. An edit made in that
   * window still names the editor's temporary id, so it is translated through these first.
   */
  const pendingIds = new Map<string, string>();
  /** An edit made while the file was compiling, saved once the compile finishes. */
  let queued: { before: string; after: string; label: string } | null = null;
  const flushQueued = () => {
    const edit = queued;
    queued = null;
    if (edit) handleEdit(edit.before, edit.label, 'edit', edit.after);
  };
  const renamePending = <T>(value: T): T =>
    pendingIds.size
      ? JSON.parse(JSON.stringify(value), function (key, v) {
          if (pendingIds.has(key) && this && typeof this === 'object' && !Array.isArray(this)) {
            this[pendingIds.get(key)!] = v;
            return undefined;
          }
          return typeof v === 'string' ? (pendingIds.get(v) ?? v) : v;
        })
      : value;
  const currentSource = () => localSource;
  /** `currentSource` as a signal, for views that follow the text as edits rewrite it. */
  const [liveSource, setLiveSource] = createSignal('');
  function setLocal(source: string) {
    localSource = source;
    setLiveSource(source);
  }
  /** Text typed in the Source panel that is not the shown source yet: pending, or invalid. */
  const [sourceDraft, setDraft] = createSignal<string | null>(null);

  /** Editor state that is not in the file and survives each reprojection. */
  const viewState = () => {
    const current = unwrap(s.doc);
    return {
      settings: clone(current.settings),
      camera: { ...current.camera },
      theme: current.theme,
      collapsed: [...current.collapsed],
    };
  };

  let showing = 0;

  /** How a redrawn file reaches the scene's routes; `scene.ts` registers it (it imports this module). */
  let routeSink: {
    adopt: (routes: { fingerprint: string; result: RoutingResult }) => void;
    quick: (on: boolean) => void;
    /** A shown revision's full routes are still on their way from the worker. */
    awaiting: (on: boolean) => void;
  } = { adopt: () => {}, quick: () => {}, awaiting: () => {} };
  const setRouteSink = (sink: typeof routeSink) => (routeSink = sink);

  /** Recently compiled sources. A preview and the commit that follows compile the same source. */
  const compiled = new Map<string, Promise<Compiled>>();
  function compileCached(source: string): Promise<Compiled> {
    let scene = compiled.get(source);
    if (!scene) {
      scene = compileOffThread(source);
      compiled.set(source, scene);
      scene.catch(() => compiled.delete(source));
      while (compiled.size > 16) compiled.delete(compiled.keys().next().value!);
    }
    return scene;
  }

  /**
   * Layout and routing run in the engine worker while the drawing stays responsive. Layout takes
   * milliseconds and routing seconds on a large file, so the scene comes back first and is drawn
   * with quick routes; its full routes follow. A source the worker refuses is compiled here again,
   * which reports the error with its line.
   */
  async function compileOffThread(source: string): Promise<Compiled> {
    // Opened before, by this build: the routes stand if this view projects the same document.
    const kept = await cachedScene<{ scene: Scene; routes: Routes }>(source);
    if (kept) return kept;
    const view = viewState();
    let scene: Scene;
    try {
      scene = await runShared({ kind: 'compile', source });
    } catch {
      return { scene: await compile(source) };
    }
    const routes = runShared({ kind: 'scene', source, view }).then(
      ({ fingerprint, routing }) => {
        const routes = { fingerprint, result: routing };
        void cacheScene(source, { scene, routes });
        return routes;
      },
      () => undefined,
    );
    return { scene, routes };
  }

  /**
   * Compile `source` and show it. Resolves to the scene, or null when the source is invalid or a
   * newer call superseded this one.
   */
  async function showSource(
    source: string,
    selection: string[] | (() => string[]) = s.selectedIds(),
    mapId: (id: string) => string = id => id,
    arrangement?: HostArrangement,
  ): Promise<Scene | null> {
    const ticket = ++showing;
    state.setCompiling(true);
    let scene: Scene, routes: Compiled['routes'];
    try {
      ({ scene, routes } = await compileCached(source));
    } catch (error) {
      if (ticket !== showing) return null;
      state.setCompiling(false);
      routeSink.quick(false);
      if (!(error instanceof DslError)) throw error;
      batch(() => {
        state.setSourceError({ message: error.message, line: error.line });
        state.setStatus('invalid');
      });
      flushQueued();
      return null;
    }
    if (ticket !== showing) return null;
    // The worker's routes stand only if it projected the same document; otherwise the scene routes it.
    const adopt = (r: Routes | undefined) => {
      if (r?.fingerprint === routingFingerprint(unwrap(s.doc))) routeSink.adopt(r);
    };
    const pending = routes instanceof Promise ? routes : null;
    if (pending)
      void pending.then(r => {
        if (ticket !== showing) return;
        batch(() => {
          if (!arrangement) adopt(r);
          routeSink.awaiting(false);
        });
      });
    batch(() => {
      s.mapSourceIds(mapId);
      const projected = projectScene(scene, viewState());
      if (arrangement) arrange(projected, arrangement);
      s.restoreDocument(projected, { keepCamera: true });
      // A host's arrangement brings its own routes; the compile's are for the compile's layout.
      if (arrangement)
        routeSink.adopt({
          fingerprint: routingFingerprint(unwrap(s.doc)),
          result: clone(arrangement.routes),
        });
      else if (!pending) adopt(routes as Routes | undefined);
      routeSink.awaiting(!!pending && !arrangement);
      // A drag in a file keeps quick routes until its saved version is drawn.
      routeSink.quick(false);
      // Selected text (a note, a legend row) stays selected across its own save.
      if (!s.selectedText())
        s.setSelection(typeof selection === 'function' ? selection() : selection);
      state.setScene(scene);
      state.setSourceError(null);
      state.setCompiling(false);
    });
    flushQueued();
    return scene;
  }

  function resetHistory() {
    state.setUndoStack([]);
    state.setRedoStack([]);
  }

  /** Show a newer file from disk. Local history cannot undo past someone else's change. */
  async function acceptDisk(
    source: string,
    revision: string,
    { announce = false, arrangement }: { announce?: boolean; arrangement?: HostArrangement } = {},
  ) {
    const previous = state.scene(),
      previousSource = localSource;
    diskSource = source;
    setLocal(source);
    diskRevision = revision;
    resetHistory();
    const scene = await showSource(source, undefined, undefined, arrangement);
    if (!scene) return;
    state.setStatus('saved');
    if (!announce) return;
    const moved = previous
      ? movedOutsideEdit(previous, scene, readSource(previousSource), readSource(source))
      : [];
    state.setMovedByChange(moved);
    const name = state.info()!.name;
    toast(
      moved.length
        ? `${name} changed on disk · also moved: ${moved.slice(0, 4).join(', ')}${moved.length > 4 ? '…' : ''}`
        : `${name} changed on disk.`,
    );
  }

  // --- Saving -----------------------------------------------------------------------------------

  let saving = false,
    saveAgain = false;
  /** Shown once the server confirms the save, so a refused save never reads as saved. */
  let savedMessage: string | null = null;
  /** A button on that message, such as keeping a drop's exact position. */
  let savedAction: ToastAction | undefined;
  /** A change on disk reported while a save was in flight. */
  let externalDuringSave: { source: string; revision: string } | null = null;

  async function save() {
    if (hostSave) {
      // A host owns the text: it receives every kept edit and stores it however it likes.
      diskSource = localSource;
      savedMessage = null;
      savedAction = undefined;
      state.setStatus('saved');
      hostSave(localSource);
      return;
    }
    if (exampleMode()) {
      // Examples keep their edits in browser storage; there is no file to write.
      keepScratch();
      if (savedMessage) toast(savedMessage, savedAction);
      savedMessage = null;
      savedAction = undefined;
      return;
    }
    if (saving) {
      saveAgain = true;
      return;
    }
    saving = true;
    state.setStatus('saving');
    try {
      for (;;) {
        saveAgain = false;
        const sending = localSource;
        const res = await fetch(`./api/source${fileQuery}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: sending, base: diskRevision }),
        });
        const body = await res.json();
        if (res.status === 409) {
          enterConflict(body.source, body.revision);
          return;
        }
        if (!res.ok) {
          state.setStatus('failed');
          toast(`Not saved: ${body.error ?? res.statusText}`);
          return;
        }
        diskSource = sending;
        diskRevision = body.revision;
        if (!saveAgain) break;
      }
      state.setStatus('saved');
      if (savedMessage) toast(savedMessage, savedAction);
      savedMessage = null;
      savedAction = undefined;
    } catch {
      state.setStatus('failed');
      toast('Not saved: the file server is not reachable.');
    } finally {
      saving = false;
      const external = externalDuringSave;
      externalDuringSave = null;
      // The file was replaced after this save landed; show the newer version.
      if (external && external.revision !== diskRevision && state.status() === 'saved')
        void acceptDisk(external.source, external.revision, { announce: true });
    }
  }

  /** Keep the unsaved edit aside and show the newer file. */
  function enterConflict(source: string, revision: string) {
    const unsaved = localSource;
    savedMessage = null;
    savedAction = undefined;
    diskSource = source;
    setLocal(source);
    diskRevision = revision;
    resetHistory();
    batch(() => {
      state.setProposal(unsaved);
      void showSource(source);
      state.setStatus('conflict');
    });
  }

  /** Discard the edit that could not be saved and keep the file as it is on disk. */
  function keepDiskVersion() {
    batch(() => {
      state.setProposal(null);
      state.setStatus(state.sourceError() ? 'invalid' : 'saved');
    });
  }

  /** Save the edit that could not be saved, replacing the newer file. */
  function saveProposalOverDisk() {
    const proposal = state.proposal();
    if (!proposal) return;
    state.setProposal(null);
    setLocal(proposal);
    void showSource(proposal);
    void save();
  }

  /** Try the last failed save again. */
  const retrySave = () => void save();

  let typing = 0;

  /**
   * Show and save text typed in the Source panel. A valid text is drawn, recorded and saved as is;
   * an invalid one keeps the last valid drawing and reports its line. Texts typed in one `burst`
   * (one focus of the panel) undo as one step.
   */
  async function typeSource(next: string, burst: number) {
    const ticket = ++typing;
    setDraft(next);
    if (state.proposal()) return;
    if (next === localSource) {
      // Typed back to the shown source: drop the error the draft reported.
      if (!state.sourceError()) return setDraft(null);
      if ((await showSource(next)) && ticket === typing) {
        setDraft(null);
        if (state.status() === 'invalid') state.setStatus('saved');
      }
      return;
    }
    const scene = await showSource(next);
    if (!scene || ticket !== typing) return;
    const top = state.undoStack().at(-1);
    batch(() => {
      if (top?.burst !== burst)
        state.setUndoStack(stack =>
          [...stack, { before: localSource, after: next, label: 'Edit source', burst }].slice(-80),
        );
      else if (top.before === next) state.setUndoStack(stack => stack.slice(0, -1));
      else state.setUndoStack(stack => [...stack.slice(0, -1), { ...top, after: next }]);
      state.setRedoStack([]);
      announce(localSource, next, 'Edit source', { amends: top?.burst === burst });
      setLocal(next);
      setDraft(null);
      if (state.status() === 'invalid') state.setStatus('saved');
    });
    savedMessage = null;
    savedAction = undefined;
    void save();
  }

  // --- Edits and history ---------------------------------------------------------------------------

  /** Undo an edit the file cannot take by showing the source again, with a reason. */
  function snapBack(message: string) {
    void showSource(localSource);
    toast(message);
    s.options.onRefused?.(message);
    return false;
  }

  /** Tell the host about a kept edit (`SessionOptions.onEdit`). */
  function announce(
    previous: string,
    source: string,
    label: string,
    {
      operations,
      notes = [],
      ids = new Map<string, string>(),
      amends = false,
    }: {
      operations?: SourceOperation[];
      notes?: string[];
      ids?: Map<string, string>;
      amends?: boolean;
    } = {},
  ) {
    s.options.onEdit?.({
      label,
      previous,
      source,
      operations: operations ?? sourceOperations(readSource(previous), readSource(source)),
      notes,
      ids: Object.fromEntries(ids),
      amends,
    });
  }

  /** A drawing from a layout pass, timeline step or brush stroke, as positions in the source. */
  function arrangementEdit(scene: Scene, label: string) {
    const source = readSource(localSource),
      after = normalize(JSON.parse(JSON.stringify(unwrap(s.doc))));
    const placed = writeArrangement(source, scene, after),
      anchored = anchorSurroundings(source, scene, placed);
    const notes = placed.length
      ? [`${placed.length} positions` + (anchored.length ? ` · anchored ${anchored.length}` : '')]
      : [];
    return {
      source,
      ids: new Map<string, string>(),
      notes: [label, ...notes],
      drops: [] as Drop[],
      operations: sourceOperations(readSource(localSource), source),
    };
  }

  function handleEdit(
    before: string,
    label: string,
    kind: EditKind = 'edit',
    after = JSON.stringify(unwrap(s.doc)),
  ): boolean {
    if (state.sourceError()) return snapBack('Fix the error in the file before editing here.');
    if (state.proposal()) return snapBack('Keep the file or save your edit before editing again.');
    if (state.compiling()) {
      // A label typed right after adding a shape lands here; keep it rather than refuse it.
      if (kind === 'edit') {
        queued = { before: queued?.before ?? before, after, label };
        return true;
      }
      return snapBack('Still laying out the file. Try again in a moment.');
    }
    const scene = state.scene();
    if (!scene) return snapBack('The file has no valid drawing yet.');
    let result;
    try {
      result =
        kind === 'arrangement'
          ? arrangementEdit(scene, label)
          : translateEdit({
              source: readSource(localSource),
              scene,
              before: renamePending(normalize(JSON.parse(before))),
              after: renamePending(normalize(JSON.parse(after))),
              label,
              selection: renamePending(s.selectedIds()),
              drag: s.options.drag,
              newId: s.options.newId,
            });
    } catch (error) {
      if (error instanceof UnsupportedEdit) return snapBack(error.message);
      throw error;
    }
    const next = printSource(result.source);
    // Nothing the file stores changed (for example a move of an object that was not selected).
    if (next === localSource) return snapBack('That change is not saved to diagram files.');
    try {
      checkSource(next);
    } catch (error) {
      if (error instanceof DslError) return snapBack(`That edit cannot be saved. ${error.message}`);
      throw error;
    }
    batch(() => {
      state.setUndoStack(stack =>
        [...stack, { before: localSource, after: next, label }].slice(-80),
      );
      state.setRedoStack([]);
    });
    const previous = localSource;
    setLocal(next);
    announce(previous, next, label, {
      operations: result.operations,
      notes: result.notes,
      ids: result.ids,
    });
    for (const [id, sourceId] of result.ids) pendingIds.set(id, sourceId);
    const mapId = (id: string) => result.ids.get(id) ?? id,
      { drops } = result;
    void showSource(next, () => s.selectedIds().map(mapId), mapId).then(
      drawn => drawn && checkDrops(drawn, next, drops),
    );
    savedMessage = `${keptLabel()} · ${result.notes.length ? result.notes.join(' · ') : label}`;
    savedAction = drops.length
      ? { label: 'Keep exact position', run: () => void keepExact(drops) }
      : undefined;
    void save();
    return true;
  }

  /** The source with each dropped object at the exact point it was let go. */
  function exactSource(drops: Drop[]) {
    const source = readSource(localSource);
    keepDropped(source, drops);
    return printSource(source);
  }

  /** Save a `stay` where each dropped object was let go, in place of its `near`. */
  function keepExact(drops: Drop[]) {
    const ids = drops.map(d => d.id).join(', ');
    return commitSource(exactSource(drops), 'Keep exact position', `kept ${ids} where dropped`);
  }

  /**
   * A `near` that does not draw an object where it was dropped is not what the drop asked for:
   * save its exact position instead, as part of the same edit.
   */
  function checkDrops(scene: Scene, source: string, drops: Drop[]) {
    if (localSource !== source) return;
    const off = drops.filter(d => {
      const o = scene.byId.get(d.id);
      return !o || Math.abs(o.x - d.x) > 1 || Math.abs(o.y - d.y) > 1;
    });
    if (!off.length) return;
    const next = exactSource(off);
    state.setUndoStack(stack => [...stack.slice(0, -1), { ...stack.at(-1)!, after: next }]);
    setLocal(next);
    announce(source, next, 'Keep exact position', {
      notes: [`kept ${off.map(d => d.id).join(', ')} where dropped`],
      amends: true,
    });
    savedMessage = `${keptLabel()} · kept ${off.map(d => d.id).join(', ')} where dropped`;
    savedAction = undefined;
    void showSource(next);
    void save();
  }

  /**
   * Record and save a change made directly to the source, such as a reflow or a layout recipe.
   * `message` describes it after "Saved ·" (or "Example only ·"). Resolves once the new revision
   * is on screen; false when the source was refused.
   */
  async function commitSource(next: string, label: string, message: string) {
    if (next === localSource) {
      toast('Nothing to change.');
      return false;
    }
    try {
      checkSource(next);
    } catch (error) {
      if (error instanceof DslError) {
        toast(`That change cannot be saved. ${error.message}`);
        return false;
      }
      throw error;
    }
    batch(() => {
      state.setUndoStack(stack =>
        [...stack, { before: localSource, after: next, label }].slice(-80),
      );
      state.setRedoStack([]);
    });
    const previous = localSource;
    setLocal(next);
    announce(previous, next, label, { notes: [message] });
    savedMessage = `${keptLabel()} · ${message}`;
    savedAction = undefined;
    void save();
    await showSource(next);
    return true;
  }

  // --- Layout tools ------------------------------------------------------------------------------

  /** Why the file cannot take a layout change right now, or null when it can. */
  function fileBlocked(): string | null {
    if (state.sourceError()) return 'Fix the error in the file first.';
    if (state.proposal()) return 'Keep the file or save your edit first.';
    if (state.compiling()) return 'Still laying out the file. Try again in a moment.';
    if (!state.scene()) return 'The file has no valid drawing yet.';
    return null;
  }

  /**
   * The current source with `scope` arranged by the engine in `settings`. Throws
   * `UnstorableLayout` for an engine a file cannot name.
   */
  function sourceWithRecipe(scope: string, settings: LayoutSettings, direction?: 'right' | 'down') {
    const source = readSource(localSource),
      removed = setLayoutRecipe(source, state.scene()!, scope, settings, direction);
    return { source: printSource(source), removed };
  }

  /** The current source with a change to what a scope's `layout` line says. */
  function sourceWithShape(scope: string, change: ShapeChange) {
    const source = readSource(localSource),
      removed = setLayoutShape(source, state.scene()!, scope, change);
    return { source: printSource(source), removed };
  }

  /** The `layout` or `routing` line that `source` adds to the file, as saving it would write. */
  function changedLines(source: string) {
    const now = new Set(localSource.split('\n'));
    return source.split('\n').filter(l => /^(layout|routing)\b/.test(l) && !now.has(l));
  }

  const changedLine = (source: string) => changedLines(source)[0] ?? null;

  /** The current source with these router settings. */
  function sourceWithRouting(routing: RoutingSettings, base = localSource) {
    const source = readSource(base);
    setRouting(source, routing);
    return printSource(source);
  }

  /** Compile a source variant into an editor document, keeping the current view state. */
  async function projectSource(source: string): Promise<Diagram> {
    return projectScene((await compileCached(source)).scene, viewState());
  }

  /**
   * Let the automatic recipe arrange a group's contents again. Its soft refinements are removed,
   * pins stay, and the objects around it are anchored.
   */
  function reflowSelectedGroup(id: string) {
    const scene = state.scene();
    if (!scene || state.sourceError() || state.proposal())
      return toast('The file cannot be changed right now.');
    const source = readSource(localSource),
      count = reflowGroup(source, scene, id);
    void commitSource(printSource(source), 'Reflow group', `reflowed ${count} objects in ${id}`);
  }

  function historyStep(direction: 'undo' | 'redo') {
    if (state.proposal() || state.sourceError()) return;
    const from = direction === 'undo' ? state.undoStack : state.redoStack;
    const entry = from().at(-1);
    if (!entry) return;
    batch(() => {
      if (direction === 'undo') {
        state.setUndoStack(s => s.slice(0, -1));
        state.setRedoStack(s => [...s, entry]);
      } else {
        state.setRedoStack(s => s.slice(0, -1));
        state.setUndoStack(s => [...s, entry]);
      }
    });
    setLocal(direction === 'undo' ? entry.before : entry.after);
    void showSource(localSource);
    s.clearSelection();
    toast((direction === 'undo' ? 'Undid ' : 'Redid ') + entry.label.toLowerCase());
    void save();
  }

  // --- Session ---------------------------------------------------------------------------------

  /**
   * Ask the local server for the session of `file` (a path relative to the served folder).
   * Resolves false when the server has no such file.
   */
  async function openFileSession(file: string): Promise<boolean> {
    fileQuery = `?file=${encodeURIComponent(file)}`;
    let info: FileSessionInfo;
    try {
      const res = await fetch(`./api/session${fileQuery}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return false;
      info = { ...(await res.json()), file };
    } catch {
      return false;
    }
    document.title = `${file} · draftably`;
    await begin(info);
    listen();
    return true;
  }

  /**
   * Start compiling a served file before it is opened, such as while a link to it is hovered.
   * Opening it then finds the compiled scene ready, unless the file changed meanwhile.
   */
  async function prefetchFile(file: string) {
    try {
      const res = await fetch(`./api/session?file=${encodeURIComponent(file)}`);
      if (res.ok) void compileCached((await res.json()).source).catch(() => {});
    } catch {
      // Opening the file reports the problem.
    }
  }

  /** Wait for a save in flight, so leaving the file never drops an edit. */
  async function settleSave() {
    while (saving) await new Promise(resolve => setTimeout(resolve, 20));
  }

  /** Leave the open file for the start page: stop following it on disk. */
  function closeFileSession() {
    hostSave = null;
    stopListening();
    s.setCommitHandler(null);
    s.setHistoryHandler(null);
    state.setInfo(null);
  }

  /**
   * Open an example as a scratch copy. Nothing is read from or written to disk. Edits are kept in
   * browser storage under `key`, so a reload or a closed tab brings them back as unsaved edits.
   */
  async function openExampleSession(
    id: string,
    title: string,
    source: string,
    key = `example:${id}`,
  ) {
    document.title = `${id === DRAFT_ID ? title : `Example: ${title}`} · draftably`;
    scratchKey = key;
    const kept = readScratch()[key]?.source;
    const restored = kept != null && kept !== source;
    await begin({
      name: title,
      path: '',
      source: restored ? kept : source,
      revision: 'example',
      example: id,
    });
    exampleOriginal = source;
    if (!restored) return;
    state.setUndoStack([{ before: source, after: kept, label: 'Restore unsaved edits' }]);
    state.setRestored(true);
  }

  /** Set while a host owns the source (`openSource`): it receives each kept edit. */
  let hostSave: ((source: string) => void) | null = null;

  /**
   * Edit `source` for a host such as an embedded editor. Nothing is read from or written to disk;
   * `onChange` receives the new text after every kept edit, undo and redo.
   */
  function openSource(
    source: string,
    onChange: (source: string) => void = () => {},
    { arrangement }: { arrangement?: HostArrangement } = {},
  ) {
    hostSave = onChange;
    arranged = arrangement;
    return begin({ name: '', path: '', source, revision: 'host' }, arrangement);
  }

  /** The arrangement the shown source was drawn with, if a host gave one. */
  let arranged: HostArrangement | undefined;

  /**
   * Show text the host changed. Local undo history cannot step past it.
   *
   * With `arrangement`, the host places it: the source's objects are drawn where the arrangement
   * puts them and its routes are drawn as they are, instead of the compile's layout and routes
   * (`makeRoom` makes one). The same text with a new arrangement is drawn again.
   */
  function receiveSource(source: string, { arrangement }: { arrangement?: HostArrangement } = {}) {
    if (source === localSource && arrangement === arranged) return Promise.resolve();
    arranged = arrangement;
    return acceptDisk(source, `host:${source.length}:${Date.now()}`, { arrangement });
  }

  /** The source of the example as it was opened, for Reset. */
  let exampleOriginal = '';
  let scratchKey = '';

  /** Store the example's edits, or forget them once nothing is unsaved. Keeps the 10 newest. */
  function keepScratch() {
    if (!scratchKey) return;
    const all = readScratch();
    if (state.undoStack().length && localSource !== exampleOriginal)
      all[scratchKey] = { source: localSource, at: Date.now() };
    else delete all[scratchKey];
    const newest = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 10);
    try {
      localStorage.setItem(SCRATCH_STORE, JSON.stringify(Object.fromEntries(newest)));
    } catch {
      // Storage is full or blocked; the unload prompt still guards the edits.
    }
  }

  /** Throw away the example's edits and show it as it was opened. */
  function resetExample() {
    if (!exampleMode()) return;
    setLocal(exampleOriginal);
    resetHistory();
    keepScratch();
    state.setRestored(false);
    void showSource(localSource);
    s.clearSelection();
  }

  /** The example's edits now live in a file; leaving the page no longer loses them. */
  function markExampleSaved() {
    resetHistory();
    keepScratch();
  }

  function begin(info: FileSessionInfo, arrangement?: HostArrangement): Promise<void> {
    if (info.revision !== 'host') {
      hostSave = null;
      arranged = undefined;
    }
    stopListening();
    setDraft(null);
    if (!info.example) scratchKey = '';
    state.setRestored(false);
    exampleOriginal = info.example ? info.source : '';
    s.disableBrowserStorage();
    s.setCommitHandler(handleEdit);
    // A host that keeps the history itself answers undo and redo; `false` turns them off.
    const host = s.options.history;
    s.setHistoryHandler(
      host === false
        ? { undo() {}, redo() {}, canUndo: () => false, canRedo: () => false }
        : (host ?? {
            undo: () => historyStep('undo'),
            redo: () => historyStep('redo'),
            canUndo: () => state.undoStack().length > 0,
            canRedo: () => state.redoStack().length > 0,
          }),
    );
    state.setInfo(info);
    return acceptDisk(info.source, info.revision, { arrangement });
  }

  function onExternalChange(source: string, revision: string) {
    if (revision === diskRevision) return;
    if (saving) externalDuringSave = { source, revision };
    else if (localSource !== diskSource) enterConflict(source, revision);
    else void acceptDisk(source, revision, { announce: true });
  }

  let fileEvents: EventSource | null = null;

  function stopListening() {
    fileEvents?.close();
    fileEvents = null;
  }

  function resumeListening(event: PageTransitionEvent) {
    if (event.persisted && state.info()?.file) listen();
  }

  function listen() {
    stopListening();
    const query = fileQuery;
    const events = new EventSource(`./api/events${query}`);
    fileEvents = events;
    // Cached pages otherwise keep their HTTP/1 streams and exhaust the browser's connection pool.
    window.addEventListener('pagehide', stopListening);
    window.addEventListener('pageshow', resumeListening);
    events.addEventListener('source', event => {
      if (fileEvents !== events) return;
      const { source, revision } = JSON.parse((event as MessageEvent).data);
      onExternalChange(source, revision);
    });
    events.addEventListener('error', () => {
      if (fileEvents === events) state.setStatus('offline');
    });
    events.addEventListener('open', async () => {
      // Catch up on anything missed while disconnected.
      try {
        const info: FileSessionInfo = await (await fetch(`./api/session${query}`)).json();
        if (fileEvents !== events) return;
        if (info.revision !== diskRevision) onExternalChange(info.source, info.revision);
        else if (state.status() === 'offline')
          state.setStatus(state.sourceError() ? 'invalid' : 'saved');
      } catch {
        if (fileEvents === events) state.setStatus('offline');
      }
    });
  }

  /** Short text for the toolbar's save indicator. */
  function fileStatusText(): string {
    const info = state.info();
    if (info?.example) {
      const edits = state.undoStack().length;
      return edits
        ? `${scratchName()} · ${edits} unsaved edit${edits === 1 ? '' : 's'}`
        : `${scratchName()} · not on disk`;
    }
    const name = info?.file ?? info?.name ?? '';
    switch (state.status()) {
      case 'saving':
        return `${name} · Saving…`;
      case 'invalid':
        return `${name} · Source error`;
      case 'conflict':
        return `${name} · Changed on disk`;
      case 'failed':
        return `${name} · Not saved`;
      case 'offline':
        return `${name} · Disconnected`;
      default:
        return `${name} · Saved`;
    }
  }
  return {
    openSource,
    receiveSource,
    liveSource,
    sourceDraft,
    fileSession,
    fileMode,
    exampleMode,
    scratchName,
    exampleEdited,
    leaveAgreed,
    agreeToLeave,
    fileStatus,
    sourceError,
    fileScene,
    fileDiagnostics,
    conflictProposal,
    movedByChange,
    fileCompiling,
    exampleRestored,
    currentSource,
    setRouteSink,
    showSource,
    keepDiskVersion,
    saveProposalOverDisk,
    retrySave,
    typeSource,
    commitSource,
    fileBlocked,
    sourceWithRecipe,
    sourceWithShape,
    changedLines,
    changedLine,
    sourceWithRouting,
    projectSource,
    reflowSelectedGroup,
    openFileSession,
    prefetchFile,
    settleSave,
    closeFileSession,
    openExampleSession,
    resetExample,
    markExampleSaved,
    fileStatusText,
  };
}

export type FileSessionPart = ReturnType<typeof createFileSession>;
