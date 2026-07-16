import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Fails loudly (exit 1) if docs/CURRENT_STATE.md's auto-generated facts drift
// from the repo — same spirit as db:check. It regenerates the facts into a temp
// comparison (via docs-refresh's JSON side-output) and checks the doc's AUTOGEN
// block claims the current migration count. Run in CI / before shipping so the
// agent-facing docs can't silently rot. Judgment sections are not checked.
const ROOT = process.cwd();
const doc = readFileSync(join(ROOT, "docs/CURRENT_STATE.md"), "utf8");

const expected = Number(
  /EXPECTED_MIGRATIONS\s*=\s*(\d+)/.exec(readFileSync(join(ROOT, "src/lib/migrationStatus.ts"), "utf8"))?.[1] ?? "0"
);

const claimed = /`EXPECTED_MIGRATIONS = (\d+)`/.exec(doc)?.[1];
if (claimed == null) {
  console.error("✗ CURRENT_STATE.md AUTOGEN block missing — run `npm run docs:refresh`.");
  process.exit(1);
}
if (Number(claimed) !== expected) {
  console.error(
    `✗ CURRENT_STATE.md is STALE: it claims EXPECTED_MIGRATIONS = ${claimed}, code has ${expected}.\n` +
      `  Run: npm run docs:refresh`
  );
  process.exit(1);
}

// Belt-and-braces: regenerate and diff the whole AUTOGEN block. If refresh would
// change anything, the doc is stale.
const before = extract(doc);
execSync("npx tsx scripts/docs-refresh.ts", { cwd: ROOT, stdio: "ignore" });
const after = extract(readFileSync(join(ROOT, "docs/CURRENT_STATE.md"), "utf8"));
if (before !== after) {
  console.error("✗ CURRENT_STATE.md AUTOGEN block was out of date (now refreshed — commit it).");
  process.exit(1);
}

console.log(`✓ Docs in sync: ${expected} migrations claimed and present.`);

function extract(s: string): string {
  const m = /AUTOGEN:START[\s\S]*?AUTOGEN:END/.exec(s);
  return m ? m[0] : "";
}
