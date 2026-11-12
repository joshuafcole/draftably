import { createSignal, For, Index, Show } from 'solid-js';
import { DraftDiagram, type UpdateResult } from '@draftably/solid';
import { DraftEditor } from '@draftably/solid/editor';
import {
  cards as firstCards,
  editorOptions,
  recordClick,
  recordChange,
  recordElement,
  recordEvent,
  slotCards,
  slotSource,
  sources,
  updated,
  viewerOptions,
} from '../../sources.js';

const record = (result: UpdateResult) =>
  ((window as { __updates?: string[] }).__updates ??= []).push(result.status);

export function App(props: { svgs?: string[] }) {
  const [list, setList] = createSignal(sources);
  const [edits, setEdits] = createSignal(sources.slice(0, 2));
  const [cards, setCards] = createSignal(firstCards);
  (globalThis as { __slotUpdate?: () => void }).__slotUpdate = () => {
    setList(l => [slotSource, ...l.slice(1)]);
    setCards(slotCards);
  };
  return (
    <main>
      <button id="update" onClick={() => setList(l => [updated, ...l.slice(1)])}>
        Update first
      </button>
      <button id="remove" onClick={() => setList(l => l.slice(0, 2))}>
        Remove last
      </button>
      {/* Index, not For: a new source for a position keeps its element and slot content. */}
      <Index each={list()}>
        {(source, i) => (
          <DraftDiagram
            source={source()}
            label={`Diagram ${i + 1}`}
            outline={i === 0 ? 'visible' : undefined}
            svg={props.svgs?.[i]}
            ref={el => i === 0 && recordElement(el)}
            options={i === 1 ? viewerOptions() : undefined}
            onUpdate={record}
            onCamera={() => recordEvent('camera')}
          >
            <Show when={i === 0}>
              <div data-draft-slot="overlay:api" class="badge">
                3
              </div>
              <div data-draft-slot="body:nope">ghost</div>
              {/* Keyed by ID: a relabeled card keeps its element, and its caret. */}
              <For each={cards().map(c => c.id)}>
                {id => (
                  <div data-draft-slot={`body:${id}`} class="card" data-card={id}>
                    <span>{cards().find(c => c.id === id)?.label}</span>
                    <button data-draft-input onClick={recordClick}>
                      go
                    </button>
                    <Show when={id === 'api'}>
                      <input data-draft-input class="field" />
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </DraftDiagram>
        )}
      </Index>
      <For each={edits()}>
        {(source, i) => (
          <DraftEditor
            source={source}
            style={{ height: '20rem' }}
            options={editorOptions()}
            onChange={({ source: next }) => {
              recordChange(i(), next);
              setEdits(all => all.map((s, j) => (j === i() ? next : s)));
            }}
          >
            <Show when={i() === 0}>
              <div data-draft-slot="body:api" class="card" data-card="editor-api">
                <span>API body</span>
                <input data-draft-input class="field" />
              </div>
            </Show>
          </DraftEditor>
        )}
      </For>
    </main>
  );
}
