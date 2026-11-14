# Design system

The site's look lives in `frontend/src/styles.css` (tokens and shared components). Page files
(`course.css`, `teacher.css`, `godmode.css`, `cohort.css`, `grader.css`, `coach.css`) only lay
things out and must use the tokens, never raw colours or radii.

## Principles

- **Neutral first.** Surfaces are white/near-black with 1px borders. Violet (`--accent`, revrag.ai's
  #6645EB) marks what is interactive, selected or in progress, and nothing else.
- **No decoration for its own sake.** No gradients on text or surfaces, no glows, no hover lifts,
  no looping animation except a live call's waveform.
- **One way to do each thing.** Tabs are underlined, segmented controls are squared, status labels
  are small squared `.pill`s, lists of records are one bordered list with dividers, not a stack of cards.

## Tokens

| Group | Tokens |
|---|---|
| Type | `--fs-xs` 12, `--fs-sm` 13, `--fs-ui` 14, `--fs-md` 16, `--fs-lg` 18, `--fs-xl` 20, `--fs-2xl` 24, `--fs-3xl` 30, `--fs-4xl` 36 (px). Body copy 16, UI chrome 14. Headings 600 weight with slight negative tracking. |
| Space | `--sp-1`…`--sp-8`: 4, 8, 12, 16, 24, 32, 48, 64 px. |
| Radius | `--radius-xs` 6 (pills, chips), `--radius-sm` 8 (buttons, inputs), `--radius` 12 (cards, panels). Full round only for avatars, dots and progress tracks. |
| Colour | `--bg`, `--bg-soft`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border`, `--border-strong`, `--accent`, `--accent-strong`, `--accent-soft`, `--ink`, `--ok`/`--bad`/`--warn-*`. Light and `[data-theme="dark"]` sets; every text pair meets WCAG AA. |

## Components

`.btn` (+ `.primary` ink, `.accent` violet, `.ghost`, `.small-btn`), `.nav-link` (top bar),
`.card`, `.pill`, `.tabs`, `.notice` (`.ok`/`.warn`/`.error`), `.progress-bar`, `.empty`
(dashed box with an icon and one line), `.eyebrow` (small uppercase label, plain text).
Icons are inline 24×24 SVG strokes at 1.8–2px, `currentColor`.
