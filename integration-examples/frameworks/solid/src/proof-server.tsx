import { generateHydrationScript, renderToString } from 'solid-js/web';
import { renderSvg } from '@draftably/solid';
import { Proof } from './Proof';
import { proofSource } from '../../proof.js';

/** The proof page's server HTML, the hydration script and the props the client hydrates with. */
export async function render(nonce: string) {
  const result = await renderSvg(proofSource, {
    target: 'inline',
    idPrefix: 'proof',
    styleNonce: nonce,
  });
  const props = { svg: result.ok ? result.value.svg : undefined, nonce };
  return {
    html: renderToString(() => <Proof {...props} />),
    props,
    head: generateHydrationScript({ nonce }),
  };
}
