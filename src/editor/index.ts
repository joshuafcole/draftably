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
export type { AppearanceLayer } from '../model/appearance';
export { Editor } from './Editor';
export { mountEditor, type MountedEditor, type MountOptions } from './mount';
