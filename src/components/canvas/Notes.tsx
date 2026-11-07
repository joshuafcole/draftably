import { resolveAppearance } from '../../model/appearance';
import { noteMarkup } from '../../model/note';
import { exportHref } from '../../state/links';
import { useDiagramSession } from '../session-context';

/**
 * The file's notes, placed by the frame as `inspect --svg` places them. Not part of the frame
 * group, so the editor's exports copy them with the drawing.
 */
export function Notes() {
  const s = useDiagramSession();
  // Links are written as exports write them, since exports copy these notes.
  const markup = () =>
    noteMarkup(
      resolveAppearance(s.doc.appearance),
      // A note the host draws as its own overlay is left undrawn here (`holdNotes`).
      s.viewerFrame().notes.filter(n => n.note.id === undefined || !s.heldNotes().has(n.note.id)),
      href => exportHref(s, href),
    );
  // The markup escapes its text, as in exports.
  // eslint-disable-next-line solid/no-innerhtml
  return <g class="diagram-notes" pointer-events="none" innerHTML={markup()} />;
}
