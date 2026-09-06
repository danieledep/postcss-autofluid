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
- One shared `@function --fl(...)` for the math. One thin `--fl-<prop>()` wrapper
  per property. One small twin rule per utility. Size should stay near-linear in
  the number of distinct utilities, not exponential in breakpoints.
- Everything inside `@supports (top: --fl())` so non-supporting browsers get
  plain Tailwind. There is deliberately no degraded middle state.
- Breakpoints are discovered from the output, not configured.
- No dependencies beyond `postcss`. Tests use `node:test`.

## Runtime assumptions that still need verifying in Chrome 140+

These are spec-level and could not be checked in the environment this was written in:

1. Passing an unset `var(--x)` as a `@function` argument yields a
   guaranteed-invalid parameter, so `style(--param)` is false and the `var()`
   fallback chain engages.
2. Boolean-form `style(--param)` is accepted in `if()` inside a function body.
3. `@supports (top: --fl())` is true only where custom functions are supported.

If 1 or 2 fails, the mechanical fix is: emit a parallel `--fl-<prop>-<bp>-w: <bp>`
width token on each twin, and replace the `if(style())` lookups in `--fl()` with
the same nested `var()` chains the values already use.

## Possible next steps

- A browser test (Playwright) that renders a fixture in Chromium and asserts
  computed `margin-top` at a few viewport widths.
- `max-*` variants, container queries (`@md:`), and `--tw-*` composed values are
  currently skipped by design; revisit only with a concrete need.
- A Vite/Lightning CSS pass after this plugin must not strip `@function`.

## Origin

Continues the series at dan-webnotes.com: the July 2025 tilde-variant experiment and
PostCSS Clampwind. This repo is the version of that idea that needs no new syntax.
