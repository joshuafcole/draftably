import type { Handle } from '@sveltejs/kit';

declare global {
  // SvelteKit types `locals` through this namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace App {
    interface Locals {
      nonce: string;
    }
  }
}

/**
 * A strict CSP with one nonce per request. SvelteKit's `csp` option makes its own nonce, but
 * `load` cannot read it, and the server SVG's `<style>` needs it. So this hook makes the nonce,
 * hands it to `load` in `locals`, puts it on SvelteKit's one inline script (its bootstrap, which
 * it writes as a bare `<script>` when `csp` is off) and sends the header itself.
 *
 * SvelteKit's root component mounts a route announcer with a fixed `style="..."` attribute
 * (`@sveltejs/kit/src/runtime/components/root.svelte`), and a nonce cannot cover an attribute.
 * `style-src-attr` allows that one value by its hash and blocks every other style attribute.
 */
const ANNOUNCER = "'unsafe-hashes' 'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo='";
export const handle: Handle = async ({ event, resolve }) => {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  event.locals.nonce = nonce;
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replaceAll('<script>', `<script nonce="${nonce}">`),
  });
  response.headers.set(
    'content-security-policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      `style-src 'self' 'nonce-${nonce}'`,
      `style-src-attr ${ANNOUNCER}`,
      "font-src 'self' data:",
      "img-src 'self' data:",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
    ].join('; '),
  );
  return response;
};
