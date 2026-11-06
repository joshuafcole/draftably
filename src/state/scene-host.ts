import type { SceneHost } from '../components/scene/host';
import { fileScene } from './file-session';
import { describeLink } from './links';

const PLACING = ['pin', 'near', 'stay', 'nudge'];

/** The editor's answers to the scene components: lines from the open file, links as it opens them. */
export const editorSceneHost: SceneHost = {
  placingLine(id) {
    const h = fileScene()?.model.hints.find(
      h => 'id' in h && h.id === id && PLACING.includes(h.type),
    );
    return h && { type: h.type, line: h.line };
  },
  describeLink,
};
