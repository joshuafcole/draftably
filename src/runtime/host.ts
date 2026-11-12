/**
 * The host contract both elements share: the events they dispatch, as plain data. Framework
 * packages loop over `HOST_EVENTS`, so a new event adds no lines to any of them.
 * This module has no side effects and no runtime imports.
 */
import type { RenderFailure } from './types';
import type { UpdateResult, ViewerEvents } from './viewer';

export type { Camera, CameraReason, FrameOptions, MoveResult } from './camera';
export type { Box, EdgeOut, Geometry, PlacedBox } from './geometry';
export type { Anchor, DraftSlot } from './anchors';

export interface HostEvents {
  /** After each commit, after the marked children change, and with `[]` before destroy. */
  anchors: ViewerEvents['anchors'];
  /**
   * Each update's result, from the first source on: committed, error or a cancellation. The
   * editor's commit has no `value` or `diagnostics` (see `EditorUpdate`).
   */
  update: UpdateResult | EditorUpdate;
  render: ViewerEvents['render'];
  diagnostics: ViewerEvents['diagnostics'];
  camera: ViewerEvents['camera'];
  itemactivate: ViewerEvents['itemactivate'];
  /** Cancelable: `preventDefault()` on the DOM event stops Draftably opening the link. */
  link: Omit<ViewerEvents['link'], 'preventDefault'>;
  /** Cancelable: `preventDefault()` on the DOM event stops the browser's menu. */
  contextmenu: Omit<ViewerEvents['contextmenu'], 'preventDefault'>;
  /** The editor only: the selection changed, by the user or through `select()`. */
  select: { ids: readonly string[]; reason: 'user' | 'api' };
  /** The editor only: the source after a kept edit, undo or redo. */
  change: { source: string };
}

/**
 * `<draft-editor>`'s update. The editor draws in its own session, not as one SVG, so a commit
 * has no `value` and no `diagnostics`: the `diagnostics` event has them. A source that does not
 * parse is an `error` with a `DRAFT_PARSE` diagnostic; the editor keeps the text and shows it.
 */
export type EditorUpdate =
  | { status: 'committed'; revision: number; value?: never; diagnostics?: never }
  | { status: 'error'; revision: number; error: RenderFailure }
  | { status: 'destroyed'; revision: number };

export type HostEventName = keyof HostEvents;

/** Every event, in one list. Each element dispatches these as bubbling `draft-<name>` events. */
export const HOST_EVENTS = [
  'anchors',
  'update',
  'render',
  'diagnostics',
  'camera',
  'itemactivate',
  'link',
  'contextmenu',
  'select',
  'change',
] as const satisfies readonly HostEventName[];

/** Events a host can cancel with `preventDefault()`. */
export type CancelableEventName = 'link' | 'contextmenu';
export const CANCELABLE_EVENTS: readonly HostEventName[] = [
  'link',
  'contextmenu',
] satisfies readonly CancelableEventName[];

/**
 * What a framework event prop receives: the event's `detail`, and on a cancelable event a
 * `preventDefault()` that cancels the DOM event, so `onLink={e => e.preventDefault()}` works.
 */
export type HostEventDetail<K extends HostEventName> = K extends CancelableEventName
  ? HostEvents[K] & { preventDefault(): void }
  : HostEvents[K];

/** The value a framework event prop receives for a `draft-<name>` event. */
export function hostDetail(event: Event): unknown {
  const { detail } = event as CustomEvent<object>;
  return event.cancelable ? { ...detail, preventDefault: () => event.preventDefault() } : detail;
}

export type DraftEventMap = {
  [K in HostEventName as `draft-${K}`]: CustomEvent<HostEvents[K]>;
};

/** The element's `status` attribute. */
export type DraftStatus = 'loading' | 'ready' | 'error';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface HTMLElementEventMap extends DraftEventMap {}
}
