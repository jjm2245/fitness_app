# DESIGN.md — the design language (shell v1)

**What this is:** the visual contract for the UI redesign, established in the
phase-1 shell session (login, Home, Train, History, navigation). Phases 2–3
(session-log cards, editors) must build **on these tokens**, not invent new
ones. The tokens live as CSS custom properties in `src/app/globals.css` —
change them there, everywhere follows.

**Dark-first, single theme.** A personal gym app used one-handed on a phone:
no light mode, no theme flash. `color-scheme: dark`.

## Surfaces

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0A0A0C` | The base. Pages sit directly on it. |
| `--card` | `#141418` | Cards on base. |
| `--raised` | `#1C1C22` | Raised chrome: sheets, modals, inputs' chrome. |
| `--hairline` | `rgba(255,255,255,0.08)` | Borders. Hairlines, not boxes — avoid boxes-in-boxes. |

## Text

| Token | Value | Use |
|---|---|---|
| `--text` | `#F4F4F5` | Primary. |
| `--text-2` | `#A1A1AA` | Secondary. |
| `--text-3` | `#6B7280` | Muted / tertiary. |

Sentence case everywhere. Font weights **400/500 only**. Anything watched
mid-set (rest timer, weights) renders in **mono/tabular numerals**
(`--font-mono`, or `font-variant-numeric: tabular-nums`).

## Accent — one family, used with intent

Indigo → violet: `--accent #6366F1` → `--accent-2 #8B5CF6`;
`--accent-grad` is the gradient. **Gradients are accents on live/interactive
elements only** — the hero Start button (plus a soft radial glow behind it),
the primary CTA, the live rest timer. Never full-screen wallpaper.

Status: `--success #34D399` · `--warning #F59E0B` · `--danger #F87171`.

## Section hues (Home tiles + within each zone)

| Zone | Token | Value |
|---|---|---|
| Training | `--hue-training` | `#6366F1` (the accent) |
| Recovery | `--hue-recovery` | `#2DD4BF` (teal) |
| Nutrition | `--hue-nutrition` | `#F59E0B` (amber) |
| Body | `--hue-body` | `#F472B6` (pink) |
| Coach | `--hue-coach` | `#8B5CF6` (violet) |

Locked (future-phase) tiles render **muted with a small lock**, their hue at
low intensity (`color-mix(... 12–16%, transparent)` chips). Tap = one-line
"coming in a later phase" note. Future phases light tiles up **in place**.

## Shape & touch

Radii: `--radius 12px`, `--radius-lg 16px`, `--radius-pill` for chips.
Cards on base, not boxes-in-boxes (rows inside a card separate with
hairlines). Tap targets **≥44px**.

## Motion (light)

A press state on tiles/buttons (`transform: scale(0.98)`); the live rest
timer pulses gently (opacity, ~2.4s), honoring `prefers-reduced-motion`.
No parallax, no confetti.

## Navigation model

- **Global bottom nav** (Home / Train / Stats / More), persistent on every
  screen, rendered from the root layout (`GlobalNav`).
- **Session-bar exception:** during an active logging session the nav is
  replaced by the `SessionBar` — back chevron · live rest timer (mono,
  accent, pulsing when running, hidden idle) · **Finish (n)**. Deliberate
  mode switch: navigating vs. training.
- No per-screen ad-hoc link rows — the nav owns navigation.

## Legacy alias layer (phases 2–3 migration)

The pre-redesign screens consume `--background/--surface/--surface-2/
--foreground/--muted/--border`, which are **remapped as aliases** of the new
tokens in `globals.css`. That's why the old screens already sit on the new
palette without structural restyle. As each screen gets its phase-2/3 pass,
move it to the v1 names; when nothing consumes the aliases, delete them.

## CSS module conventions — specificity

Prefer **single-class selectors**. When a compound parent-child rule exists
(`.passcodeRow .passcode`), a later single-class override (`.passcodeRevealed`)
**silently loses** — specificity 0-2-0 beats 0-1-0, no error, no warning; the
fix just doesn't apply (this burned real time in polish round 2). Rules:
- State/variant overrides must **match the specificity** of the rule they
  override — if the base is compound, make the override compound too.
- After adding an override, verify the computed style actually changed
  (`getComputedStyle` in the console), not just that the class is present.
This matters most in the phase-2/3 card rebuilds, which will be variant-heavy.

## Shared shell components (`src/components/shell/`)

`GlobalNav` · `SessionBar` (+ `restTimerBus`, the display-only timer bridge) ·
`LockedTile` · `ListCard`/`ListRow` (icon · name · live count · chevron).
Reuse these before writing new chrome.

