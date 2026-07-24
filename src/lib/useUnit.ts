"use client";

import { useEffect, useState } from "react";
import {
  getEntryUnit,
  setEntryUnit,
  subscribeUnits,
  type DistanceUnit,
  type WeightUnit,
} from "./units";

// The ONE way a component reads/toggles a unit preference. Global per
// dimension: every mounted surface subscribes, so a toggle anywhere updates
// added weight, built-in display, reference lines, and cells together —
// they can never disagree. Pure display/entry preference; never writes data.
export function useWeightUnit(): [WeightUnit, () => void] {
  const [unit, setUnit] = useState<WeightUnit>(() => getEntryUnit("weight"));
  useEffect(() => subscribeUnits(() => setUnit(getEntryUnit("weight"))), []);
  const toggle = () => setEntryUnit("weight", getEntryUnit("weight") === "lb" ? "kg" : "lb");
  return [unit, toggle];
}

export function useDistanceUnit(): [DistanceUnit, () => void] {
  const [unit, setUnit] = useState<DistanceUnit>(() => getEntryUnit("distance"));
  useEffect(() => subscribeUnits(() => setUnit(getEntryUnit("distance"))), []);
  const toggle = () => setEntryUnit("distance", getEntryUnit("distance") === "mi" ? "km" : "mi");
  return [unit, toggle];
}
