import '@draftably/runtime/host.css';
import '~/proof/proof.css';
import { createAsync, query } from '@solidjs/router';
import { getRequestEvent } from 'solid-js/web';
import { Show } from 'solid-js';
import { renderSvg } from '@draftably/solid';
import { Proof } from '~/components/Proof';
import { proofSource } from '~/proof/proof.js';

/** The server's fallback SVG and the request's nonce, serialized to the client for hydration. */
const getProof = query(async () => {
  'use server';
  const nonce = getRequestEvent()!.locals.nonce;
  const result = await renderSvg(proofSource, {
    target: 'inline',
    idPrefix: 'proof',
    styleNonce: nonce,
  });
  return { svg: result.ok ? result.value.svg : undefined, nonce };
}, 'proof');

export const route = { preload: () => getProof() };

export default function Home() {
  const props = createAsync(() => getProof());
  return <Show when={props()}>{p => <Proof svg={p().svg} nonce={p().nonce} />}</Show>;
}
