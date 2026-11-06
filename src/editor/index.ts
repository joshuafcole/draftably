/**
 * The embeddable editor: create a session per diagram and mount its canvas anywhere. A page can
 * hold any number of editors; each keeps its own document, selection, undo history and camera.
 */
export {
  createDiagramSession,
  type ConfirmRequest,
  type DiagramSession,
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
// What `mountEditor` sets up around the canvas, for a host that mounts `Editor` in its own tree:
// the bundled faces text is measured in, and the shortcuts for the active session.
export { registerFonts } from '../lib/font-data';
export { handleCanvasKey, handleKeyUp } from '../state/canvas-keyboard';
export { Editor } from './Editor';
export { mountEditor, type MountedEditor, type MountOptions } from './mount';
