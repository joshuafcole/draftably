// A server component: the SVG fallback and the nonce come from the server, and `Proof` (a client
// component) hydrates with the same props.
import { headers } from 'next/headers';
import { renderSvg } from '@draftably/react/server';
import { Proof } from './components/Proof';
import { proofSource } from './proof.js';

export default async function Page() {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const result = await renderSvg(proofSource, {
    target: 'inline',
    idPrefix: 'proof',
    styleNonce: nonce,
  });
  return <Proof svg={result.ok ? result.value.svg : undefined} nonce={nonce} />;
}
