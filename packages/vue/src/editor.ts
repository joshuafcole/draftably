/** `<DraftEditor>` for Vue 3: drag boxes and lines, and get the `.draft` source back. */
import type { DraftEditorElement, EditorOptions } from '@draftably/editor/element';
import { defineComponent, h, onMounted, ref, type PropType } from 'vue';
import { hostEmits, listenHostEvents } from './events.js';

export type { DraftEditorElement, EditorOptions };

export const DraftEditor = defineComponent({
  name: 'DraftEditor',
  props: {
    /** `.draft` source. Passing back the source from `change` does not redraw. */
    source: { type: String, required: true },
    /** Every `mountEditor` option but `source` and `onChange`. Callbacks apply live. */
    options: { type: Object as PropType<EditorOptions>, default: undefined },
  },
  emits: hostEmits,
  setup(props, { emit, expose, slots }) {
    const el = ref<DraftEditorElement>();
    onMounted(() => {
      listenHostEvents(el.value!, emit as (name: string, detail: unknown) => void);
      // The editor loads in the browser only, so server rendering and viewer-only pages skip it.
      import('@draftably/editor/element').catch((error: unknown) => {
        el.value?.setAttribute('status', 'error');
        el.value?.setAttribute('data-error', String(error));
      });
    });
    expose({ element: el });
    // The default slot holds slot content: children marked `data-draft-slot`.
    return () =>
      h(
        'draft-editor',
        {
          ref: el,
          source: props.source,
          // Only when set, so options a host set through the ref survive.
          ...(props.options === undefined ? {} : { '.options': props.options }),
        },
        slots.default?.(),
      );
  },
});
