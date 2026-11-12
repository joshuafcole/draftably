// A strict CSP with a nonce per request. Next.js reads the nonce from the request's CSP header
// and puts it on its own scripts; the page reads `x-nonce` for the diagram's SVG and viewer.
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "font-src 'self' data:",
    "img-src 'self' data:",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}
