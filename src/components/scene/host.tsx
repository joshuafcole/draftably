import { createContext, useContext } from 'solid-js';

/** The line that places an object in its source (`pin`, `near`, `stay` or `nudge`). */
export interface PlacingLine {
  type: string;
  line: number;
}

/**
 * What the scene components ask of the page that draws them. The editor answers from the open
 * file and its link settings; a page that only draws a scene can leave it out and get the
 * defaults, so the scene never reaches into the editor's state.
 */
export interface SceneHost {
  /** The line that places `id`, for the position badge's tooltip, if any. */
  placingLine(id: string): PlacingLine | undefined;
  /** What opening `href` does, for a link mark's label. */
  describeLink(href: string): string;
}

const standalone: SceneHost = {
  placingLine: () => undefined,
  describeLink: href => `Open ${href}`,
};

export const SceneHostContext = createContext<SceneHost>(standalone);

export const useSceneHost = () => useContext(SceneHostContext);
