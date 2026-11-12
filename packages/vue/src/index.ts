/** `<DraftDiagram>` for Vue 3: the `<draft-diagram>` element with Vue props and events. */
import '@draftably/runtime/element';
import type { DraftDiagramElement } from '@draftably/runtime/element';
import type { UpdateResult, ViewerOptions } from '@draftably/runtime/viewer';
import { defineComponent, h, onMounted, ref, type PropType } from 'vue';
import { hostEmits, listenHostEvents } from './events.js';

export { renderSvg } from '@draftably/runtime';
export { HOST_EVENTS } from '@draftably/runtime/host';
export type { HostEmits, HostEventDetail, HostEventName, HostEvents } from './events.js';
export type { DraftDiagramElement, UpdateResult, ViewerOptions };

export const DraftDiagram = defineComponent({
  name: 'DraftDiagram',
  props: {
    /** `.draft` source. A change redraws the diagram and keeps the camera. */
    source: { type: String, required: true },
    /** A declared emphasis state to show. */
    state: { type: String as PropType<string | null>, default: undefined },
    /** The accessible name. */
    label: { type: String, default: undefined },
    /** `'visible'` shows the item list under the drawing; `'hidden'` (default) shows it on focus. */
    outline: { type: String as PropType<'visible' | 'hidden'>, default: undefined },
    /** Static SVG from `renderSvg(source, { target: 'inline', idPrefix })`, shown until the viewer draws. */
    svg: { type: String, default: undefined },
    /** Every `mountViewer` option. A new object with the same values does nothing. */
    options: { type: Object as PropType<ViewerOptions>, default: undefined },
  },
  emits: hostEmits,
  setup(props, { emit, expose, slots }) {
    const el = ref<DraftDiagramElement>();
    onMounted(() => listenHostEvents(el.value!, emit as (name: string, detail: unknown) => void));
    expose({ element: el });
    return () =>
      h(
        'draft-diagram',
        {
          ref: el,
          source: props.source,
          state: props.state ?? undefined,
          label: props.label,
          outline: props.outline,
          // Only when set, so options a host set through the ref survive.
          ...(props.options === undefined ? {} : { '.options': props.options }),
        },
        // The default slot holds slot content: children marked `data-draft-slot`.
        [...(props.svg ? [h('div', { innerHTML: props.svg })] : []), ...(slots.default?.() ?? [])],
      );
  },
});

export default DraftDiagram;
