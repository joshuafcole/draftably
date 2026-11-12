import { useState } from 'react';
import { DraftDiagram, type UpdateResult } from '@draftably/react';
import { DraftEditor } from '@draftably/react/editor';
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

export function App({ svgs = [] }: { svgs?: string[] }) {
  const [list, setList] = useState(sources);
  const [edits, setEdits] = useState(sources.slice(0, 2));
  const [cards, setCards] = useState(firstCards);
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
      {list.map((source, i) => (
        <DraftDiagram
          key={i}
          source={source}
          label={`Diagram ${i + 1}`}
          outline={i === 0 ? 'visible' : undefined}
          svg={svgs[i]}
          ref={i === 0 ? recordElement : undefined}
          options={i === 1 ? viewerOptions() : undefined}
          onUpdate={record}
          onCamera={() => recordEvent('camera')}
        >
          {i === 0 && (
            <>
              <div data-draft-slot="overlay:api" className="badge">
                3
              </div>
              <div data-draft-slot="body:nope">ghost</div>
              {cards.map(c => (
                <div key={c.id} data-draft-slot={`body:${c.id}`} className="card" data-card={c.id}>
                  <span>{c.label}</span>
                  <button data-draft-input="" onClick={recordClick}>
                    go
                  </button>
                  {c.id === 'api' && <input data-draft-input="" className="field" />}
                </div>
              ))}
            </>
          )}
        </DraftDiagram>
      ))}
      {edits.map((source, i) => (
        <DraftEditor
          key={`editor-${i}`}
          source={source}
          style={{ height: '20rem' }}
          options={editorOptions()}
          onChange={({ source: next }) => {
            recordChange(i, next);
            setEdits(all => all.map((s, j) => (j === i ? next : s)));
          }}
        >
          {i === 0 && (
            <div data-draft-slot="body:api" className="card" data-card="editor-api">
              <span>API body</span>
              <input data-draft-input="" className="field" />
            </div>
          )}
        </DraftEditor>
      ))}
    </main>
  );
}