---

# Conventions established in the redesign + training arc

Everything below **describes what is built**, not what is planned. Each entry was
checked against shipped CSS and components while writing; where the app does
**not** actually follow a convention, that is stated as a gap rather than
smoothed over. An inaccurate style guide is worse than none.

## The tier system: label / value / hint

Every sheet, card and form field uses the same three levels:

1. **Label** — small, letter-spaced, uppercase, `var(--text-3)`. Names the thing.
2. **Value** — the prominent element. Full size, `var(--text-1)`.
3. **Hint** — smaller, muted, sits *below* the value. Explains or qualifies.

`.fieldLabel` / `.fieldInput` / `.fieldNote` in `editors.module.css` are the
canonical trio; `.sectionLabel` is the group-level version of tier 1.

**The failure it fixes is specific:** without it a form reads as *"everything is
the same size but some of it is capitalised."* Three levels of contrast is what
makes a dense sheet scannable — the eye lands on values and only reads labels
when it needs to. If a new surface feels flat, this is almost always what's
missing.

## Entry surfaces are bottom sheets

Add-exercise, new unit, target, session note, weigh-ins and timeline notes all
open as bottom sheets (`components/session/Sheet.tsx`).

**Inline expansion that pushes content down is rejected.** It moves the page
under the user's thumb at the moment they are reaching for it — the concrete case
was the session note editor, which displaced the Log button mid-session. A sheet
overlays; nothing behind it moves.

**The one accepted exception** is a row expanding *inside a list the user already
opted into* — tapping a logged set reveals Edit / Delete / + Drop beneath it.
That differs because the tap and the revealed controls are the same gesture in
the same place: the user pointed at that row, and what appears is about that row.
The rejected pattern moves something the user was *already aiming at* for a
reason unrelated to their tap.

## Colour carries meaning, and the meanings don't overlap

| Colour | Token | Means |
|---|---|---|
| Gradient indigo→violet | `--accent-grad` (`#6366f1 → #8b5cf6`) | The primary action, and *"this is the special one"* — the PR chip, with a soft glow |
| Amber | `--warning` `#f59e0b` | Warning and required-field state — stack ceilings, missing anchors, pending sync |
| Green | `--success` `#34d399` | Active / success — the `active` program badge, logged-set checks, a synced dot |
| Muted | `--text-2` / `--text-3` | Informational, absent, or secondary |

**PRs deliberately do not use gold.** Amber already means *warning* here, and a
celebration in that hue would fight it — the eye would have to disambiguate
"achievement" from "problem" by shape alone. The gradient was already the
app's "special" signal (primary buttons), so the PR chip extends it rather than
introducing a fifth colour.

> **⚠ Gap found while writing this.** `--hue-nutrition` is `#f59e0b` — **byte
> identical to `--warning`**. Amber therefore carries two meanings in the token
> set: the warning state, and the Nutrition domain hue (Home/Stats locked tiles,
> and the `illness` timeline-note kind). They don't currently collide *visually*
> because they never share a surface, but the claim "the meanings don't overlap"
> is true of usage, not of the tokens. Worth resolving before Nutrition ships and
> amber starts appearing on live content next to real warnings.

## Affordance grammar

| Marker | Means | Rule |
|---|---|---|
| `›` chevron | Navigates somewhere | Never on something that only expands in place |
| `+` | Adds | Distinct from navigation |
| Grip (`⋮⋮` / dots) | Drag to reorder | **Leftmost**, always |

Grips sit leftmost — verified in both places they exist: the program editor
(`DayEditorView`, grip is the first child of `.row`) and the session card
(`.cardGrip`, first child of `.headRow`, before the done checkbox).

**A grip never sits beside the `⋯` menu.** Two different gestures shouldn't be
neighbours: one wants a press-and-drag, the other a tap, and adjacent targets
make each a plausible mis-hit for the other. The grip owns the left edge, `⋯`
owns the right.

## Annotations don't get card chrome

Sessions are **opaque rows**; annotations are the **connective tissue between
them**. Timeline notes render as rails down the History gutter with an inline
pill, never as tiles — an earlier tile treatment was built and removed, because a
bordered box made a note read as another session. The session note is a line
under the title with a `✎` glyph, not a subheading: no "Note:" label (the glyph
carries it) and no "see note" button (hiding the content defeats the point).

## Rows go quiet when context already says the kind

Badges were removed from the exercises list once the view selector said
**Library / Renamed / Custom** — the tab already answers what a badge on every
row would repeat. The subline carries `kind · muscle · equipment · N logged`
instead, which says something the tab cannot.

