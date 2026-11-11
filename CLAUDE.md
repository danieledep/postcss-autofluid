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
- One shared `@function --fl_<hash>(...)` for the math. One thin
  `--fl_<hash>-<name>()` wrapper per property. The hash is of the
  interpolator's text, so stylesheets with the same breakpoints share names
  and stylesheets with different ones don't redefine each other (functions are
  page-global; verified in Chromium 153 that a later `--fl()` with other
  parameters broke an earlier sheet's elements). Tokens and the
  `@supports (top: --fl())` check keep plain names. One
  `@property … inherits: false` per *published* token. Size stays near-linear in the number of distinct utilities, not exponential in
  breakpoints. Twins exist only for properties that have at least one responsive
  value in the build; everything else is untouched. Measured on real codebases
  the appendix is ~75% twins, four base tokens for every responsive one, and
  costs +16–24% over the wire (numbers in the README). The base twins are the
  floor: without knowing the markup there is no way to tell which base utility
  will share an element with a responsive one.
- Tokens and wrappers are named after the property's short name, not the
  property: `--fl-mt-48rem`, `--fl_<hash>-mt()`. `SHORT` in `lib/names.js`
  is the table: Tailwind's names (`px`, `max-w`, `rounded-tl`, `gap-x`),
  and `fs`, `lh`, `ls` for type, which Dan chose over `text`, `leading`,
  `tracking` and over index names (`--fl-7-48rem`: 3 to 5 points smaller,
  unreadable). A channel is `<name>` or `<name>-num` (`slug()` in
  `index.js`). A property outside the table keeps its full name, and
  `namer()` drops a short name when a listed property is really called
  that (`--w` next to `width`), so two properties never share tokens.
  The property name is written a few hundred times per build: measured
  12 to 17% of the appendix minified.
- A wrapper names only published tokens. The interpolator takes every
  breakpoint and stop, but most properties speak at few of them (about
  half the arguments were unpublished on real builds), and an unset
  variable is the same guaranteed-invalid argument under any name
  (assumption 1). The rest read `--<prefix>-0`, which nothing sets or
  registers. `published` is the single source for both the wrappers and
  the `@property` list, so the two cannot drift.
- Passing ahead values as wrapper arguments instead of tokens plus clears
  was measured (a further 14% minified on a token-driven build) and Dan
  declined it. Merging handover declarations into selector lists was
  measured too: 7 to 9% smaller minified, 5 to 10% larger after brotli.
- Everything inside `@supports (top: --fl())` so non-supporting browsers get
  plain Tailwind. There is deliberately no degraded middle state.
- Input arrives in two shapes. Tailwind flattens `@media { .sel { … } }` only
  when its optimizer runs; with it off (dev and watch builds) the query sits
  *inside* the rule. Both carry the same facts, so the walk starts at each
  declaration and climbs, which reads either. Never assume the breakpoint is an
  ancestor of the rule. Twins are always emitted flat.
- Group reuse is run-local, not global: a chain is reused only while it is still
  the most recent thing at its level, ignoring inert token-only rules. Merging
  two non-contiguous uses of one chain moves a twin backwards past rules it must
  beat. Tailwind's `.container` is the case that exposes this — it emits its own
  per-breakpoint blocks early, far from the variant blocks.
- Breakpoints are discovered from the output, not configured. Layers default
  to `['utilities']`: that is the fence that keeps authored CSS in
  `components`, `base` and unlayered sheets out. Dan chose the explicit list
  over `'auto'` (still accepted: utilities if present, else everything).
  Tailwind v3 output is unlayered, so it needs `null` or `'auto'`; when
  responsive values exist but no listed layer does, the plugin warns rather
  than emit nothing silently. Reading `components` too was measured on four
  real codebases at +0–2 points of size; a fixed component value then curves
  towards a responsive utility on the same element.
