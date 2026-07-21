import { describe, it, expect } from "vitest";
import { cardioFields, CARDIO_FIELD_KEY } from "../cardioFields";

// The one field-set source the session card, the editor target sheet, and the
// editor target chip all read. Locking it here keeps those three surfaces in
// agreement (the whole point of extracting it) and pins the Power Stairs case
// the fix was built around.
describe("cardioFields", () => {
  it("treadmill / walking / running → duration + speed + incline", () => {
    expect(cardioFields("Walking, Treadmill")).toEqual(["duration", "speed", "incline"]);
    expect(cardioFields("Jogging, Treadmill")).toEqual(["duration", "speed", "incline"]);
    expect(cardioFields("Trail Running/Walking")).toEqual(["duration", "speed", "incline"]);
  });

  it("stair / step machines → duration + level (Stairmaster and Power Stairs match)", () => {
    expect(cardioFields("Stairmaster")).toEqual(["duration", "level"]);
    expect(cardioFields("Power Stairs")).toEqual(["duration", "level"]);
    expect(cardioFields("Step Mill")).toEqual(["duration", "level"]);
  });

  it("bikes → duration + level + distance", () => {
    expect(cardioFields("Recumbent Bike")).toEqual(["duration", "level", "distance"]);
    expect(cardioFields("Bicycling, Stationary")).toEqual(["duration", "level", "distance"]);
  });

  it("rowers → duration + distance + level", () => {
    expect(cardioFields("Rowing, Stationary")).toEqual(["duration", "distance", "level"]);
  });

  it("anything else → duration + distance", () => {
    expect(cardioFields("Skating")).toEqual(["duration", "distance"]);
    // Known heuristic quirk (moved verbatim): "Prowler" contains "row", so it
    // falls into the rower set rather than the default. Documented, not fixed.
    expect(cardioFields("Prowler Sprint")).toEqual(["duration", "distance", "level"]);
  });

  it("maps duration to the duration_min jsonb key, others to their own name", () => {
    expect(CARDIO_FIELD_KEY.duration).toBe("duration_min");
    expect(CARDIO_FIELD_KEY.level).toBe("level");
    expect(CARDIO_FIELD_KEY.speed).toBe("speed");
    expect(CARDIO_FIELD_KEY.incline).toBe("incline");
    expect(CARDIO_FIELD_KEY.distance).toBe("distance");
  });
});
