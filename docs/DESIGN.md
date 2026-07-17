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

## Shared shell components (`src/components/shell/`)

`GlobalNav` · `SessionBar` (+ `restTimerBus`, the display-only timer bridge) ·
`LockedTile` · `ListCard`/`ListRow` (icon · name · live count · chevron).
Reuse these before writing new chrome.