- The default scope is type and spacing: `DEFAULT_PROPERTIES` in
  `lib/options.js`, and absolute and font-relative `LENGTH_UNITS`. Dan chose
  this because a responsive value is often a switch, not a scale
  (`-translate-x-full lg:translate-x-0`, `opacity-0 md:opacity-100`,
  `w-full md:w-1/2`), and interpolating a switch shows states Tailwind never
  does. Everything else is an opt-in group in `GROUPS` (`include`):
  `percentages`, `viewport-units`, `container-units` add units; `borders`,
  `transforms`, `opacity` add properties; `all` is every group. There is no
  per-element opt-out by design; `!important` is the documented escape
  hatch, `exclude` the per-property one.
- Options are validated in `normalize()` and a bad one throws at creation
  with a `postcss-autofluid:` prefix. A single string is accepted
  for any list, a number for a width is px. `units` (removed after 0.4) throws
  with a pointer to `include`.
- Only lengths interpolate, plus unitless numbers on `NUMBER_PROPS`
  (`line-height`). `interpolable()` resolves `var()` through root custom
  properties (Tailwind emits used theme variables on `:root, :host`) and the
  rule's own custom properties (`space-y-*` sets `--tw-space-y-reverse`), and
  accepts arithmetic over the enabled units with at least one length.
  `calc()` mixes them, so the ends of a curve need not share a unit.
  Keywords, units not enabled, other unitless numbers and unresolvable
  variables are *fixed*: re-asserted verbatim, never tokenised.
- With `percentages` on, percentages interpolate everywhere, heights
  included. Known cost: in an auto-height parent a percentage height (or
  `top`, `flex-basis`) can't resolve and the whole `calc()` becomes auto, so
  `h-12 md:h-1/2` there is auto below md where Tailwind keeps 3rem. Dan chose
  this over keeping `%` fixed on those properties; it is documented in the
  README.
