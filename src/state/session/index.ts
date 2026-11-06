/**
 * One diagram being edited: its document, selection, undo history, camera, scene, layout and
 * gestures. A page can hold any number of sessions; each canvas draws one.
 *
 * Each part is built in dependency order on the same object, so a part reads the parts before it
 * through `s`. Parts that need a later one register a handler instead (`setDocumentOpener`, …).
 */
import { createRoot } from 'solid-js';
import type { AppearanceLayer } from '../../model/appearance';
import { createActions } from './actions';
import { createHostAppearance } from './appearance';
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
   * The host's paint over the diagram: canvas, text, lines, default surfaces and color shades,
   * and whether its canvas is dark. Separate from the editor's own light or dark mode, and never
   * written to the source. `setAppearance` changes it later.
   */
  appearance?: AppearanceLayer;
}

export function createDiagramSession(options: SessionOptions = {}) {
  return createRoot(dispose => {
    const s0 = Object.assign({ dispose }, createCanvasText());
    const s1 = Object.assign(s0, createDocument(s0, options));
    const s1a = Object.assign(s1, createHostAppearance(s1));
    const s2 = Object.assign(s1a, createFileSession(s1a));
    const s3 = Object.assign(s2, createScene(s2));
    const s4 = Object.assign(s3, createEmphasis(s3));
    const s5 = Object.assign(s4, createEditor(s4));
    const s6 = Object.assign(s5, createLayout(s5));
    const s7 = Object.assign(s6, createActions(s6));
    const s8 = Object.assign(s7, createRouting(s7));
    const s9 = Object.assign(s8, createSculpt(s8));
    return Object.assign(s9, createPointer(s9));
  });
}

export type DiagramSession = ReturnType<typeof createDiagramSession>;
