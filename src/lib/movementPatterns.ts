// UI-side movement-pattern vocabulary + a name-based auto-suggestion, used by
// the movement-pattern-on-add flow (Part B). This is data the deterministic
// core reads, not engine logic — the core stays general and untouched. Keep the
// list in sync with movementPatternEnum in schema.ts.

export const MOVEMENT_PATTERNS: { value: string; label: string }[] = [
  { value: "squat", label: "Squat" },
  { value: "hinge", label: "Hinge" },
  { value: "knee_extension", label: "Knee extension" },
  { value: "knee_flexion", label: "Knee flexion (leg curl)" },
  { value: "hip_adduction", label: "Hip adduction" },
  { value: "hip_abduction", label: "Hip abduction" },
  { value: "plantarflexion", label: "Plantarflexion (calf)" },
  { value: "horizontal_push", label: "Horizontal push" },
  { value: "incline_push", label: "Incline push" },
  { value: "vertical_push", label: "Vertical push (overhead)" },
  { value: "dip", label: "Dip" },
  { value: "horizontal_pull", label: "Horizontal pull (row)" },
  { value: "vertical_pull", label: "Vertical pull (pulldown/pull-up)" },
  { value: "shrug", label: "Shrug" },
  { value: "lateral_raise", label: "Lateral raise" },
  { value: "rear_delt_fly", label: "Rear-delt fly" },
  { value: "chest_fly", label: "Chest fly" },
  { value: "elbow_flexion", label: "Elbow flexion (curl)" },
  { value: "elbow_extension", label: "Elbow extension (triceps)" },
  { value: "spinal_extension", label: "Spinal extension (back extension)" },
  { value: "trunk_flexion", label: "Trunk flexion (crunch)" },
  { value: "trunk_rotation", label: "Trunk rotation" },
  { value: "conditioning", label: "Conditioning (cardio)" },
];

const PATTERN_LABEL = new Map(MOVEMENT_PATTERNS.map((p) => [p.value, p.label]));
export function movementPatternLabel(value: string | null): string {
  if (!value) return "untagged";
  return PATTERN_LABEL.get(value) ?? value;
}

// Ordered, specific-before-generic name → pattern rules. First hit wins, so a
// "cable overhead triceps extension" resolves to elbow_extension (triceps)
// before the generic "extension". Returns null when nothing matches (the user
// then picks from the full list).
const RULES: [RegExp, string][] = [
  [/leg\s*extension|knee extension/, "knee_extension"],
  [/leg\s*curl|knee flexion|hamstring curl/, "knee_flexion"],
  [/adductor|adduction/, "hip_adduction"],
  [/abductor|abduction/, "hip_abduction"],
  [/calf|calve|plantar/, "plantarflexion"],
  [/hack squat|goblet|front squat|back squat|\bsquat\b/, "squat"],
  [/romanian|rdl|stiff.?legged|deadlift|good morning|hip hinge|hinge/, "hinge"],
  [/face pull|rear.?delt|reverse (pec|fly|machine fly)/, "rear_delt_fly"],
  [/lateral raise|side raise|side lateral|deltoid raise/, "lateral_raise"],
  [/shrug/, "shrug"],
  [/pec dec|butterfly|chest fly|\bfly(es)?\b|pec fly/, "chest_fly"],
  [/pushdown|skull|triceps? (extension|pushdown|kickback)|overhead (triceps|tricep)/, "elbow_extension"],
  [/curl/, "elbow_flexion"],
  [/pulldown|pull.?up|pullup|chin.?up|lat pull/, "vertical_pull"],
  [/\brow\b|seated row|cable row|bent.?over/, "horizontal_pull"],
  [/\bdip(s)?\b/, "dip"],
  [/incline (bench|press|chest)/, "incline_push"],
  [/overhead press|shoulder press|military|vertical press/, "vertical_push"],
  [/bench press|chest press|push.?up|pushup|floor press/, "horizontal_push"],
  [/back extension|hyperextension|spinal extension|superman/, "spinal_extension"],
  [/twist|russian|rotation|wood ?chop|oblique/, "trunk_rotation"],
  [/crunch|sit.?up|leg raise|knee raise|toe touch|cocoon|ab /, "trunk_flexion"],
  [/treadmill|stair|stairmaster|elliptical|bike|cycle|rower|row erg|walk|run|jog|cardio|conditioning/, "conditioning"],
];

export function suggestMovementPattern(name: string): string | null {
  const n = name.toLowerCase();
  for (const [re, pattern] of RULES) if (re.test(n)) return pattern;
  return null;
}
