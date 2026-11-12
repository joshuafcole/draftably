import { renderSvg } from '@draftably/svelte';
import { proofSource } from '#lib/proof/proof.js';

/** The fallback SVG, drawn on the server with the request's CSP nonce on its `<style>`. */
export async function load({ locals }) {
  const result = await renderSvg(proofSource, {
    target: 'inline',
    idPrefix: 'proof',
    styleNonce: locals.nonce,
  });
  return { svg: result.ok ? result.value.svg : undefined, nonce: locals.nonce };
}
