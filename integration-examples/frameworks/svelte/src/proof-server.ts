import { render as renderApp } from 'svelte/server';
import { renderSvg } from '@draftably/svelte';
import Proof from './Proof.svelte';
import { proofSource } from '../../proof.js';

/** The proof page's server HTML and the props the client hydrates with. */
export async function render(nonce: string) {
  const result = await renderSvg(proofSource, {
    target: 'inline',
    idPrefix: 'proof',
    styleNonce: nonce,
  });
  const props = { svg: result.ok ? result.value.svg : undefined, nonce };
  const { body, head } = renderApp(Proof, { props });
  return { html: body, props, head };
}
