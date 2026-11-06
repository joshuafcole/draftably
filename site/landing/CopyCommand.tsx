import { createSignal, For, onCleanup, Show } from 'solid-js';

/**
 * A shell command with a copy button. The icon turns to a check for a moment after a copy. If the
 * browser refuses the clipboard, the command text is selected so the user can copy it by hand.
 */
export function CopyCommand(props: { text: string; class?: string }) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let code!: HTMLElement;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
    } catch {
      getSelection()?.selectAllChildren(code);
      return;
    }
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), 1400);
  };
  onCleanup(() => clearTimeout(timer));
  return (
    <button
      type="button"
      class={`copy ${props.class ?? ''}`}
      classList={{ 'is-copied': copied() }}
      onClick={copy}
      aria-label={`Copy "${props.text}"`}
    >
      <span class="copy-prompt">$</span>
      {/* Each word stays whole, so a long command wraps at spaces, never after a hyphen. */}
      <code ref={code}>
        <For each={props.text.split(' ')}>
          {(word, i) => (
            <>
              {i() ? ' ' : ''}
              <span class="copy-word">{word}</span>
            </>
          )}
        </For>
      </code>
      <span class="sr-only" aria-live="polite">
        {copied() ? 'Copied' : ''}
      </span>
      <svg class="copy-icon" viewBox="0 0 16 16" aria-hidden="true">
        <Show when={copied()} fallback={<path d="M5.5 5.5V3h7.5v7.5h-2.5M3 5.5h7.5V13H3z" />}>
          <path d="M3.5 8.5l3 3 6-7" />
        </Show>
      </svg>
    </button>
  );
}
