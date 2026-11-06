/**
 * The embeddable editor: create a session per diagram and mount its canvas anywhere. A page can
 * hold any number of editors; each keeps its own document, selection, undo history and camera.
 */
export {
  createDiagramSession,
  type ConfirmRequest,
  type DiagramSession,
  type SessionOptions,
} from '../state/session';
export {
  DiagramSessionProvider,
  useDiagramSession,
  useSessionIfAny,
} from '../components/session-context';
export type { CanvasProps } from '../components/canvas/Canvas';
// What `mountEditor` sets up around the canvas, for a host that mounts `Editor` in its own tree:
// the bundled faces text is measured in, and the shortcuts for the active session.
export { registerFonts } from '../lib/font-data';
export { handleCanvasKey, handleKeyUp } from '../state/canvas-keyboard';
export { Editor } from './Editor';
export { mountEditor, type MountedEditor, type MountOptions } from './mount';