- Three more value kinds, by property: `RATIO_PROPS` (`opacity`, `scale`,
  `--tw-scale-*`) take numbers and `%` on one channel, with each `N%`
  published as `N/100` (the optimizer turns `opacity: 50%` into `.5`);
  `ANGLE_PROPS` (`rotate`, v3's `--tw-rotate`) take angles, zero as `0deg`.
- Tailwind composes translate and scale at runtime from per-axis variables
  (`translate: var(--tw-translate-x) var(--tw-translate-y)`), so those
  variables *are* the fluid properties: the twin sets
  `--tw-scale-x: --fl_<hash>-scale-x()` and Tailwind's own `scale:` declaration
  picks it up. Verified in Chromium: a custom function in a `syntax: "*"`
  variable evaluates on the element. Their names are Tailwind's
  (`scale-x`, `translate-y`; `lib/names.js`). `isTokenOnly` therefore checks the `--<prefix>-` prefix, not
  `--`, or a `--tw-*` value twin would count as inert and be skipped past.
  Transform functions (`--tw-rotate-x: rotateX(12deg)`) stay fixed.
- Tokens belong to a *channel*: the property itself for lengths,
  `<prop>-num` for numbers. Each channel has its own tokens and wrapper; a
  value of another channel (or a fixed one) at a breakpoint publishes a stop
  for every other channel of the property. Number tokens stay verbatim
  (`var(--tw-leading, …)`), so `leading-*` keeps winning over `text-*` at
  runtime exactly as in Tailwind.
- Container breakpoints are a second axis, keyed `c<width>`. The interpolator
  gets `@container` bands (`--clo`, `--chi`, …) next to the `@media` ones,
  with an outer default that holds the base when there is no container, and
  picks the axis per element: `--cq` (a non-inherited flag set under a
  matching container query), else viewport tokens, else container tokens.
  Without container breakpoints the output has none of this.
- A fixed value at a breakpoint is a wall. It publishes `--fl-<name>-<bp>-stop`
  (same conditions as a value token), and the interpolator's `--hi` checks
  `style(--s<bp>)` before `style(--v<bp>)` at each breakpoint above the band.
  Only boolean-form `style()` is used, the form verified below. A fixed base
  value needs no stop. Bands with no stop above them keep the plain `var()`
  chain, so output without walls is byte-identical to before.
- `sr-only` and `not-sr-only` are a switch (`SWITCH` in `lib/context.js`,
  matched on the end of the class name so variants and prefixes are
  covered). Every value they set is fixed: re-asserted, a wall at its
  breakpoint, never a token, and never the reason a property turns fluid.
  It is the one place a class name is read; the visually-hidden box
  (`width: 1px`, `margin: -1px`, `padding: 0`) is otherwise
  indistinguishable from a size.
- `UTILITY` also accepts `:where(.cls > :not(:last-child))`, the child
  selector `space-x-*` and `space-y-*` use. It is zero-specificity like
  class-based `dark:`, and the twin mirrors it exactly. No other child
  selector is read.
- The interpolator works on one value, so a multi-value shorthand is split into
  its longhands before anything else runs. A list with no known decomposition
  (`border-radius`) keeps its literal value. Any property in the set twins every
  lone-class rule that sets it, authored CSS included, so this guard is what
  keeps hand-written `padding: 0 20px` from collapsing to `unset`.
- A root variable redefined per breakpoint (`:root { --h1: 64px; @variant md
  { --h1: 96px } }`) makes the utilities that read it fluid, without the
  variable itself changing. Dan chose this over interpolating the variable
  on `:root`, which would reach every reader of it and so lose the property
  fence (`translate-x-(--my-var)`, `grid-cols-(--columns)`). The fluid
  declaration gets a token for its own breakpoint and one *ahead* for each
  breakpoint above where a variable it reads changes; the tokens read
  *copies* of the variable, `--fl--h1-48rem` (doubled dash: clear of every
  token name). `lib/variables.js` holds the rules:
  - Only the root makes a variable responsive: a base value there plus
    either a value under a breakpoint or one that reads a responsive
    variable (aliases, to a fixed point). Not any rule: Tailwind's `--tw-*`
    variables are set under `md:` on utilities all the time, and
    `var(--tw-leading, …)` must stay live.
  - A copy mirrors its declaration (selectors, nesting, wrappers, order,
    `!important`) minus the breakpoint, so the cascade settles copies as it
    settles the variable. Every declaration of a copied variable is copied,
    anywhere in the stylesheet, which is what makes
    `.section { --h1: 40px }` hold. Nothing inside `@keyframes`,
    `@function` or other non-wrapper at-rules: a copy would redefine them.
  - A declaration sets the copy at its own breakpoint, and at each one
    above where a variable it reads changes, and clears (`initial`) the
    rest above. A cleared copy makes the token that reads it invalid: no
    token, straight line. Setting every copy above to the same value
    instead was tried first and is simpler, but then a breakpoint only one
    scope uses (`sm:[--h1:40px]`) put a knot in every other heading's curve.
  - A value reading one variable at one of its breakpoints reads that copy
    alone. Between its breakpoints (`lg:p-xs`), or with several variables,
    each falls back through its copies below (`var(--c-48rem, var(--c-0))`)
    so the token always stands; otherwise an override that clears a copy
    takes the token with it and the value at that breakpoint is wrong.
  - Only copies some token reads are emitted (`used`, closed over aliases).
  - Everything else stays live and steps as in Tailwind: a value that
    changes kind between breakpoints, container tokens, non-fluid
    properties, variables only non-root rules change. Fail towards plain
    Tailwind, never towards a guess.
  - What the stylesheet does not contain cannot be copied: inline styles,
    JS, separately built stylesheets. Documented in the README gotchas.
- Tokens published ahead sit at their rule's place in the cascade, before
  every variant, so a later rule would not override them the way it
  overrides the property: `p-xs sm:p-0` came back to 16px at md. Every twin
  that hands over a family therefore clears (`initial`) the ahead tokens of
  that family at or above its breakpoint that it does not set itself
  (`early` in `index.js`). Keywords need none (they take the property) and
  container twins none (`--cq` picks the axis). Builds without responsive
  variables have no ahead tokens and their output is unchanged.
- Twins come after all of Tailwind, so the twin of a shorthand overrides a
  longhand original sorted after it (`p-4 pt-2`). `footprint()` in
  `lib/values.js` names the sides, axes and corners a property sets; any
  rule whose property shares one with a fluid property gets a twin that
  re-asserts its value, fluid or not.
- No dependencies beyond `postcss`. Tests use `node:test`; the browser test
  skips itself when `playwright` / `@tailwindcss/postcss` are absent, unless
  `BROWSER_TEST` is set. CI has a `browser` job that installs them and sets
  it. The browser test checks every group (`include: 'all'`) and the
  defaults.
- Layout: `index.js` is the plugin (walk, channels, stops, twins);
  `lib/options.js` defaults and validation; `lib/values.js` value
  classification; `lib/context.js` selector and breakpoint reading;
  `lib/names.js` the short names; `lib/variables.js` responsive root
  variables and their copies;
  `lib/interpolator.js` the shared function and its name.

## Things that looked fine and were not (all fixed, all covered by tests)

Found by rendering real Tailwind 4.3 and 3.4 output in Chromium 141 and diffing
computed styles against plain Tailwind at a dozen widths:

- Custom properties inherit. Without `@property … inherits: false`, a child with
  `mt-4` inside an `md:mt-8` parent got 32px.
- `w-64 md:w-full lg:w-96` rendered 923px and 441px between md and lg (should
  be 100%): `100%` is not a keyword, so it was tokenised and interpolated
  against `24rem`; and `md:mt-auto` let the band below bend towards `lg`.
  Hence the length-only fence and the stop tokens. (Percentages were later
  let back in on purpose: `md:w-full` now bends towards `lg:w-96`. The
  keyword half of the fix stands.)
- Tailwind's optimizer rewrites `calc(var(--spacing) * 0)` to a bare `0`. As
  a token, `0` inside `calc()` is a <number>, so the interpolation was invalid
  and `top-0`, `left-0`, `m-0`, `inset-0` fell back to `auto`/initial in every
  production build. Found on the showcase site. Zero tokens are now published
  as `0px`, and the browser test runs on optimized output as well as dev.
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
- Walking up from the *rule* missed every declaration in unoptimized Tailwind
  output, where the breakpoint is nested inside the rule. `props` came out
  empty and the plugin returned having emitted nothing — no error, no warning,
  and `@supports` made it look like ordinary lack of browser support. Measured
  on Tailwind 4.1.13: 6 responsive declarations, 0 `@function` blocks emitted.
  A no-op with responsive values present now warns.

- `md:` on an `@utility` with its own `@variant md` nests one breakpoint
  inside another. The inner query was kept as a condition on the token, which
  then sat inside `@media` while the outer token was appended after it flat,
  so the outer value won from md up. Implied min-width queries are not
  conditions, and `groupFor` never skips back past a token-only rule that
  publishes the same token for the same selector. In production the optimizer
  also merges identical bodies into lists (`.h1, .md\:h0`), which `UTILITY`
  rejected; lists are now split into their selectors.
- `rounded-[4px/8px]` emits `border-radius: 4px/8px` with no spaces, so it is
  one "part" and passed the length fence; as a token, `calc(4px/8px + …)` is a
  number and every corner went to 0. The optimizer strips the spaces from
  `4px / 8px` too. A top-level `/` now makes a value fixed.
- `mt-4 md:mt-8 @md:mt-12` showed the `md` value inside a matching
  container: the container value was a base token under its query, and the
  viewport token above it won. Hence the `--cq` flag.
- The optimizer folds `rounded-full`'s `calc(infinity * 1px)` into
  `2147483647px`, which then interpolated: `rounded-sm md:rounded-full` was a
  pill a few pixels above the base in production only. Lengths of `1e6` units
  or more (`HUGE`) are fixed.

- `w-24 lg:sr-only` shrank to 4px just below lg, `p-4 lg:sr-only` lost its
  padding on the way, and `sr-only md:w-40` was 136px wide (and still
  clipped) at 700px. Found in a real project's output: `.lg\:sr-only`
  published width, height, margin and padding tokens at 64rem. Hence
  `SWITCH`.
- `p-4 pt-2` rendered 16px on top in any build with a responsive `padding`
  and no responsive `padding-top`: `.pt-2` had no twin, and the twin of
  `.p-4`, appended after everything, overrode it. On main this hid behind
  real codebases having most longhands responsive somewhere. Hence
  `footprint()`.
- `--spacing-none: 0` as a token is `var(--spacing-none)`, which passed the
  written-zero check, and `calc(12px + (0 - 12px) * …)` is invalid:
  `p-xs md:p-none` had no padding below md. A zero is now looked for behind
  variables too, but only ones declared once, on the root: `--header: 0`
  that a layout class sets to `64px` must stay live.
- With responsive variables, `p-xs sm:p-0` returned to 16px at md and
  `mt-(--pad) md:mt-0` to 96px at lg (the variable's values, published
  ahead by the earlier rule). Hence the clearing of ahead tokens.

## Runtime assumptions — verified in Chromium 141 (and 153 for the stop tokens)

1. An unset `var(--x)` passed as a `@function` argument yields a
   guaranteed-invalid parameter, so `style(--param)` is false and the `var()`
   fallback chain engages.
2. Boolean-form `style(--param)` is accepted in `if()` inside a function body.
3. `@supports (top: --fl())` is true only where custom functions are supported.
4. `@function`, `@property` and `@layer` are all honoured inside `@supports`.
5. esbuild, Lightning CSS and cssnano keep the output semantically intact.
6. Vite runs `postcss.config.js` after `@tailwindcss/vite`, so the plugin slots
   in with no ordering work; but `css.transformer: 'lightningcss'` bypasses
   PostCSS entirely. Vite also warns about any node without a `source`, so
   every generated node carries one (twins point at their originals).
7. Verified in Chromium 153: `@container` rules are honoured inside a
   `@function` body and query the calling element's container; `100cqw`
   resolves there; `if()` accepts `style(--a) or style(--b)`; a unitless
   number interpolates through the same `calc()` as a length. esbuild,
   Lightning CSS and cssnano keep this output intact too.

8. Verified in Chromium 153: `initial` on a registered `syntax: "*"` token
   makes it guaranteed-invalid again, so `style(--param)` is false as for an
   unset one; a token whose `var()` reads a cleared (or missing) copy is
   invalid the same way; an unregistered copy that reads another copy is
   resolved where it is declared and inherits resolved, exactly like the
   alias it copies.

## Known trade-off

An element with both viewport and container tokens for one property is right
at every breakpoint, but steps into the container value instead of bending
towards it: the two curves run over different widths.

A value that reads several responsive variables always has a token at each of
their breakpoints, cleared copies or not, so inside a scope that overrides
one of them the curve can hold flat up to a breakpoint instead of running
straight through it. Right at every breakpoint; only the shape differs.

`max-md:p-xs` bends towards the variable's md value below md, though the
class is off from md up: the ahead token is published under the rule's
condition, and a condition is not read for what it excludes.

## Semantics worth knowing

A non-breakpoint variant becomes the *base* token under its condition. That
matches Tailwind for every built-in media variant (ordered before breakpoints)
and differs for custom variants ordered after them (class-based `dark:`), where
plain Tailwind lets the variant win at all widths. Documented; not a bug.

## Possible next steps

- Named containers (`@md/card:`) are still conditions: `cqw` always measures
  the nearest container, which need not be the named one.
- A Vite/Lightning CSS pass after this plugin must not strip `@function`; the
  three common minifiers were checked, others were not.

## Origin

Continues the series at dan-webnotes.com: the July 2025 tilde-variant experiment and
PostCSS Clampwind. This repo is the version of that idea that needs no new syntax.
