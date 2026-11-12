import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { renderSvg } from '@draftably/vue';
import { Proof } from './Proof';
import { proofSource } from '../../proof.js';

/** The proof page's server HTML and the props the client hydrates with. */
export async function render(nonce: string) {
  const result = await renderSvg(proofSource, {
    target: 'inline',
    idPrefix: 'proof',
    styleNonce: nonce,
  });
  const props = { svg: result.ok ? result.value.svg : undefined, nonce };
  return { html: await renderToString(createSSRApp(Proof, props)), props, head: '' };
}
