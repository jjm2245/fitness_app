import { describe, it, expect } from "vitest";
import { rirToEffortTag, effortTagToRirStore, TARGET_EFFORT_OPTIONS, TARGET_EFFORT_LABEL } from "../targetEffort";

// The target's effort model rides on the legacy numeric rir_target until the
// effort_target column lands. These tests lock (1) the bucket that must match
// the migration backfill, (2) byte-identical no-edit round-trip, and (3) that
// interim writes re-bucket to the same tag (so they migrate losslessly).
describe("targetEffort", () => {
  it("buckets rir_target → tag exactly as the migration backfill will", () => {
    expect(rirToEffortTag(null)).toBeNull();
    expect(rirToEffortTag("")).toBeNull();
    expect(rirToEffortTag("0")).toBe("to_failure");
    expect(rirToEffortTag("1")).toBe("to_failure");
    expect(rirToEffortTag("2")).toBe("near_failure");
    expect(rirToEffortTag("3")).toBe("near_failure");
    expect(rirToEffortTag("4")).toBe("more_in_me");
    expect(rirToEffortTag("5")).toBe("more_in_me");
  });

  it("preserves the original rir_target byte-identical on a no-edit save", () => {
    // tag unchanged from what the stored rir maps to → write the ORIGINAL string
    expect(effortTagToRirStore(rirToEffortTag("5"), "5")).toBe("5"); // relaxed, prod value
    expect(effortTagToRirStore(rirToEffortTag("2"), "2")).toBe("2"); // near failure, the common one
    expect(effortTagToRirStore(rirToEffortTag("1"), "1")).toBe("1"); // to failure
    expect(effortTagToRirStore(null, null)).toBeNull();
  });

  it("writes a re-bucketable representative when the tag changes", () => {
    expect(effortTagToRirStore("to_failure", "2")).toBe("0");
    expect(effortTagToRirStore("more_in_me", "2")).toBe("4");
    expect(effortTagToRirStore(null, "2")).toBeNull(); // effort cleared
    // and each representative buckets back to the same tag → lossless migration
    expect(rirToEffortTag(effortTagToRirStore("to_failure", "2"))).toBe("to_failure");
    expect(rirToEffortTag(effortTagToRirStore("more_in_me", "2"))).toBe("more_in_me");
  });

  it("labels the easiest level 'Relaxed' in the target voice (session values kept)", () => {
    expect(TARGET_EFFORT_OPTIONS[0]).toEqual({ value: "more_in_me", label: "Relaxed" });
    expect(TARGET_EFFORT_LABEL.more_in_me).toBe("relaxed");
    expect(TARGET_EFFORT_LABEL.near_failure).toBe("near failure");
    expect(TARGET_EFFORT_LABEL.to_failure).toBe("to failure");
  });
});
