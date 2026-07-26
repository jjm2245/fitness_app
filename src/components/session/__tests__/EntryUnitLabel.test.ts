import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EntryUnitLabel } from "../EntryUnitLabel";

// The indicator is READ-ONLY. Changing the display preference is a deliberate
// trip to Settings — it used to be a tap here, which gave a global setting the
// blast radius of a local control.
//
// Written without JSX so it runs under the existing `*.test.ts` / node config;
// renderToStaticMarkup needs no DOM.
const html = (p: Parameters<typeof EntryUnitLabel>[0]) => renderToStaticMarkup(createElement(EntryUnitLabel, p));

describe("entry-unit indicator", () => {
  it("renders no button in ANY state", () => {
    for (const p of [
      { unit: "lb", canonicalUnit: "lb" },
      { unit: "kg", canonicalUnit: "lb" },
      { unit: "kg", canonicalUnit: "lb", pinned: true },
      { unit: "km", canonicalUnit: "mi" },
    ]) {
      expect(html(p), JSON.stringify(p)).not.toContain("<button");
    }
  });

  it("a marked machine reads as a fact, not a mode", () => {
    expect(html({ unit: "kg", canonicalUnit: "lb", pinned: true })).toContain("kg · marked");
  });

  it("a non-canonical preference is visually distinct from the marked tag", () => {
    const loud = html({ unit: "kg", canonicalUnit: "lb" });
    const marked = html({ unit: "kg", canonicalUnit: "lb", pinned: true });
    expect(loud).not.toContain("· marked");
    // Different classes: one is a mode you're in, the other a machine's fact.
    expect(loud.match(/class="([^"]+)"/)?.[1]).not.toBe(marked.match(/class="([^"]+)"/)?.[1]);
  });

  it("the ordinary canonical case is quiet", () => {
    const out = html({ unit: "lb", canonicalUnit: "lb" });
    expect(out).not.toContain("· marked");
    expect(out).toContain("lb");
  });

  it("carries the optional prefix", () => {
    expect(html({ unit: "lb", canonicalUnit: "lb", label: "added" })).toContain("added lb");
  });
});
