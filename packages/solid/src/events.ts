/** Event props from the runtime's one list of events: a new event adds no lines here. */
import {
  HOST_EVENTS,
  hostDetail,
  type HostEventDetail,
  type HostEventName,
  type HostEvents,
} from '@draftably/runtime/host';
import type { JSX } from 'solid-js';

export type { HostEventDetail, HostEventName, HostEvents };

/**
 * `onCamera`, `onSelect`, … : each receives the event's `detail`. `onLink` and `onContextmenu`
 * also get `preventDefault()`.
 */
export type HostEventProps = {
  [K in HostEventName as `on${Capitalize<K>}`]?: (detail: HostEventDetail<K>) => void;
};

/** The event prop names, which the components keep off the element. */
export const EVENT_PROPS = HOST_EVENTS.map(
  name => `on${name[0].toUpperCase()}${name.slice(1)}` as keyof HostEventProps,
);

/** Listen for every host event on `node`; each call reads the latest prop. */
export function listenHostEvents(node: HTMLElement, props: HostEventProps) {
  for (const name of HOST_EVENTS) {
    const key = `on${name[0].toUpperCase()}${name.slice(1)}` as keyof HostEventProps;
    node.addEventListener(`draft-${name}`, event =>
      (props[key] as ((detail: unknown) => void) | undefined)?.(hostDetail(event)),
    );
  }
}

/** The DOM attributes a component passes to its element, such as `data-theme`, `id` or `aria-*`. */
export type ElementAttributes = Omit<
  JSX.HTMLAttributes<HTMLElement>,
  keyof HostEventProps | 'children' | 'ref' | 'class' | 'style'
>;

/**
 * Writes hyphenated names such as `data-theme` as attributes. On a custom element, Solid's spread
 * sets every other name as a property, so `data-theme` would become `el.dataTheme`.
 */
export function elementAttributes(rest: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [key.includes('-') ? `attr:${key}` : key, value]),
  );
}
