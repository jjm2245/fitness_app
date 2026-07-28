import { describe, it, expect } from "vitest";
import {
  assignLanes,
  overflowAt,
  coversDate,
  chipRowIndex,
  rangeLabel,
  durationLabel,
  daysBetween,
  MAX_LANES,
  GAP_LABEL_DAYS,
  type Span,
} from "../timeline";

const TODAY = "2026-07-28";
const span = (id: number, startDate: string, endDate: string | null = null): Span => ({
  id,
  startDate,
  endDate,
  kind: null,
  notes: `note ${id}`,
});

describe("span coverage", () => {
  it("covers both endpoints inclusively", () => {
    const s = span(1, "2026-07-10", "2026-07-12");
    expect(coversDate(s, "2026-07-10", TODAY)).toBe(true);
    expect(coversDate(s, "2026-07-12", TODAY)).toBe(true);
    expect(coversDate(s, "2026-07-09", TODAY)).toBe(false);
    expect(coversDate(s, "2026-07-13", TODAY)).toBe(false);
  });

  it("an ONGOING span runs to today, not to its start", () => {
    const s = span(1, "2026-06-28", null);
    expect(coversDate(s, "2026-07-28", TODAY)).toBe(true);
    expect(coversDate(s, "2026-07-14", TODAY)).toBe(true);
    expect(coversDate(s, "2026-06-27", TODAY)).toBe(false);
  });

  it("a single-day span covers exactly one date", () => {
    const s = span(1, "2026-07-05", "2026-07-05");
    expect(coversDate(s, "2026-07-05", TODAY)).toBe(true);
    expect(coversDate(s, "2026-07-06", TODAY)).toBe(false);
  });
});

describe("lane packing", () => {
  it("keeps non-overlapping spans in lane 0 — the gutter never widens for free", () => {
    const lanes = assignLanes([span(1, "2026-07-01", "2026-07-05"), span(2, "2026-07-10", "2026-07-12")], TODAY);
    expect(lanes.get(1)).toBe(0);
    expect(lanes.get(2)).toBe(0);
  });

  it("puts overlapping spans in parallel lanes", () => {
    const lanes = assignLanes([span(1, "2026-07-01", "2026-07-20"), span(2, "2026-07-10", "2026-07-12")], TODAY);
    expect(lanes.get(1)).toBe(0);
    expect(lanes.get(2)).toBe(1);
  });

  it("lane 0 goes to whichever began EARLIEST, so long context sits nearest the spine", () => {
    const lanes = assignLanes([span(2, "2026-07-10", "2026-07-20"), span(1, "2026-07-01", "2026-07-25")], TODAY);
    expect(lanes.get(1)).toBe(0);
    expect(lanes.get(2)).toBe(1);
  });

  it("an ongoing span occupies its lane through today", () => {
    const lanes = assignLanes([span(1, "2026-06-28", null), span(2, "2026-07-20", "2026-07-22")], TODAY);
    expect(lanes.get(1)).toBe(0);
    expect(lanes.get(2)).toBe(1); // can't reuse lane 0 — span 1 is still open
  });

  it("OVERFLOWS past the cap rather than dropping — the note still exists", () => {
    const all = [
      span(1, "2026-07-01", "2026-07-30"),
      span(2, "2026-07-02", "2026-07-30"),
      span(3, "2026-07-03", "2026-07-30"),
      span(4, "2026-07-04", "2026-07-30"),
      span(5, "2026-07-05", "2026-07-30"),
    ];
    const lanes = assignLanes(all, TODAY);
    expect([lanes.get(1), lanes.get(2), lanes.get(3)]).toEqual([0, 1, 2]);
    expect(lanes.get(4)).toBeNull();
    expect(lanes.get(5)).toBeNull();
    // Counted, so the gutter can show "+2" instead of pretending they're gone.
    expect(overflowAt(all, lanes, "2026-07-10", TODAY)).toBe(2);
    expect(overflowAt(all, lanes, "2026-08-15", TODAY)).toBe(0);
    expect(MAX_LANES).toBe(3);
  });
});

describe("chip placement — newest-first reading order", () => {
  const rows = ["2026-07-25", "2026-07-20", "2026-07-14", "2026-07-01"];

  it("an ongoing note chips at the TOP row, so it's visible without scrolling", () => {
    expect(chipRowIndex(span(1, "2026-06-28", null), rows, TODAY)).toBe(0);
  });

  it("a closed span chips at its most recent covered row", () => {
    expect(chipRowIndex(span(1, "2026-07-13", "2026-07-21"), rows, TODAY)).toBe(1); // Jul 20
  });

  it("a span covering NO session still gets a chip — it must never vanish", () => {
    // The common case for a short note in a quiet week. Returning -1 here (the
    // first implementation) rendered nothing at all: a note the owner wrote,
    // stored, and could not see. Caught in the browser, not by this file.
    // It chips against the first row OLDER than the note, keeping chronology.
    expect(chipRowIndex(span(1, "2026-07-16", "2026-07-17"), rows, TODAY)).toBe(2); // Jul 14
    // Older than every session → the last row, so it still has a home.
    expect(chipRowIndex(span(1, "2026-05-01", "2026-05-02"), rows, TODAY)).toBe(3);
  });

  it("returns -1 only when there are no rows at all", () => {
    expect(chipRowIndex(span(1, "2026-07-01", null), [], TODAY)).toBe(-1);
  });
});

describe("labels", () => {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number);
    return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} ${d}`;
  };

  it("ongoing reads 'since', a range uses a dash, a single day has neither", () => {
    expect(rangeLabel(span(1, "2026-06-28", null), fmt)).toBe("since Jun 28");
    expect(rangeLabel(span(1, "2026-07-19", "2026-07-20"), fmt)).toBe("Jul 19 – Jul 20");
    expect(rangeLabel(span(1, "2026-07-05", "2026-07-05"), fmt)).toBe("Jul 5");
  });

  it("duration is inclusive and DERIVED — an open note's grows with today", () => {
    expect(durationLabel(span(1, "2026-06-28", null), "2026-07-26")).toBe("29 days");
    expect(durationLabel(span(1, "2026-07-19", "2026-07-20"), TODAY)).toBe("2 days");
    expect(durationLabel(span(1, "2026-07-05", "2026-07-05"), TODAY)).toBe("1 day");
  });

  it("day arithmetic is calendar-based, not millisecond drift across DST", () => {
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysBetween("2026-06-28", "2026-07-26")).toBe(28);
  });
});

describe("gap threshold", () => {
  it("is a fixed week — a rest day or two is ordinary rhythm", () => {
    expect(GAP_LABEL_DAYS).toBe(7);
  });
});
