/**
 * The host's paint over the diagram: the page's own palette, light or dark, laid over the file's
 * appearance. It is view state like the camera: it lives on the drawn document, is set again
 * whenever the document is replaced, and never reaches the source.
 */
import { createEffect, createSignal } from 'solid-js';
import { unwrap } from 'solid-js/store';
import type { AppearanceLayer } from '../../model/appearance';
import type { DocumentPart } from './document';

export function createHostAppearance(s: DocumentPart) {
  const [layer, setLayer] = createSignal<AppearanceLayer | null>(s.options.appearance ?? null, {
    equals: false,
  });
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  // Opening, reprojecting or undoing replaces the document with the file's appearance alone.
  createEffect(() => {
    const want = layer();
    const shown = s.doc.appearance.host;
    if (!same(shown && unwrap(shown), want))
      s.setDoc('appearance', 'host', want ? structuredClone(want) : undefined);
  });

  /** The paint the host lays over the diagram, or null for the file's own look. */
  const hostAppearance = layer;
  /** Lay `appearance` over the diagram, or null to draw the file's own look. Nothing moves. */
  const setAppearance = (appearance: AppearanceLayer | null) => setLayer(appearance);

  return { hostAppearance, setAppearance };
}

export type HostAppearancePart = ReturnType<typeof createHostAppearance>;
