/**
 * Which scheme a host's page asks for, and when that changes. The element's computed
 * `color-scheme` decides (a page sets it on `:root`, a dark class, or the element itself): `dark`
 * draws dark, and `light dark` draws dark while the user's system prefers dark. `normal` (nothing
 * declared) and `light` draw light, so a page that never opted in to dark stays light on a dark
 * system. A page opts in with `:root { color-scheme: light dark }`.
 */
const DARK = /\bdark\b/,
  LIGHT = /\blight\b/;

/** Watches one host's scheme. `check` reads it again now; `stop` ends the watch. */
export interface SchemeWatch {
  check(): void;
  stop(): void;
}

/**
 * Calls `onChange(dark)` now and whenever the scheme in `host` changes: an element, or a shadow
 * root, whose children inherit the element's scheme. A hidden probe in `host` has a `light-dark()`
 * color, so a scheme change anywhere above it (a class flip on the page, a style) starts a
 * transition there; the media query covers a change of system setting under `light dark`. A
 * transition cannot run while the host has no box (a hidden tab, a closed `<details>`, a detached
 * mount), so a resize observer on the host reads the scheme again when it gets one. Callers also
 * call `check` after each commit.
 */
export function watchColorScheme(
  host: Element | ShadowRoot,
  onChange: (dark: boolean) => void,
): SchemeWatch {
  const doc = host.ownerDocument,
    win = doc.defaultView;
  const media = win?.matchMedia?.('(prefers-color-scheme: dark)');
  const probe = doc.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.setAttribute('data-draft-probe', '');
  // `!important` keeps a page's `* { transition: none !important }` from stopping the probe.
  probe.style.cssText =
    'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;' +
    'color:light-dark(rgb(0,0,0),rgb(255,255,255));transition:color 1ms !important';
  host.append(probe);
  let last: boolean | undefined;
  const check = () => {
    const scheme = win?.getComputedStyle(probe).colorScheme ?? '',
      dark = DARK.test(scheme) && (!LIGHT.test(scheme) || !!media?.matches);
    if (dark === last) return;
    last = dark;
    onChange(dark);
  };
  // The probe's transition is the editor's own business, not the page's.
  const ran = (e: Event) => {
    e.stopPropagation();
    check();
  };
  probe.addEventListener('transitionrun', ran);
  media?.addEventListener?.('change', check);
  const box = host.nodeType === 11 ? (host as ShadowRoot).host : (host as Element);
  const sized = win && 'ResizeObserver' in win ? new win.ResizeObserver(check) : undefined;
  sized?.observe(box);
  check();
  return {
    check,
    stop() {
      sized?.disconnect();
      media?.removeEventListener?.('change', check);
      probe.removeEventListener('transitionrun', ran);
      probe.remove();
    },
  };
}
