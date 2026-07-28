// Rail geometry for the History timeline.
//
// The problem this solves: a dated note is a SPAN, and rendering it at a single
// point means the longer it runs the harder it is to find — backwards. So a
// note draws a rail down the gutter for its whole range.
//
// THE GEOMETRY IS PER-ROW, not absolute positioning. Each row renders its own
// short rail segment for every span active on that row's date, and contiguous
// segments visually join into one continuous line. That means variable row
// heights need no measurement, nothing has to be re-measured on resize, and a
// note can never displace a session — the gutter is a fixed column beside them.

export interface Span {
  id: number;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // null = still ongoing
  kind: string | null;
  notes: string;
}

/** Lanes are capped so the gutter stays narrow on a 390px screen. Past this,
 *  the overflow is SHOWN rather than silently dropped — see `overflowAt`. */
export const MAX_LANES = 3;

/** A gap shorter than this is ordinary training rhythm and gets no label. Seven
 *  days is deliberate: it is a whole week, it reads as obviously unusual, and
 *  it is a FIXED number rather than one derived from the owner's typical
 *  spacing. A derived threshold would move as habits change — a week off would
 *  stop being labelled during a period of already-sparse training, which is
 *  exactly when it matters most. Fixed is legible; adaptive is not. */
export const GAP_LABEL_DAYS = 7;

/** Inclusive day count between two YYYY-MM-DD dates, by calendar. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/** A span's effective end for layout — an open note runs to today. */
export function effectiveEnd(s: Span, today: string): string {
  return s.endDate ?? today;
}

/** Is this span covering `date`? Inclusive at both ends. */
export function coversDate(s: Span, date: string, today: string): boolean {
  return date >= s.startDate && date <= effectiveEnd(s, today);
}

/**
 * Pack spans into lanes so overlapping ones sit side by side.
 *
 * Greedy by start date: each span takes the lowest-numbered lane free for its
 * whole range. Non-overlapping spans reuse lane 0, so the common case (one note
 * at a time) never widens the gutter.
 *
 * Spans that would need a lane beyond MAX_LANES get lane `null` — the caller
 * renders them as an overflow count instead of dropping them. Losing one
 * silently would be the worst outcome: the note exists, the user wrote it, and
 * the screen would be lying.
 */
export function assignLanes(spans: Span[], today: string): Map<number, number | null> {
  // Oldest start first, so lane 0 belongs to whichever began earliest — the
  // long-running background context sits nearest the spine.
  const ordered = [...spans].sort((a, b) =>
    a.startDate === b.startDate ? a.id - b.id : a.startDate < b.startDate ? -1 : 1
  );
  // laneEnd[i] = the latest end date currently occupying lane i.
  const laneEnd: string[] = [];
  const out = new Map<number, number | null>();

  for (const s of ordered) {
    const end = effectiveEnd(s, today);
    let placed = false;
    for (let i = 0; i < laneEnd.length; i++) {
      // Free if this lane's occupant ended before this span starts.
      if (laneEnd[i] < s.startDate) {
        laneEnd[i] = end;
        out.set(s.id, i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      if (laneEnd.length < MAX_LANES) {
        laneEnd.push(end);
        out.set(s.id, laneEnd.length - 1);
      } else {
        out.set(s.id, null); // overflow — counted, never dropped
      }
    }
  }
  return out;
}

/** How many overflowed spans cover this date (rendered as "+N" in the gutter). */
export function overflowAt(spans: Span[], lanes: Map<number, number | null>, date: string, today: string): number {
  return spans.filter((s) => lanes.get(s.id) === null && coversDate(s, date, today)).length;
}

/**
 * The row at which a span's chip renders.
 *
 * History is NEWEST-FIRST, so a span "starts" in reading order at its most
 * recent end. An ongoing note therefore chips at the very top of the list and
 * its rail runs off the top edge — which is the entire point: an open note is
 * visible the moment the screen opens, without scrolling.
 *
 * Returns the index of the first row (in display order) the span covers, or -1
 * if it covers none — a note whose whole range predates every session still
 * needs somewhere to live, and the caller places those after the last row.
 */
export function chipRowIndex(s: Span, rowDates: string[], today: string): number {
  const covered = rowDates.findIndex((d) => coversDate(s, d, today));
  if (covered !== -1) return covered;
  if (rowDates.length === 0) return -1;
  // COVERS NO SESSION AT ALL — which is the norm for a short note in a quiet
  // week, and exactly the case that must not vanish. Chip it against the first
  // row OLDER than the note, so it still reads in the right chronological
  // place; if the note predates every session, chip it on the last row.
  const older = rowDates.findIndex((d) => d < s.startDate);
  return older === -1 ? rowDates.length - 1 : older;
}

/** `since Jun 28` · `Jul 19 – 20` · `Jul 5` — the chip's range label. */
export function rangeLabel(s: Span, fmt: (iso: string) => string): string {
  if (s.endDate == null) return `since ${fmt(s.startDate)}`;
  if (s.endDate === s.startDate) return fmt(s.startDate); // single day: no dash
  return `${fmt(s.startDate)} – ${fmt(s.endDate)}`;
}

/** `29 days` — DERIVED, never stored, so an open note's duration is always
 *  current rather than frozen at whatever it was when written. */
export function durationLabel(s: Span, today: string): string {
  const days = daysBetween(s.startDate, effectiveEnd(s, today)) + 1; // inclusive
  return days === 1 ? "1 day" : `${days} days`;
}
