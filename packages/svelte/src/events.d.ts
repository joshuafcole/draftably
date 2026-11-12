import type { HTMLAttributes } from 'svelte/elements';
import type { HostEventDetail, HostEventName, HostEvents } from '@draftably/runtime/host';

export type { HostEventDetail, HostEventName, HostEvents };

/**
 * `oncamera`, `onselect`, … : each receives the event's `detail`. `onlink` and `oncontextmenu`
 * also get `preventDefault()`.
 */
export type HostEventProps = {
  [K in HostEventName as `on${K}`]?: (detail: HostEventDetail<K>) => void;
};

export function listenHostEvents(node: HTMLElement, props: Record<string, unknown>): () => void;

export function elementAttributes(rest: Record<string, unknown>): Record<string, unknown>;

export function applyAttributes(node: HTMLElement, attributes: Record<string, unknown>): () => void;

/** The DOM attributes a component passes to its element, such as `data-theme`, `id` or `aria-*`. */
export type ElementAttributes = Omit<
  HTMLAttributes<HTMLElement>,
  keyof HostEventProps | 'children' | 'class' | 'style'
>;
