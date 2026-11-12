import { createEffect, createMemo, on, onMount, Show } from 'solid-js';
import { SOFT_PAD, SOFT_TITLE } from '../../dsl/frame';
import { clamp } from '../../model/geometry';
import { resolveAppearance } from '../../model/appearance';
import { drawnSwatch } from '../../model/colors';
import { findEdge, findGroup, findNode, objectRect, styleOf } from '../../model/graph';
import { parseTextId, TEXT_NAMES } from '../../state/session/canvas-text';
import { textBox } from './text-boxes';
import { useDiagramSession } from '../session-context';

/** A text box over the canvas for editing a shape, container or connection label in place. */
export function InlineEditor() {
  const s = useDiagramSession();
  return <Show when={s.inlineEditId()}>{id => <Editor id={id()} />}</Show>;
}

function Editor(props: { id: string }) {
  const s = useDiagramSession();
  let input!: HTMLTextAreaElement;
  const look = () => resolveAppearance(s.drawnAppearance());

  /**
   * The editor sits on the object itself: a shape's whole face, a container's title band, or a
   * connection's label, in the object's own font, colors and line height. Below about 12px text
   * it is drawn larger than the object, around the same center, so it stays legible.
   */
  const frame = createMemo(() => {
    const k = s.doc.camera.k,
      { width, height } = s.stageSize();
    let world: { x: number; y: number; w: number; h: number },
      type = look().annotation,
      fill = look().canvas,
      ink = look().text,
      align: 'center' | 'left' = 'center',
      radius = 4;
    const text = textBox(s.doc, s.viewerFrame(), props.id);
    if (text) {
      ({ type, fill, ink } = text);
      align = 'left';
      // A short label edits in a box wide enough to type a longer one; prose shows its links'
      // targets while it is edited, so it gets more room.
      const prose = /^@(note|footnote):/.test(props.id);
      world = { ...text.rect, w: Math.max(text.rect.w, prose ? 360 : 160) };
    } else if (findEdge(s.doc, props.id)) {
      const route = s.routesById().get(props.id),
        at = route?.label ?? route?.points[Math.floor(route.points.length / 2)] ?? { x: 0, y: 0 };
      const w = Math.max(route?.label?.w ?? 0, 120),
        h = route?.label?.h ?? type.lineHeight + 6;
      world = { x: at.x - w / 2, y: at.y - h / 2, w, h };
    } else if (findGroup(s.doc, props.id)?.frame === 'soft') {
      // A soft group's small label sits inside the first piece of its tint.
      const r = objectRect(s.doc, s.geometry, props.id),
        h0 = findGroup(s.doc, props.id)!.hull?.[0] ?? { x: 0, y: 0, w: r.w, h: r.h },
        swatch = drawnSwatch(s.doc, look(), props.id, 'group');
      fill = swatch.fill;
      ink = swatch.ink;
      align = 'left';
      world = {
        x: r.x + h0.x + SOFT_TITLE.x - 4,
        y: r.y + h0.y + SOFT_TITLE.y - type.lineHeight / 2 - 2,
        w: Math.max(120, h0.w - 2 * SOFT_PAD),
        h: type.lineHeight + 4,
      };
    } else if (findGroup(s.doc, props.id)) {
      const r = objectRect(s.doc, s.geometry, props.id),
        swatch = drawnSwatch(s.doc, look(), props.id, 'group'),
        band = look().groupHeader / 2 - 7;
      type = look().groupTitle;
      fill = swatch.fill;
      ink = swatch.ink;
      align = 'left';
      world = { x: r.x + 28, y: r.y + 3, w: Math.max(80, r.w - 28 - 34), h: band * 2 - 6 };
    } else {
      const r = objectRect(s.doc, s.geometry, props.id),
        style = styleOf(s.doc, props.id),
        swatch = drawnSwatch(s.doc, look(), props.id, 'node');
      type = look().title;
      // Text shapes and images keep their title off the face; those edit on the canvas color.
      const onFace = style.shape !== 'text' && style.shape !== 'image';
      fill = onFace ? swatch.fill : look().canvas;
      ink = onFace ? swatch.ink : look().text;
      radius = Math.min(look().radius, r.h / 2);
      world = r;
    }
    const scale = Math.max(k, 12 / type.size),
      w = world.w * scale,
      h = world.h * scale,
      cx = (world.x + world.w / 2) * k + s.doc.camera.x,
      cy = (world.y + world.h / 2) * k + s.doc.camera.y;
    return {
      left: clamp(cx - w / 2, 5, Math.max(5, width - w - 5)),
      top: clamp(cy - h / 2, 5, Math.max(5, height - h - 5)),
      w,
      h,
      scale,
      type,
      fill,
      ink,
      align,
      radius: radius * scale,
    };
  });

  /** Grow the text box to its content, so a long title never scrolls. */
  const fit = () => {
    input.style.height = '0px';
    input.style.height = `${input.scrollHeight}px`;
  };

  const label = () => {
    const text = parseTextId(props.id);
    return text
      ? `Edit diagram ${TEXT_NAMES[text.kind]}`
      : findEdge(s.doc, props.id)
        ? 'Edit connection label'
        : findGroup(s.doc, props.id)
          ? 'Edit container title'
          : 'Edit node title';
  };

  onMount(() => {
    input.focus();
    input.select();
    fit();
  });
  createEffect(on(frame, () => fit(), { defer: true }));

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Tab') {
      // Tab keeps going: commit and add the next connected shape (Shift: a sibling branch).
      e.preventDefault();
      const id = props.id;
      s.finishInlineEdit(true);
      if (id.startsWith('@')) return s.focusCanvas();
      s.setSelection([id]);
      if (findNode(s.doc, id) || findEdge(s.doc, id)) s.quickExtend({ sibling: e.shiftKey });
      else s.focusCanvas();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      s.finishInlineEdit(true);
      s.focusCanvas();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      s.finishInlineEdit(false);
      s.setTool('select');
    }
  };

  return (
    <div
      class="inline-edit"
      classList={{ left: frame().align === 'left' }}
      style={{
        left: `${frame().left}px`,
        top: `${frame().top}px`,
        width: `${frame().w}px`,
        'min-height': `${frame().h}px`,
        background: frame().fill,
        'border-radius': `${frame().radius}px`,
      }}
    >
      <textarea
        ref={input}
        rows={1}
        aria-label={label()}
        value={s.inlineDraft()}
        onInput={e => {
          s.setInlineDraft(e.currentTarget.value);
          fit();
        }}
        onKeyDown={onKeyDown}
        onBlur={() => s.finishInlineEdit(true)}
        style={{
          color: frame().ink,
          'font-family': frame().type.family,
          'font-size': `${frame().type.size * frame().scale}px`,
          'font-weight': String(frame().type.weight),
          'line-height': `${frame().type.lineHeight * frame().scale}px`,
          'text-align': frame().align,
        }}
      />
    </div>
  );
}
