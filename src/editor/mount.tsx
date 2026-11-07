import { createEffect } from 'solid-js';
import { render } from 'solid-js/web';
import { registerFonts } from '../lib/font-data';
import { resolveAppearance } from '../model/appearance';
import { activeSession, setActiveSession } from '../state/active-session';
import { copyShapes, handleCanvasKey, handleKeyUp, pasteShapes } from '../state/canvas-keyboard';
import { createDiagramSession, type DiagramSession, type SessionOptions } from '../state/session';
import { Editor } from './Editor';
import '../styles/app.css';

export type { Camera } from '../model/types';
export type {
  CameraEvent,
  CameraReason,
  DiagramSession,
  FitOptions,
  RevealOptions,
} from '../state/session';

/**
 * Shortcuts act on the session the user last pointed at. Clicking a shape leaves focus on the
 * page, so they listen on the document, once for all editors, and skip keys meant for the host's
 * own controls.
 */
const forEditor =
  <E extends Event>(handle: (e: E) => unknown) =>
  (e: Event) => {
    const target = e.target as Element;
    if (target === document.body || target.closest?.('.draft-editor')) void handle(e as E);
  };
const KEYS: Array<[string, (e: Event) => void]> = [
  ['keydown', forEditor(handleCanvasKey)],
  ['keyup', forEditor(handleKeyUp)],
  ['copy', forEditor(copyShapes)],
  ['paste', forEditor(pasteShapes)],
];
let mounted = 0;

export interface MountOptions extends SessionOptions {
  /** The `.draft` text to edit. */
  source: string;
  /** Receives the new text after every kept edit, undo and redo. */
  onChange?: (source: string) => void;
}

export interface MountedEditor {
  /**
   * The editor's session. A host drives the camera through it: `getCamera()`, `setCamera()`,
   * `fitTo(ids)` and `reveal(id)`; `onCamera` hears every move.
   */
  session: DiagramSession;
  /** The text as the editor holds it now. */
  source(): string;
  /** Show text the host changed. Resolves once it is drawn. */
  update(source: string): Promise<void>;
  /** Remove the editor and stop its session. */
  destroy(): void;
}

/**
 * Edit one diagram inside `host`: the canvas with selection, dragging, inline editing and its
 * shortcuts. Each edit is written back to the source and reported through `onChange`. Give the
 * host a size; the canvas fills it.
 */
export function mountEditor(host: HTMLElement, options: MountOptions): MountedEditor {
  const { source, onChange, ...sessionOptions } = options;
  const session = createDiagramSession(sessionOptions);
  registerFonts();
  void session.openSource(source, onChange).then(() => requestAnimationFrame(session.fitView));
  try {
    activeSession();
  } catch {
    // The first editor on a page is active until another one is used.
    setActiveSession(session);
  }

  const dispose = render(() => {
    createEffect(() =>
      host.style.setProperty('--diagram-canvas', resolveAppearance(session.doc.appearance).canvas),
    );
    return <Editor session={session} />;
  }, host);
  host.classList.add('draft-editor');
  if (!mounted++) for (const [type, fn] of KEYS) document.addEventListener(type, fn);

  return {
    session,
    source: session.currentSource,
    update: async next => void (await session.receiveSource(next)),
    destroy() {
      if (!--mounted) for (const [type, fn] of KEYS) document.removeEventListener(type, fn);
      session.cancelLayout();
      session.closeFileSession();
      dispose();
      session.dispose();
      host.classList.remove('draft-editor');
    },
  };
}
