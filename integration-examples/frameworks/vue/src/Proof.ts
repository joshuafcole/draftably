/** The host proof page in Vue. `../../proof.js` describes the page; Nuxt reuses this file. */
import { defineComponent, h, inject, onMounted, provide, ref } from 'vue';
import { DraftDiagram } from '@draftably/vue';
import { DraftEditor } from '@draftably/vue/editor';
import {
  PROOF_OWNER,
  cancelLink,
  cancelMenu,
  cycleSource,
  editorSources,
  exposeProof,
  proofBroken,
  proofHooks,
  proofSource,
  proofUpdated,
  viewerOptions,
} from '../../proof.js';

/** Slot content that reads the host's context: the wrapper must keep it in the host's tree. */
const Card = defineComponent({
  setup() {
    const owner = inject('owner', 'no context');
    const clicks = ref(0);
    return () =>
      h('div', { 'data-draft-slot': 'body:api', class: 'proof-card' }, [
        h('span', { class: 'proof-owner' }, owner),
        h(
          'button',
          {
            'data-draft-input': '',
            class: 'proof-go',
            onClick: () => {
              proofHooks().clicks++;
              clicks.value++;
            },
          },
          `Go ${clicks.value}`,
        ),
        h('input', { 'data-draft-input': '', class: 'proof-field', 'aria-label': 'Note' }),
      ]);
  },
});

export const Proof = defineComponent({
  props: { svg: { type: String, default: undefined }, nonce: { type: String, default: undefined } },
  setup(props) {
    provide('owner', PROOF_OWNER);
    const source = ref(proofSource);
    const cycle = ref(false);
    const options = viewerOptions(props.nonce);
    onMounted(() =>
      exposeProof({
        update: () => (source.value = proofUpdated),
        fail: () => (source.value = proofBroken),
        toggle: () => (cycle.value = !cycle.value),
      }),
    );
    return () =>
      h('div', [
        h('section', { id: 'p-viewer' }, [
          h(
            DraftDiagram,
            {
              source: source.value,
              svg: props.svg,
              label: 'Proof',
              options,
              'data-proof': 'viewer',
              onContextmenu: cancelMenu,
              onLink: cancelLink,
            },
            { default: () => [h(Card)] },
          ),
        ]),
        h(
          'section',
          { id: 'p-editors' },
          editorSources.map((s, i) =>
            h(DraftEditor, {
              key: i,
              source: s,
              class: 'proof-editor',
              'data-proof': 'editor',
              onChange: ({ source: next }: { source: string }) =>
                proofHooks().changes[i].push(next),
            }),
          ),
        ),
        h(
          'section',
          { id: 'p-cycle' },
          cycle.value
            ? [
                h(DraftDiagram, { source: cycleSource, options }),
                h(DraftEditor, { source: cycleSource, class: 'proof-editor' }),
              ]
            : [],
        ),
      ]);
  },
});
