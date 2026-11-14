# Design system

Light only (dark mode was removed on request). The look lives in `frontend/src/styles.css`
(tokens, shared components, home and login); page files (`course.css`, `teacher.css`,
`godmode.css`, `cohort.css`, `grader.css`, `coach.css`) lay things out with the tokens.

## References

- **sarvam.ai**: soft "aura" colour washes behind heroes, an elegant light-weight display face,
  a framed panel that overlaps the hero like a product shot, pill buttons.
- **nike.com**: image-led tiles, very large heavy condensed type on the artwork.

## Rules

- **Artwork vs chrome.** Colour and drama live in two places only: `.aura` (blurred violet,
  coral and periwinkle washes; `.violet` and `.soft` variants) and `.cover` (week tile art, colours
  per week in `COVERS` in `Home.jsx`). Everything else is white surfaces, 1px borders and ink text.
- **Type.** Display: Bricolage Grotesque (`--display`) for h1/h2, page titles and big numbers;
  week covers use its condensed width (`font-stretch: 75%`) at 800. Body and UI: Inter.
- **Colour.** revrag.ai violet (`--accent` #6645EB) for links, focus, progress and selection;
  ink (`--ink`) for primary buttons; coral/peach only inside artwork.
- **Shape.** Buttons are pills; inputs 12px; cards 20px; hero panels 28px.
- **Inner pages** start with a `.page-band.aura.soft` header (week, teach, God mode).

## Tokens

Type `--fs-xs`…`--fs-4xl`, space `--sp-1`…`--sp-8` (4–64px), radius `--radius-xs` 8,
`--radius-sm` 12, `--radius` 20, `--radius-xl` 28. Colours: `--bg`, `--bg-soft`, `--surface`,
`--surface-2`, `--text`, `--muted`, `--border`, `--border-strong`, `--accent*`, `--ink*`, `--ok`/`--bad`/`--warn-*`.
