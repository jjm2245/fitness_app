// Human-facing label for a program day. Day names are seeded as slugs
// (chest_triceps, legs_shoulders, …); this renders them for people:
// "chest_triceps" → "Chest + triceps". Underscores in the seed convention join
// a muscle pair, so they become " + "; the first letter is capitalized
// (sentence case). A name with no underscore just gets capitalized. Applied
// where a session's origin is set, so the stored label is already human — the
// program identifier never leaks into the sessions list.
export function prettyDayName(name: string): string {
  const s = name.trim().replace(/_/g, " + ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
