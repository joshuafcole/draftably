/**
 * One diagram being edited: its document, selection, undo history, camera, scene, layout and
 * gestures. A page can hold any number of sessions; each canvas draws one.
 *
 * Each part is built in dependency order on the same object, so a part reads the parts before it
 * through `s`. Parts that need a later one register a handler instead (`setDocumentOpener`, …).
 */
import { createRoot } from 'solid-js';
import type { AppearanceLayer } from '../../model/appearance';
import type { PanelSide } from '../../model/panels';
import { describeLink } from '../links';
import { createActions } from './actions';
import { createHostAppearance } from './appearance';
import { createCamera, type CameraMover } from './camera';
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
import type { Camera } from '../../model/types';
import type { DragTranslation, NewIdRequest } from '../../dsl/translate';
import type { HistoryHandler } from './document';
import type { SessionEdit } from './file-session';

export type { ViewItem, ViewItemKind } from './view';
export type { DragTranslation, NewIdRequest } from '../../dsl/translate';
export type { SourceOperation } from '../../dsl/operations';
export type { HistoryHandler } from './document';
export type { HostArrangement, SessionEdit } from './file-session';
export type { PanelSide } from '../../model/panels';
export { LEGIBLE_ZOOM, type CameraMover, type FitOptions, type RevealOptions } from './camera';

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
   * The camera moved: `by: 'host'` when the host moved it (`moveCamera`, `fitTo`, `reveal`),
   * `'user'` for everything else, the editor's own fits included. A call that leaves the camera
   * where it was reports nothing.
   */
  onCamera?: (camera: Camera, by: CameraMover) => void;
  /**
   * The host's paint over the diagram: canvas, text, lines, default surfaces and color shades,
   * and whether its canvas is dark. Separate from the editor's own light or dark mode, and never
   * written to the source. `setAppearance` changes it later.
   */
  appearance?: AppearanceLayer;
  /**
   * Draw one side of a marked document (`showPanel` changes it later): `before` without what was
   * added, `after` without what was removed, both on the merge's layout.
   */
  panel?: PanelSide;
  /**
   * Every kept edit of a source the host opened (`openSource`), with the statements it changed:
   * for a host that stores the diagram as its own records rather than as text. Called before the
   * edit is redrawn; `openSource`'s `onChange` still receives the text.
   */
  onEdit?: (edit: SessionEdit) => void;
  /**
   * An edit the source cannot take was undone, with the reason the editor shows (for example
   * that connection bends are not saved). The drawing is already back as it was.
   */
  onRefused?: (message: string) => void;
  /**
   * Who keeps the undo history of an opened source: the session (the default), the host (undo
   * and redo, from the keys or a menu, call it), or nobody (`false`).
   */
  history?: HistoryHandler | false;
  /** How a drag is kept in the source: `near` a neighbour (the default) or a `stay` where dropped. */
  drag?: DragTranslation;
  /** Give each new object and connection its id; without it ids are made from labels. */
  newId?: (request: NewIdRequest) => string;
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
    const s10a = Object.assign(s10, createCamera(s10));
    const s11 = Object.assign(s10a, createPointer(s10a));
    // Asked by the scene's link marks, which reach the session only through context.
    return Object.assign(s11, {
      /** What opening `href` does, for a link mark's label. */
      describeLink: (href: string): string => describeLink(s11 as DiagramSession, href),
    });
  });
}

export type DiagramSession = ReturnType<typeof createDiagramSession>;
