import { describe, it, expect } from "vitest";
import { rirToEffortTag, rirForEffortTarget, TARGET_EFFORT_OPTIONS, TARGET_EFFORT_LABEL } from "../targetEffort";

// effort_target is the authoritative tag; rir_target is kept as its projection
// (progression reads the number). These tests lock (1) the bucket that matches
// the migration backfill + the session-line display, (2) that a no-edit save
// keeps rir_target byte-identical (so existing rows never shift progression),
// and (3) that a changed tag writes a representative that re-buckets losslessly.
describe("targetEffort", () => {
  it("buckets rir_target → tag exactly as the migration backfill / session line do", () => {
    expect(rirToEffortTag(null)).toBeNull();
    expect(rirToEffortTag("")).toBeNull();
    expect(rirToEffortTag("0")).toBe("to_failure");
    expect(rirToEffortTag("1")).toBe("to_failure");
    expect(rirToEffortTag("2")).toBe("near_failure");
    expect(rirToEffortTag("3")).toBe("near_failure");
    expect(rirToEffortTag("4")).toBe("more_in_me");
    expect(rirToEffortTag("5")).toBe("more_in_me");
  });

  it("keeps rir_target byte-identical when the tag is unchanged (no-edit save)", () => {
    // tag === initialTag → return the ORIGINAL number untouched (progression
    // for existing rows never moves on deploy or a no-edit save)
    expect(rirForEffortTarget("more_in_me", "more_in_me", "5")).toBe("5"); // relaxed, prod value
    expect(rirForEffortTarget("near_failure", "near_failure", "2")).toBe("2"); // the 40 rows
    expect(rirForEffortTarget("to_failure", "to_failure", "1")).toBe("1");
    expect(rirForEffortTarget(null, null, null)).toBeNull();
  });

  it("writes a re-bucketable representative only when the tag changes", () => {
    expect(rirForEffortTarget("to_failure", "near_failure", "2")).toBe("0");
    expect(rirForEffortTarget("more_in_me", "near_failure", "2")).toBe("4");
    expect(rirForEffortTarget(null, "near_failure", "2")).toBeNull(); // effort cleared
    // each representative buckets back to the same tag → lossless
    expect(rirToEffortTag(rirForEffortTarget("to_failure", "near_failure", "2"))).toBe("to_failure");
    expect(rirToEffortTag(rirForEffortTarget("more_in_me", "near_failure", "2"))).toBe("more_in_me");
  });

  it("labels the easiest level 'Relaxed' in the target voice (session values kept)", () => {
    expect(TARGET_EFFORT_OPTIONS[0]).toEqual({ value: "more_in_me", label: "Relaxed" });
    expect(TARGET_EFFORT_LABEL.more_in_me).toBe("relaxed");
    expect(TARGET_EFFORT_LABEL.near_failure).toBe("near failure");
    expect(TARGET_EFFORT_LABEL.to_failure).toBe("to failure");
  });
});
