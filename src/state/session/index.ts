/**
 * One diagram being edited: its document, selection, undo history, camera, scene, layout and
 * gestures. A page can hold any number of sessions; each canvas draws one.
 *
 * Each part is built in dependency order on the same object, so a part reads the parts before it
 * through `s`. Parts that need a later one register a handler instead (`setDocumentOpener`, …).
 */
import { createRoot } from 'solid-js';
import type { AppearanceLayer } from '../../model/appearance';
import { describeLink } from '../links';
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
import { createView, type ViewItem } from './view';

export type { ViewItem, ViewItemKind } from './view';

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
   * Take no edit: no drags, resizes, connections, inline text or edit shortcuts. The user can
   * still pan, zoom and select, and a double click or Enter activates (`onActivate`).
   * `setReadOnly` changes it later.
   */
  readOnly?: boolean;
  /**
   * The selection changed, by the user or because selected objects left the drawing. A
   * selection the host set with `showSelection` is not reported back.
   */
  onSelect?: (items: ViewItem[]) => void;
  /** The pointer moved onto an object, or off every object (null). */
  onHover?: (item: ViewItem | null) => void;
  /** In a read-only session, the user opened an object: a double click, or Enter on it. */
  onActivate?: (item: ViewItem) => void;
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
    const s10 = Object.assign(s9, createView(s9));
    const s11 = Object.assign(s10, createPointer(s10));
    // Asked by the scene's link marks, which reach the session only through context.
    return Object.assign(s11, {
      /** What opening `href` does, for a link mark's label. */
      describeLink: (href: string): string => describeLink(s11 as DiagramSession, href),
    });
  });
}

export type DiagramSession = ReturnType<typeof createDiagramSession>;
