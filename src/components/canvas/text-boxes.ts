import { PHASE_TAB } from '../../cli/svg';
import { resolveAppearance, swatchFor, type ResolvedAppearance } from '../../model/appearance';
import type { DiagramFrame } from '../../model/frame';
import { measureText } from '../../model/fonts';
import { NOTE_PAD } from '../../model/note';
import type { Run } from '../../model/rich-text';
import type { Diagram, Rect } from '../../model/types';
import { parseTextId, textId } from '../../state/session/canvas-text';
import { headingSlot } from './Frame';

type Type = ResolvedAppearance['annotation'];

/** A piece of canvas text: its id, where it is drawn, and the type and paint to edit it in. */
export interface TextBox {
  id: string;
  rect: Rect;
  type: Type;
  fill: string;
  ink: string;
  /** Links in the text, each with the box a click opens it from. */
  links?: Array<Rect & { href: string }>;
}

/** Click boxes for the links in lines of runs whose first line starts at (x, y). */
const linkBoxes = (lines: Run[][], x: number, y: number, lineHeight: number) =>
  lines.flatMap((runs, i) =>
    runs.flatMap(r =>
      r.href ? [{ href: r.href, x: x + r.x, y: y + i * lineHeight, w: r.w, h: lineHeight }] : [],
    ),
  );

/**
 * Every note, legend row and phase label the frame draws, with the box a click or an edit covers.
 * Status rows in the key are counted from the drawing, so they are not here.
 */
export function textBoxes(doc: Diagram, frame: DiagramFrame): TextBox[] {
  const look = resolveAppearance(doc.appearance),
    type = look.annotation,
    panel = swatchFor(look, 'slate', 50, 'group').fill,
    out: TextBox[] = [];
  // A note the drawn state leaves out can't be clicked; the others keep their index as their id.
  frame.notes.forEach((n, i) => {
    if (n.hidden) return;
    out.push({
      id: textId('note', i),
      rect: n.rect,
      type,
      fill: panel,
      ink: look.text,
      links: linkBoxes(n.lines, n.rect.x + NOTE_PAD.x, n.rect.y + NOTE_PAD.y, type.lineHeight),
    });
  });
  const foot = frame.foot;
  foot.items.forEach((item, i) => {
    const top = foot.y + item.y,
      lh = foot.type.lineHeight;
    out.push({
      id: textId('footnote', i),
      rect: {
        x: foot.x,
        y: top,
        w: foot.gutter + Math.max(...item.lines.map(l => l.reduce((w, r) => w + r.w, 0))),
        h: item.lines.length * lh,
      },
      type: foot.type,
      fill: look.canvas,
      ink: look.text,
      links: linkBoxes(item.lines, foot.x + foot.gutter, top, lh),
    });
  });
  const legend = doc.appearance.legend?.length ?? 0;
  frame.key.items.forEach((item, i) => {
    if (!item.legend || i >= legend) return;
    out.push({
      id: textId('legend', i),
      rect: {
        x: frame.legend.x + item.x,
        y: frame.legend.y + 12 + item.y,
        w: 24 + measureText(item.label, type),
        h: frame.key.row,
      },
      type,
      fill: look.canvas,
      ink: look.text,
    });
  });
  const seq = doc.layout.sequence;
  for (const ph of seq?.phases ?? [])
    out.push({
      id: textId('phase', ph.id),
      rect: {
        x: (seq!.phaseX ?? seq!.panel.x) + PHASE_TAB - 2,
        y: ph.y + PHASE_TAB - 2,
        w: measureText(ph.label, type) + 4,
        h: type.lineHeight,
      },
      type,
      fill: look.canvas,
      ink: look.muted,
    });
  return out;
}

/** The box of one text id, including the title and subtitle; undefined when it is not drawn. */
export function textBox(doc: Diagram, frame: DiagramFrame, id: string): TextBox | undefined {
  const t = parseTextId(id);
  if (!t) return;
  if (t.kind === 'title' || t.kind === 'subtitle') {
    const slot = headingSlot(doc, frame, t.kind),
      look = resolveAppearance(doc.appearance);
    return (
      slot && {
        id,
        rect: slot,
        type: slot.type,
        fill: look.canvas,
        ink: t.kind === 'title' ? look.text : look.muted,
      }
    );
  }
  return textBoxes(doc, frame).find(b => b.id === id);
}
