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
//
// HYDRATION: the initial state is the SSR DEFAULT, not the stored preference,
// and the stored value is adopted in an effect instead. Seeding from
// localStorage during render made the client's first render disagree with the
// server HTML, and React's response to that mismatch is "this won't be patched
// up" — which left the toggle PERMANENTLY highlighting `lb` while every value
// on the page rendered in `kg`. The control lied about its own state. One
// extra render with the default is the price, and it is the right one.
export function useWeightUnit(): [WeightUnit, () => void] {
  const [unit, setUnit] = useState<WeightUnit>("lb");
  useEffect(() => {
    setUnit(getEntryUnit("weight"));
    return subscribeUnits(() => setUnit(getEntryUnit("weight")));
  }, []);
  const toggle = () => setEntryUnit("weight", getEntryUnit("weight") === "lb" ? "kg" : "lb");
  return [unit, toggle];
}

/** Same hydration rule as `useWeightUnit` — see the note there. */
export function useDistanceUnit(): [DistanceUnit, () => void] {
  const [unit, setUnit] = useState<DistanceUnit>("mi");
  useEffect(() => {
    setUnit(getEntryUnit("distance"));
    return subscribeUnits(() => setUnit(getEntryUnit("distance")));
  }, []);
  const toggle = () => setEntryUnit("distance", getEntryUnit("distance") === "mi" ? "km" : "mi");
  return [unit, toggle];
}