**One inline marker survived**: a small dot on a personalised library row
(`.renamedDot`, shown only in the Library tab). It marks the one case the tab
*doesn't* disambiguate — a library exercise the owner has renamed.

## Required fields: `*` plus an error state

Not verbose "required" / "optional" labels, which eat width on a 390px screen for
something an asterisk conveys. The field errors on save and says what's wrong in
words at that point.

**Where two fields satisfy a requirement together, the asterisk goes on the
group.** The target sheet's metric branch reads `* at least one of duration or
distance` above the pair, rather than marking both fields required when either
alone suffices.

## Numeric input

- **Tappable unit labels** — the `lb`/`kg` and `mi`/`km` toggles are the label
  itself, not a separate control.
- **Integer-digit caps**, not `maxLength`: 4 by default, tighter where semantics
  make one obvious (reps 3, incline/level 2, target sets 2). A cap on characters
  would reject `177.5`.
- **Decimals preserved** — the input owns its display text, because parents store
  numbers and `Number("177.")` drops the point mid-typing.
- **Keystrokes are refused, not corrected.** Over the cap, the field keeps its
  previous value and the digit simply doesn't appear. The field never shows
  something it won't keep.
- **Tap-to-replace** — focusing selects the contents, so typing replaces a
  default rather than appending to it.

> **⚠ Gap found while writing this.** The convention is often stated as *"mono
> face so values read as data"*, and that is **not what shipped for entry
> inputs**. `.cellInput` and `.fieldInput` use `font-variant-numeric:
> tabular-nums` (which aligns digits) but the default UI face. Mono
> (`--font-mono`) is reserved for **standalone numeric displays**: the rest timer
> (`.timerDigits`, `.timerHeldDigits`), the `best` line (`.bestLoad`), stat
> values (`.statValue`), the session-bar and rest-pill counters. Logged set rows
> (`.setMain`) are also not mono. Either the rule is "mono for read-only numeric
> displays, tabular-nums for entry" — which is defensible and is what exists — or
> the inputs are inconsistent. **Decide before the next UI round;** don't assume
> the mock's mono inputs are what's built.

## Absence is stated, never a placeholder zero

A missing value renders as words, never as `0` — a zero claims a measurement that
was never taken, which is the same NULL-is-not-a-default rule the data model
follows.

> **⚠ Consistency gap.** The *principle* holds everywhere, but the *rendering*
> is not unified. Settings → About you uses `not set` in muted italic
> (`.aboutUnset`). The session card uses `— no prior data`; rest edges use
> `rest —`; equipment fields use `unknown` as placeholder text. All are honest,
> none is a fake zero, but a fresh reader should not expect one canonical
> treatment. Unifying is a real (small) improvement available whenever the next
> UI round touches these.

## Advisories never block

Warnings — above-stack load, unit slip, an edit that rewrites logged history —
are **one tap to proceed** and **silent in the normal case**. None is a modal
that must be cleared before continuing.

The reasoning: a warning the user learns to dismiss reflexively is worse than no
warning, because it costs attention on every appearance and buys nothing on the
one that matters. Silence in the ordinary case is what preserves the signal. The
absurd-load advisory was **removed** for this reason and replaced with input
caps — prevention beats commentary.

## Nothing shifts on open

Sheets, chips and the PR wash all render without moving content behind them.

This is **proven by measurement, not by eye**: the PR wash was verified with
`document.scrollHeight` 964 → 964 and `scrollY` 0 → 0 across a real logged PR,
and the timeline note sheet was checked the same way. The PR moment animates only
`background`, `border` and `box-shadow` — never a property that reflows. When
adding a celebratory or transient element, measure it; "it looks fine" has been
wrong here before.

## Navigation model — and why

**Home · Train · Stats** in the bottom nav. Settings sits behind a gear in Home's
header.

The reasoning matters more than the layout: **nav slots are for frequent, direct
destinations, so infrastructure doesn't get one.** Settings is visited rarely and
deliberately; spending a quarter of the primary navigation on it would price a
constant cost against an occasional need.

- **The freed fourth slot is reserved for Nutrition** if it ships — a domain with
  daily entry earns a slot in a way Settings doesn't.
- **Recovery belongs as a Home card, not a tab.** It is *glanceable* rather than
  *navigable*: the useful interaction is reading one number, not entering a
  section and moving around inside it.
- **The "More" overflow pattern is rejected.** If a fifth domain appears, the
  answer is to consolidate related ones — not to add a two-tier hierarchy that
  makes every item below the fold equally hard to reach and teaches the user that
  the nav is incomplete.
