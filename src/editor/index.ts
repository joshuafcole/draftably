/**
 * The embeddable editor: create a session per diagram and mount its canvas anywhere. A page can
 * hold any number of editors; each keeps its own document, selection, undo history and camera.
 */
export {
  createDiagramSession,
  LEGIBLE_ZOOM,
  type CameraMover,
  type FitOptions,
  type PanelSide,
  type RevealOptions,
  type ConfirmRequest,
  type DiagramSession,
  type DragTranslation,
  type HistoryHandler,
  type HostArrangement,
  type NewIdRequest,
  type SessionEdit,
  type SourceOperation,
  type SessionOptions,
  type ViewItem,
  type ViewItemKind,
} from '../state/session';
export {
  DiagramSessionProvider,
  useDiagramSession,
  useSessionIfAny,
} from '../components/session-context';
// A host's own node bodies, drawn in place of titles; layout reads `size … min-height=` instead.
export {
  NodeContentProvider,
  useNodeContent,
  type NodeContent,
  type NodeContentProps,
} from '../components/scene/node-content';
export type { CanvasProps } from '../components/canvas/Canvas';
export type { AppearanceLayer } from '../model/appearance';
export type { Camera } from '../model/types';
// What `mountEditor` sets up around the canvas, for a host that mounts `Editor` in its own tree:
// the bundled faces text is measured in, and the shortcuts for the active session.
export { registerFonts } from '../lib/font-data';
// The clipboard, for a host that listens for `copy` and `paste` itself (`mountEditor` does).
export { copyShapes, handleCanvasKey, handleKeyUp, pasteShapes } from '../state/canvas-keyboard';
export { Editor } from './Editor';
export { mountEditor, type MountedEditor, type MountOptions } from './mount';
