/** Event props from the runtime's one list of events: a new event adds no lines here. */
import {
  HOST_EVENTS,
  hostDetail,
  type HostEventDetail,
  type HostEventName,
  type HostEvents,
} from '@draftably/runtime/host';
import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react';

export type { HostEventDetail, HostEventName, HostEvents };

const propName = (name: string) => `on${name[0].toUpperCase()}${name.slice(1)}`;

/**
 * `onCamera`, `onSelect`, … : each receives the event's `detail`. `onLink` and `onContextmenu`
 * also get `preventDefault()`.
 */
export type HostEventProps = {
  [K in HostEventName as `on${Capitalize<K>}`]?: (detail: HostEventDetail<K>) => void;
};

/** The event prop names, which the components keep off the element. */
export const EVENT_PROPS = new Set<string>(HOST_EVENTS.map(name => propName(name)));

/**
 * Every prop but the component's own and its event props, so `data-theme`, `id`, `aria-*` and
 * React's own handlers such as `onClick` reach the element.
 */
export function elementProps(props: object, own: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !own.includes(key) && !EVENT_PROPS.has(key)),
  );
}

/** The DOM attributes a component passes to its element. */
export type ElementAttributes = Omit<
  HTMLAttributes<HTMLElement>,
  keyof HostEventProps | 'children'
>;

/** Runs before the element's mount microtask on the client, and not at all on the server. */
export const useBeforeMount = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Listen once for every host event; each call reads the latest prop. */
export function useHostEvents(el: RefObject<HTMLElement | null>, props: HostEventProps) {
  const latest = useRef(props);
  latest.current = props;
  useBeforeMount(() => {
    const node = el.current;
    if (!node) return;
    const off = HOST_EVENTS.map(name => {
      const listen = (event: Event) => {
        const handler = (latest.current as Record<string, ((detail: unknown) => void) | undefined>)[
          propName(name)
        ];
        handler?.(hostDetail(event));
      };
      node.addEventListener(`draft-${name}`, listen);
      return () => node.removeEventListener(`draft-${name}`, listen);
    });
    return () => off.forEach(f => f());
  }, []);
}
