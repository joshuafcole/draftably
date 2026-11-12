/**
 * Server-only exports, with no `'use client'`. A React Server Component (Next.js App Router)
 * cannot call an export of the main entry, which is a client module.
 */
export { renderSvg } from '@draftably/runtime';
export type { RenderOptions, RenderResult } from '@draftably/runtime';
