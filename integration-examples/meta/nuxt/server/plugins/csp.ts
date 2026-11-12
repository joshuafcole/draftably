/** A strict CSP with a nonce per request, on every tag Nuxt writes into the page. */
import { randomBytes } from 'node:crypto';

export default defineNitroPlugin(nitro => {
  nitro.hooks.hook('request', event => {
    event.context.nonce = randomBytes(16).toString('base64');
  });

  nitro.hooks.hook('render:html', (html, { event }) => {
    const nonce = event.context.nonce as string;
    // Tags that already carry a nonce (the server SVG's style) keep theirs.
    const add = (part: string) =>
      part.replace(/<(script|style|link)\b(?![^>]*\snonce=)/g, `<$1 nonce="${nonce}"`);
    for (const key of ['head', 'bodyPrepend', 'body', 'bodyAppend'] as const)
      html[key] = html[key].map(add);
  });

  nitro.hooks.hook('render:response', (response, { event }) => {
    const n = `'nonce-${event.context.nonce}'`;
    response.headers ??= {};
    response.headers['content-security-policy'] = [
      "default-src 'self'",
      `script-src 'self' ${n}`,
      `style-src 'self' ${n}`,
      "font-src 'self' data:",
      "img-src 'self' data:",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
    ].join('; ');
  });
});
