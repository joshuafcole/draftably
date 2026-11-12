import type { Diagram } from '../model/types';
import type { Diagnostic, RenderOptions } from './types';

export function assertOptions(options: RenderOptions) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Render options must be an object.');
  if (options.target !== undefined && !['image', 'inline'].includes(options.target))
    throw new TypeError('target must be image or inline.');
  if (options.target === 'inline') {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(options.idPrefix ?? ''))
      throw new TypeError(
        'Inline output needs an idPrefix with 1–64 letters, digits, underscores or hyphens, starting with a letter.',
      );
  } else if (options.idPrefix !== undefined || (options as { fonts?: string }).fonts === 'host')
    throw new TypeError('idPrefix and host fonts require target: inline.');
  if (options.fonts !== undefined && !['host', 'embed'].includes(options.fonts))
    throw new TypeError('fonts must be embed or host.');
  for (const key of ['title', 'description', 'styleNonce', 'sourceId'] as const)
    if (options[key] !== undefined && typeof options[key] !== 'string')
      throw new TypeError(`${key} must be a string.`);
  if (options.state !== undefined && options.state !== null && typeof options.state !== 'string')
    throw new TypeError('state must be a string or null.');
  if (options.includeSource !== undefined && typeof options.includeSource !== 'boolean')
    throw new TypeError('includeSource must be a boolean.');
  if (options.colorScheme !== undefined && !['light', 'dark', 'auto'].includes(options.colorScheme))
    throw new TypeError('colorScheme must be light, dark or auto.');
  const links = options.links;
  if (links !== undefined) {
    if (!links || !['none', 'safe'].includes(links.mode))
      throw new TypeError('links.mode must be none or safe.');
    if (links.mode === 'safe') {
      if (links.target !== undefined && !['_self', '_blank'].includes(links.target))
        throw new TypeError('links.target must be _self or _blank.');
      if (links.resolve !== undefined && typeof links.resolve !== 'function')
        throw new TypeError('links.resolve must be a function.');
      if (links.baseUrl !== undefined && !httpUrl(links.baseUrl))
        throw new TypeError('links.baseUrl must be an absolute HTTP(S) URL.');
    }
  }
}

function httpUrl(value: string, base?: string): string | null {
  if (
    typeof value !== 'string' ||
    [...value].some(c => c.charCodeAt(0) <= 0x20 || c.charCodeAt(0) === 0x7f)
  )
    return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A link in note or footnote text: kept only as a safe HTTP(S) URL under a safe policy. */
export const textLink = (options: RenderOptions) => (href: string) =>
  options.links?.mode === 'safe' ? httpUrl(href, options.links.baseUrl) : null;

/** The host resolves first; final validation never trusts the callback or authored link-base. */
export function applyLinks(doc: Diagram, options: RenderOptions): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const item of [...doc.graph.nodes, ...doc.graph.groups]) {
    if (!item.href) continue;
    const links = options.links;
    const resolved =
      links?.mode === 'safe'
        ? links.resolve
          ? links.resolve({ itemId: item.id, href: item.href })
          : item.href
        : null;
    const url =
      resolved === null
        ? null
        : httpUrl(resolved, links?.mode === 'safe' ? links.baseUrl : undefined);
    if (url) item.href = url;
    else {
      delete item.href;
      if (links?.mode === 'safe')
        diagnostics.push({
          severity: 'warning',
          code: 'DRAFT_LINK_BLOCKED',
          message: 'The host link policy blocked this destination.',
          itemIds: [item.id],
        });
    }
  }
  return diagnostics;
}
