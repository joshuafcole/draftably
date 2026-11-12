/** The host proof page in Solid. `../../proof.js` describes the page; SolidStart reuses this file. */
import { createContext, createSignal, For, onMount, Show, useContext } from 'solid-js';
import { DraftDiagram } from '@draftably/solid';
import { DraftEditor } from '@draftably/solid/editor';
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
} from '../proof/proof.js';

const Owner = createContext('no context');

/** Slot content that reads the host's context: the wrapper must keep it in the host's tree. */
function Card() {
  const owner = useContext(Owner);
  const [clicks, setClicks] = createSignal(0);
  return (
    <div data-draft-slot="body:api" class="proof-card">
      <span class="proof-owner">{owner}</span>
      <button
        data-draft-input
        class="proof-go"
        onClick={() => {
          proofHooks().clicks++;
          setClicks(c => c + 1);
        }}
      >
        {`Go ${clicks()}`}
      </button>
      <input data-draft-input class="proof-field" aria-label="Note" />
    </div>
  );
}

export function Proof(props: { svg?: string; nonce?: string }) {
  const [source, setSource] = createSignal(proofSource);
  const [cycle, setCycle] = createSignal(false);
  const options = viewerOptions(props.nonce);
  onMount(() =>
    exposeProof({
      update: () => setSource(proofUpdated),
      fail: () => setSource(proofBroken),
      toggle: () => setCycle(c => !c),
    }),
  );
  return (
    <Owner.Provider value={PROOF_OWNER}>
      <section id="p-viewer">
        <DraftDiagram
          source={source()}
          svg={props.svg}
          label="Proof"
          options={options}
          data-proof="viewer"
          onContextmenu={cancelMenu}
          onLink={cancelLink}
        >
          <Card />
        </DraftDiagram>
      </section>
      <section id="p-editors">
        <For each={editorSources}>
          {(s, i) => (
            <DraftEditor
              source={s}
              class="proof-editor"
              data-proof="editor"
              onChange={({ source: next }) => proofHooks().changes[i()].push(next)}
            />
          )}
        </For>
      </section>
      <section id="p-cycle">
        <Show when={cycle()}>
          <DraftDiagram source={cycleSource} options={options} />
          <DraftEditor source={cycleSource} class="proof-editor" />
        </Show>
      </section>
    </Owner.Provider>
  );
}
