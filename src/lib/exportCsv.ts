// CSV serialization for the data export. Pure string work — no DB, no schema
// imports — so the escaping rules can be tested directly.
//
// Why CSV exists alongside the JSON: the JSON is the complete, restorable
// record; the CSV is the one table a person actually wants to open in a
// spreadsheet (`set_logs`, denormalized so the exercise and machine have
// names rather than ids).

/**
 * RFC-4180 field escaping.
 *
 * NULL is written as an EMPTY field, not the string "null" or a zero — the
 * absence semantics that run through this schema (`target_sets`, `log_fields`,
 * `built_in_weight`, `stack_unit`, `rest_seconds`) survive the round trip only
 * if "not recorded" stays visibly blank in the spreadsheet.
 */
export function csvField(v: unknown): string {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (s === "") return "";
  // Quote when the value contains a delimiter, a quote, any newline, or has
  // leading/trailing whitespace a naive parser would eat.
  if (/[",\r\n]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvField).join(",");
}

/**
 * A full CSV document: header row + one row per record, CRLF-terminated per
 * RFC 4180 (Excel is the likeliest reader and is happiest with CRLF).
 *
 * `columns` is the contract: the header labels AND the extraction order, so a
 * column can never silently drift out of alignment with its heading.
 */
export function toCsv<T>(
  columns: readonly { key: string; get: (row: T) => unknown }[],
  rows: readonly T[]
): string {
  const lines = [csvRow(columns.map((c) => c.key))];
  for (const r of rows) lines.push(csvRow(columns.map((c) => c.get(r))));
  return lines.join("\r\n") + "\r\n";
}

/**
 * `fitness-agent-export-2026-07-26.json` — dated so successive exports sort and
 * never silently overwrite each other in the Downloads folder.
 *
 * Local date, not UTC: the file is named after the day the owner pressed the
 * button, which after 7pm EDT is not the UTC day.
 */
export function exportFilename(kind: "export" | "sets", ext: "json" | "csv", now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return `fitness-agent-${kind}-${date}.${ext}`;
}
