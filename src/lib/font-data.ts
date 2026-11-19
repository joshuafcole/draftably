/**
 * The bundled diagram fonts as data URLs, for SVG exports that must render without the app.
 * The browser loads this module only when exporting; the CLI bundles it.
 */
import type { ResolvedAppearance } from '../model/appearance';
import { FACES, type FaceId } from '../model/fonts';
import sans500 from '../assets/fonts/inter-latin-500-normal.woff2?inline';
import sans600 from '../assets/fonts/inter-latin-600-normal.woff2?inline';
import serif600 from '../assets/fonts/source-serif-4-latin-600-normal.woff2?inline';
import mono500 from '../assets/fonts/jetbrains-mono-latin-500-normal.woff2?inline';

const DATA: Record<FaceId, string> = {
  'sans-500': sans500,
  'sans-600': sans600,
  'serif-600': serif600,
  'mono-500': mono500,
};

/**
 * `@font-face` rules for the faces an appearance draws with, and JetBrains Mono when the drawing
 * has a code node.
 */
export function fontFaceCss(look: ResolvedAppearance, code = false): string {
  const faces = [
    ...new Set<FaceId>([
      look.title.face,
      look.groupTitle.face,
      look.annotation.face,
      ...(code ? (['mono-500'] as const) : []),
    ]),
  ];
  return faces
    .map(id => {
      const face = FACES[id];
      // Vite may label the data URL with a generic type; browsers only need the bytes.
      const url = DATA[id].replace(/^data:[^;]*;/, 'data:font/woff2;');
      return `@font-face{font-family:'${face.family}';font-weight:${face.weight};font-style:normal;src:url(${url}) format('woff2');}`;
    })
    .join('');
}

let registered = false;

/** Make the bundled faces available to the page, so the canvas draws with measured fonts. */
export function registerFonts() {
  if (registered || typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  registered = true;
  for (const [id, url] of Object.entries(DATA) as Array<[FaceId, string]>) {
    const face = FACES[id],
      font = new FontFace(face.family, `url(${url.replace(/^data:[^;]*;/, 'data:font/woff2;')})`, {
        weight: String(face.weight),
      });
    document.fonts.add(font);
    void font.load().catch(() => {});
  }
}
