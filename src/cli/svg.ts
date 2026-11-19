/** CLI exports retain embedded fonts and their existing authored-link behavior. */
import { fontFaceCss } from '../lib/font-data';
import { resolveAppearance } from '../model/appearance';
import type { Diagram } from '../model/types';
import { renderSvg as writeSvg, type SvgOptions } from '../runtime/svg-renderer';

export { accentPath, PHASE_TAB, sequenceBackdrop, type SvgOptions } from '../runtime/svg-renderer';

export function renderSvg(doc: Diagram, options: SvgOptions = {}): string {
  const code = doc.graph.nodes.some(n => n.code);
  return writeSvg(doc, {
    fontCss: fontFaceCss(resolveAppearance(doc.appearance), code),
    ...options,
  });
}
