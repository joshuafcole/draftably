import { Show } from 'solid-js';
import { LINK_MARK_PATH, type LinkMark } from '../../model/link';
import { useSessionIfAny } from '../session-context';

/**
 * The arrow that says an object is a link. On the editor canvas it is also the button that opens
 * the link, so a click elsewhere on the object still only selects it.
 */
export function LinkMarkView(props: {
  mark: LinkMark;
  href: string;
  color: string;
  interactive?: boolean;
}) {
  const s = useSessionIfAny();
  const m = () => props.mark;
  return (
    <g
      class="link-mark"
      transform={`translate(${m().x},${m().y})`}
      data-open-link={props.interactive ? props.href : undefined}
    >
      <Show when={props.interactive}>
        <rect
          class="link-hit"
          x={-5}
          y={-5}
          width={m().size + 10}
          height={m().size + 10}
          rx={5}
          aria-label={s ? s.describeLink(props.href) : props.href}
        />
      </Show>
      <path
        d={LINK_MARK_PATH}
        transform={`scale(${m().size / 10})`}
        fill="none"
        stroke={props.color}
        stroke-width={1.4}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
  );
}
