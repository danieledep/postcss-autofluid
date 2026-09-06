# CLAUDE.md

Context for working on this repo. Read before changing `index.js`.

## What this is

A PostCSS plugin that runs *after* `@tailwindcss/postcss` and makes Tailwind's
responsive utilities fluid with zero markup changes. `mt-6 md:mt-8` interpolates
between 1.5rem and 2rem across the viewport; a lone `mt-6` stays 1.5rem.

## Why it's a post-processor and not a Tailwind plugin

This was investigated against the Tailwind v4 source (`packages/tailwindcss/src/compat/plugin-api.ts`):

- `matchVariant`'s callback is `(value, { modifier }) => string | string[]`. It never
  receives the utility's AST, so a variant cannot know which property it wraps.
  The v3 `container` / `modifySelectors` escape hatch is gone — `addVariant` only
  accepts `string | string[] | CssInJs`.
- Variants *can* inject declarations (a returned string ending in `}` is parsed as
  CSS and `@slot` is injected), but they can't rename the utility's declaration.
- `matchUtilities` knows the property and value but not the breakpoint.
- CSS cannot compose custom-property names at runtime, so the two halves can't be
  glued together in the browser either.
- v4's Oxide scanner is plain-text and has no custom extractor hook, so a `~`
  prefix is not viable anyway.

Tailwind's *output* is the first place breakpoint (media query) and property+value
(declaration) sit on the same node. So we read that. The plugin never needs
element context — each class publishes a uniquely named token and the cascade
assembles whatever co-occurs on an element.

## Design constraints — keep these

- Leave Tailwind's original rules untouched. Append twins; never mutate.
- A twin mirrors its original's cascade position exactly: same selector, same
  at-rule ancestors (`@layer` included), same relative order. That is what makes
  it win precisely where the original would have won. The only thing stripped is
  the breakpoint media — and only from the token, never from the property.
- One shared `@function --fl(...)` for the math. One thin `--fl-<prop>()` wrapper
  per property. One `@property … inherits: false` per *published* token. Size
  stays near-linear in the number of distinct utilities, not exponential in
  breakpoints. Twins exist only for properties that have at least one responsive
  value in the build; everything else is untouched. Measured on real codebases
  the appendix is ~75% twins, four base tokens for every responsive one, and
  costs +16–24% over the wire (numbers in the README). The base twins are the
  floor: without knowing the markup there is no way to tell which base utility
  will share an element with a responsive one.
- Everything inside `@supports (top: --fl())` so non-supporting browsers get
  plain Tailwind. There is deliberately no degraded middle state.
- Breakpoints and layers are discovered from the output, not configured.
- No dependencies beyond `postcss`. Tests use `node:test`; the browser test
  skips itself when `playwright` / `@tailwindcss/postcss` are absent.

## Things that looked fine and were not (all fixed, all covered by tests)

Found by rendering real Tailwind 4.3 and 3.4 output in Chromium 141 and diffing
computed styles against plain Tailwind at a dozen widths:

- Custom properties inherit. Without `@property … inherits: false`, a child with
  `mt-4` inside an `md:mt-8` parent got 32px.
- An unconditional twin for `md:px-12` set `padding-inline` to an invalid value
  below `md`, which reset `padding-left` from the `p-4` shorthand to 0. Hence:
  the property is only handed over inside the original's media.
- Unconditional twins outranked every same-specificity variant emitted earlier
  (`dark:`, `print:`, `max-md:`, `@md:`, `md:max-lg:`, class-based `dark:` via
  `:where()`) and every keyword (`md:mt-auto`). Hence: mirror the ancestors,
  re-assert keywords.
- Tailwind escapes a leading digit as `\32 ` (hex escape + space); `2xl:` was
  silently skipped.
- Tailwind v3 output is unlayered; a hard-coded `@layer utilities` would have
  ranked *below* it and never applied.

## Runtime assumptions — verified in Chromium 141

1. An unset `var(--x)` passed as a `@function` argument yields a
   guaranteed-invalid parameter, so `style(--param)` is false and the `var()`
   fallback chain engages.
2. Boolean-form `style(--param)` is accepted in `if()` inside a function body.
3. `@supports (top: --fl())` is true only where custom functions are supported.
4. `@function`, `@property` and `@layer` are all honoured inside `@supports`.
5. esbuild, Lightning CSS and cssnano keep the output semantically intact.

## Known limitation

`line-height` mixes unitless ratios and lengths across Tailwind's utilities.
`calc(<length> + (<number> - <length>) * …)` is invalid, so in any band whose
two nearest tokens differ in kind the property is invalid at computed-value
time and falls back to `unset` (inherited, for `line-height`). `leading-6
md:leading-none` is correct at `md`+ and inherits below. There is no CSS-level
fix short of knowing which theme variables are ratios; documented in the README.

## Semantics worth knowing

A non-breakpoint variant becomes the *base* token under its condition. That
matches Tailwind for every built-in media variant (ordered before breakpoints)
and differs for custom variants ordered after them (class-based `dark:`), where
plain Tailwind lets the variant win at all widths. Documented; not a bug.

## Possible next steps

- Container-query breakpoints (`@md:`) currently act as conditions on the base
  token. A second interpolator over `100cqw` would make them fluid too.
- A Vite/Lightning CSS pass after this plugin must not strip `@function`; the
  three common minifiers were checked, others were not.

## Origin

Continues the series at dan-webnotes.com: the July 2025 tilde-variant experiment and
PostCSS Clampwind. This repo is the version of that idea that needs no new syntax.
