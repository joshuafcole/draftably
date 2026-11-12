import { randomBytes } from 'node:crypto';
import { createMiddleware } from '@solidjs/start/middleware';

/** A nonce per request, and the strict CSP that allows only it. */
export default createMiddleware({
  onRequest: event => {
    const nonce = randomBytes(16).toString('base64');
    event.locals.nonce = nonce;
    event.response.headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        `style-src 'self' 'nonce-${nonce}'`,
        "font-src 'self' data:",
        "img-src 'self' data:",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
      ].join('; '),
    );
  },
});
