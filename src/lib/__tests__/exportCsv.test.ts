import { describe, it, expect } from "vitest";
import { csvField, csvRow, toCsv, exportFilename } from "../exportCsv";

describe("csvField", () => {
  it("leaves plain values unquoted", () => {
    expect(csvField("Pullups")).toBe("Pullups");
    expect(csvField(120)).toBe("120");
    expect(csvField(0)).toBe("0");
  });

  it("writes NULL as an EMPTY field, never a zero or the word null", () => {
    // The absence semantics this schema runs on (rest_seconds, built_in_weight,
    // equipment_id …) only survive the round trip if blank stays blank.
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    // 0 is a RECORDED zero and must stay distinguishable from absence.
    expect(csvField(0)).toBe("0");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(csvField(`Captain's "Chair"`)).toBe(`"Captain's ""Chair"""`);
  });

  it("quotes commas and newlines (a notes field can contain both)", () => {
    expect(csvField("felt heavy, cut short")).toBe(`"felt heavy, cut short"`);
    expect(csvField("line one\nline two")).toBe(`"line one\nline two"`);
    expect(csvField("cr\r\nlf")).toBe(`"cr\r\nlf"`);
  });

  it("quotes values with edge whitespace a naive parser would trim", () => {
    expect(csvField(" leading")).toBe(`" leading"`);
    expect(csvField("trailing ")).toBe(`"trailing "`);
  });

  it("serializes Dates as ISO instants", () => {
    expect(csvField(new Date("2026-07-26T15:04:05.000Z"))).toBe("2026-07-26T15:04:05.000Z");
  });
});

describe("csvRow / toCsv", () => {
  it("joins fields with commas", () => {
    expect(csvRow(["a", null, 3])).toBe("a,,3");
  });

  it("emits a header from the column keys, in column order", () => {
    const out = toCsv(
      [
        { key: "name", get: (r: { name: string; reps: number }) => r.name },
        { key: "reps", get: (r: { name: string; reps: number }) => r.reps },
      ],
      [{ name: "Pullups", reps: 8 }]
    );
    expect(out).toBe("name,reps\r\nPullups,8\r\n");
  });

  it("emits header-only for an empty set (a valid CSV, not an empty file)", () => {
    const out = toCsv([{ key: "name", get: (r: { name: string }) => r.name }], []);
    expect(out).toBe("name\r\n");
  });

  it("keeps every row the same width even when values are absent", () => {
    const cols = [
      { key: "a", get: (r: Record<string, unknown>) => r.a },
      { key: "b", get: (r: Record<string, unknown>) => r.b },
      { key: "c", get: (r: Record<string, unknown>) => r.c },
    ];
    const out = toCsv(cols, [{ a: 1 }, { b: 2 }, { c: 3 }]);
    const widths = out.trimEnd().split("\r\n").map((l) => l.split(",").length);
    expect(widths).toEqual([3, 3, 3, 3]);
  });
});

describe("exportFilename", () => {
  it("dates the file by the LOCAL day the button was pressed", () => {
    // Constructed from local parts on purpose: an ISO-Z literal would be a
    // different calendar day in half the world's timezones, and the file is
    // named after the owner's day.
    const d = new Date(2026, 6, 26, 21, 30);
    expect(exportFilename("export", "json", d)).toBe("fitness-agent-export-2026-07-26.json");
    expect(exportFilename("sets", "csv", d)).toBe("fitness-agent-sets-2026-07-26.csv");
  });

  it("zero-pads month and day", () => {
    expect(exportFilename("export", "json", new Date(2026, 0, 5))).toBe("fitness-agent-export-2026-01-05.json");
  });
});
