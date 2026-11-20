/**
 * The camera as a host reads and sets it. Every move is heard through the session's own
 * `onCamera(reason)`; framing and revealing are the host's (or a handle's `fit` and `reveal`).
 */
import type { Camera } from '../../model/types';
import type { DocumentPart } from './document';

const sameCamera = (a: Camera, b: Camera) => a.x === b.x && a.y === b.y && a.k === b.k;

export function createCamera(s: DocumentPart) {
  /** The camera now: the screen point of the world origin (`x`, `y`) and the zoom (`k`). */
  const camera = (): Camera => ({ ...s.doc.camera });

  /** Move the camera for the host, reported with reason `'api'`. Returns whether it moved. */
  function moveCamera(next: Camera) {
    if (sameCamera(next, s.doc.camera)) return false;
    s.setCamera(next, 'api');
    return true;
  }

  return { camera, moveCamera };
}

export type CameraPart = ReturnType<typeof createCamera>;
