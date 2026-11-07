/**
 * One diagram being edited: its document, selection, undo history, camera, scene, layout and
 * gestures. A page can hold any number of sessions; each canvas draws one.
 *
 * Each part is built in dependency order on the same object, so a part reads the parts before it
 * through `s`. Parts that need a later one register a handler instead (`setDocumentOpener`, …).
 */
import { createRoot } from 'solid-js';
import { createActions } from './actions';
import { createCamera, type CameraEvent } from './camera';
import { createCanvasText } from './canvas-text';
import { createDocument } from './document';
import { createEditor } from './editor';
import { createEmphasis } from './emphasis';
import { createFileSession } from './file-session';
import { createLayout } from './layout';
import { createPointer } from './pointer';
import { createRouting } from './routing';
import { createScene } from './scene';
import { createSculpt } from './sculpt';

export type { CameraEvent, CameraReason, FitOptions, RevealOptions } from './camera';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export interface SessionOptions {
  /** Keep the diagram (and its last layout timeline) in browser storage under this key. */
  storageKey?: string;
  /** Read and write the shown emphasis state in the page URL (`?state=`). */
  urlState?: boolean;
  /** Ask before an action that replaces the diagram. Without it the action goes ahead. */
  confirm?: (request: ConfirmRequest) => void;
  /** Open an object's link. Without it a URL opens in a new tab and other links do nothing. */
  openLink?: (href: string) => void;
  /** The user started a gesture or a tool on the canvas; a host closes its menus here. */
  onInteract?: () => void;
  /**
   * The camera moved. `reason` is `api` when the host moved it (`setCamera`, `fitTo`, `reveal`)
   * and `user` for everything else, the editor's own fits included. A call that leaves the camera
   * where it was reports nothing.
   */
  onCamera?: (event: CameraEvent) => void;
}

export function createDiagramSession(options: SessionOptions = {}) {
  return createRoot(dispose => {
    const s0 = Object.assign({ dispose }, createCanvasText());
    const s1 = Object.assign(s0, createDocument(s0, options));
    const s2 = Object.assign(s1, createFileSession(s1));
    const s3 = Object.assign(s2, createScene(s2));
    const s4 = Object.assign(s3, createEmphasis(s3));
    const s5 = Object.assign(s4, createEditor(s4));
    const s6 = Object.assign(s5, createLayout(s5));
    const s7 = Object.assign(s6, createActions(s6));
    const s8 = Object.assign(s7, createRouting(s7));
    const s9 = Object.assign(s8, createSculpt(s8));
    const s10 = Object.assign(s9, createCamera(s9));
    return Object.assign(s10, createPointer(s10));
  });
}

export type DiagramSession = ReturnType<typeof createDiagramSession>;
