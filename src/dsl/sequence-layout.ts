/**
 * The arithmetic of a sequence diagram's layout, apart from the scene it is applied to: where a
 * label that spans several lanes sits, where each lane stands, and how tall each phase is.
 * `sequenced` in `compile.ts` measures the text and calls these.
 */

/** A lower bound on a lane's centre: at least `room` past the centre of lane `from`. */
export type Hold = { from: number; room: number };

/**
 * The gap a distant message's label sits in, so it crosses no lifeline between its two ends.
 * `base` holds the lane centres that the headers alone give. The choice prefers a gap inside one
 * band, so the label covers no band's border, then a gap that already has room, then the gap
 * nearest the middle of the message, then the left one. Returns the left lane of the gap.
 */
export function labelSlot(
  base: number[],
  a: number,
  b: number,
  room: number,
  across: (lane: number) => boolean,
) {
  const mid = (base[a] + base[b]) / 2,
    slots = Array.from({ length: b - a }, (_, i) => a + i),
    cost = (i: number) => [
      across(i + 1) ? 1 : 0,
      base[i + 1] - base[i] >= room ? 0 : 1,
      Math.abs((base[i] + base[i + 1]) / 2 - mid),
      i,
    ];
  return slots.reduce((best, i) => {
    const [p, q] = [cost(best), cost(i)],
      at = p.findIndex((v, k) => Math.abs(v - q[k]) > 0.5);
    return at >= 0 && q[at] < p[at] ? i : best;
  });
}

/**
 * Lane centres from left to right: each lane takes the header gap from its neighbour, or what
 * holds it away from an earlier lane, if that is more.
 */
export function laneCentres(first: number, gaps: number[], holds: Hold[][]) {
  const centre = [first];
  for (let i = 1; i <= gaps.length; i++)
    centre.push(
      Math.ceil(
        Math.max(centre[i - 1] + gaps[i - 1], ...holds[i].map(h => centre[h.from] + h.room)),
      ),
    );
  return centre;
}

/** Half the height of an arrowhead, which a plain message draws below its row. */
const ARROW = 4;

/** What one event draws round its row: how far above it and how far below. */
export type EventInk = {
  id: string;
  /** The phase that lists the event, if one does. */
  phase?: string;
  /** Height of the label above the line; 0 with no label or for a self-message. */
  label: number;
  /** Ink above and below the row. */
  above: number;
  below: number;
  /** A self-message or a local action: the row after it must clear its ink. */
  tall: boolean;
  /** How far the event runs on down its lifeline, which the next row starts from. */
  drop: number;
};

export type RowRules = {
  /** Least distance between two rows. */
  row: number;
  /** Room between a tall event's ink and the next event's ink. */
  clear: number;
  /** Room between a phase band's edge and the ink inside it. */
  pad: number;
  /** Room between two phase bands. */
  gap: number;
};

/**
 * Rows from top to bottom, starting under the headers at `top`. A phase is one block: its band
 * starts `gap` under what came before, holds its events with `pad` round them, and is at least
 * as tall as its title needs. Events outside every phase keep the plain row rule.
 */
export function eventRows(
  events: EventInk[],
  top: number,
  titleHeight: (phase: string) => number,
  rules: RowRules,
) {
  const rows = new Map<string, number>(),
    bands = new Map<string, { y: number; h: number }>();
  let y = top,
    /** The bottom of the ink so far. */
    ink = top,
    /** The bottom of the last tall event's ink, or 0. */
    tall = 0,
    open: { id: string; y: number } | undefined;
  const close = () => {
    if (!open) return;
    const h = Math.max(ink + rules.pad, open.y + titleHeight(open.id)) - open.y;
    bands.set(open.id, { y: open.y, h });
    y = ink = open.y + h;
    tall = 0;
    open = undefined;
  };
  events.forEach((e, i) => {
    const first = i === 0 || events[i - 1].phase !== e.phase,
      lift = e.label ? e.label + 8 : 0;
    if (first) {
      close();
      if (e.phase) {
        // A band starts a gap under the headers, a band or a loose event.
        open = { id: e.phase, y: Math.ceil(ink + rules.gap) };
        y = open.y + Math.max(rules.row - 4, e.above + rules.pad);
      } else if (i) y = ink + Math.max(rules.row - 4, e.above + rules.pad);
      else y += Math.max(rules.row, lift);
    } else
      y = Math.max(
        y + Math.max(rules.row, lift),
        tall ? tall + rules.clear + e.above : 0,
        // A box or a loop keeps clear of the arrowhead on the row above it.
        e.tall ? ink + ARROW + rules.clear + e.above : 0,
      );
    y = Math.ceil(y);
    rows.set(e.id, y);
    tall = e.tall ? y + e.below : 0;
    ink = y + e.below;
    y += e.drop;
  });
  close();
  return { rows, bands, end: ink };
}

/** An event as activation bars read it: who sends to whom, its kind, and what it answers. */
export type SequenceEvent = {
  id: string;
  source: string;
  target: string;
  message?: string;
  replyTo?: string;
};

/**
 * A stretch in which a participant is at work on a call: from the event at index `start` to
 * the one at `end`, or a short stub when `end` is unset. `level` is 0, or more when the
 * participant took the call while another of its bars was open.
 */
export type ActivationSpan = {
  lane: string;
  call: string;
  start: number;
  end?: number;
  level: number;
};

/**
 * The activation bars of a sequence, read from its calls and their replies. A bar opens where a
 * participant receives a `call` from another and closes at the last reply that answers that
 * call. A call with no reply closes at the participant's next message to another, and without
 * one it is a stub. A call a participant sends to itself opens no bar.
 */
export function activationSpans(events: SequenceEvent[]): ActivationSpan[] {
  const spans: ActivationSpan[] = [];
  events.forEach((e, start) => {
    if (e.message !== 'call' || e.source === e.target) return;
    const later = events.map((x, i) => ({ x, i })).slice(start + 1),
      replies = later.filter(({ x }) => x.message === 'reply' && x.replyTo === e.id),
      next = later.find(({ x }) => x.source === e.target && x.target !== e.target),
      end = replies.length ? replies[replies.length - 1].i : next?.i,
      // Bars on one lane that are open at this row each take a level; this one takes the next free.
      taken = spans
        .filter(s => s.lane === e.target && (s.end ?? s.start) >= start)
        .map(s => s.level);
    let level = 0;
    while (taken.includes(level)) level++;
    spans.push({ lane: e.target, call: e.id, start, ...(end !== undefined ? { end } : {}), level });
  });
  return spans;
}
