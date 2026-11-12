'use client';
/** The host proof page in React. `../../proof.js` describes the page; Next.js reuses this file. */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DraftDiagram } from '@draftably/react';
import { DraftEditor } from '@draftably/react/editor';
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
} from '../proof.js';

const Owner = createContext('no context');

/** Slot content that reads the host's context: the wrapper must keep it in the host's tree. */
function Card() {
  const owner = useContext(Owner);
  const [clicks, setClicks] = useState(0);
  return (
    <div data-draft-slot="body:api" className="proof-card">
      <span className="proof-owner">{owner}</span>
      <button
        data-draft-input=""
        className="proof-go"
        onClick={() => {
          proofHooks().clicks++;
          setClicks(c => c + 1);
        }}
      >
        {`Go ${clicks}`}
      </button>
      <input data-draft-input="" className="proof-field" aria-label="Note" />
    </div>
  );
}

export function Proof({ svg, nonce }: { svg?: string; nonce?: string }) {
  const [source, setSource] = useState(proofSource);
  const [cycle, setCycle] = useState(false);
  const options = useMemo(() => viewerOptions(nonce), [nonce]);
  useEffect(() => {
    exposeProof({
      update: () => setSource(proofUpdated),
      fail: () => setSource(proofBroken),
      toggle: () => setCycle(c => !c),
    });
  }, []);
  return (
    <Owner.Provider value={PROOF_OWNER}>
      <section id="p-viewer">
        <DraftDiagram
          source={source}
          svg={svg}
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
        {editorSources.map((s, i) => (
          <DraftEditor
            key={i}
            source={s}
            className="proof-editor"
            data-proof="editor"
            onChange={({ source: next }) => proofHooks().changes[i].push(next)}
          />
        ))}
      </section>
      <section id="p-cycle">
        {cycle && (
          <>
            <DraftDiagram source={cycleSource} options={options} />
            <DraftEditor source={cycleSource} className="proof-editor" />
          </>
        )}
      </section>
    </Owner.Provider>
  );
}
