# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] - 2026-11-26

### Fixed
- The npm homepage link points to the renamed site,
  https://danieledep.github.io/autofluid-site/. 0.5.0 still linked to the old
  `fluid-variants-site` address.

## [0.5.0] - 2026-11-24

### Changed
- Tokens and wrappers carry a short name for their property instead of the
  property itself: `--fl-mt-48rem` and `--fl_k3x9a-mt()` for `margin-top`.
  The names are Tailwind's (`px`, `max-w`, `rounded-tl`, `gap-x`,
  `scroll-mt`, `inset-x`, `border-t`), with `fs`, `lh` and `lh-num`, `ls`
  for type. A property added through `properties` keeps its full name, and
  a short name gives way to a listed property that is really called that.
  Anything that reads a token by name (`var(--fl-margin-top-48rem)`) needs
  the new name. On four sample builds this and the next change take 15 to
  19% off the appended CSS minified, 12 to 14% after brotli.
- A wrapper names only the tokens some rule publishes. Every wrapper passed
  one argument per breakpoint and stop, though most properties speak at few
  of them; the rest now read one shared, never-set name (`--fl-0`). The
  hash in the function names covers what the wrappers read as well, so
  two stylesheets with the same breakpoints and other tokens do not
  redefine each other's wrappers.
- Renamed to `postcss-autofluid` (was `postcss-fluid-variants`). The plugin
  adds no variants: it makes the responsive utilities you already write
  fluid, automatically.
- The defaults are type and spacing in absolute and font-relative lengths
  (`px`, `rem`, `em`, …). Percentages, viewport and container units, border
  and outline widths, transforms and opacity step at their breakpoints as in
  Tailwind unless opted in with the new `include` option. A responsive value
  of those kinds is often a switch rather than a scale: an off-canvas drawer
  (`-translate-x-full lg:translate-x-0`) was half on screen at tablet widths,
  `opacity-0 md:opacity-100` faded in, and `w-full md:w-1/2` showed 75% wide
  stacked items. `include: 'all'` restores the previous behaviour.
- The shared functions are named after their signature (`--fl_k3x9a()`,
  `--fl_k3x9a-margin-top()`). Two stylesheets on one page that used
  different breakpoints redefined each other's `--fl()` and wrappers, and
  the elements of the first fell back to their base value.
- Options are validated when the plugin is created. A single name is
  accepted where a list is expected (`layers: 'utilities'` used to become a
  set of letters), and a number for `minWidth` or `containerMinWidth` is
  pixels (`320` used to emit an invalid unitless width). Unknown options,
  unknown `include` groups and widths that aren't lengths throw with a
  message naming the option; `units` says what replaced it.
- The source is split into `lib/options.js`, `lib/values.js`,
  `lib/context.js` and `lib/interpolator.js`.
- `layers` defaults to `['utilities']` instead of `'auto'`. Tailwind 4 output
  is read exactly as before. Tailwind 3 output, which is unlayered, now needs
  `layers: null` (or `'auto'`, still accepted); the plugin warns when it
  finds responsive values but none of the listed layers.
- The "nothing was made fluid" warning now points at the first unread
  declaration, so runners report a file and line.

### Removed
- The `units` option. `include: ['percentages', 'viewport-units',
  'container-units']` replaces it.

### Added
- An opt-in `font-weight` group: `font-light md:font-black` passes through
  600 on the way, for variable fonts. Numeric weights, written or behind a
  theme variable (`--font-weight-bold`), interpolate on their own channel
  (`--fl-fw-*`); keywords (`bold`, `bolder`) stay fixed and are walls. Off
  by default, since a static font snaps to its nearest face. `include:
  'all'` turns it on too.
- Root variables redefined per breakpoint make the utilities that read them
  fluid: with `:root { --h1: 64px; @variant md { --h1: 96px } }`,
  `font-size: var(--h1)` interpolates as if the utility held the variant
  itself. Each value is copied under a name of its own
  (`--fl--h1-0`, `--fl--h1-48rem`) where it is declared, and the utility
  gets a token per breakpoint reading the copies. The variable is not
  touched, so only fluid properties follow it. Root variables that read it
  (`--input-padding: var(--spacing-xs)`), arithmetic and fallbacks follow
  too; a variable set again elsewhere in the stylesheet
  (`.section { --h1: 40px }`, `[--h1:40px]`) holds there as in Tailwind.
  Not followed: a variable that changes kind between breakpoints, one only
  a non-root rule changes, container variants, and values set outside the
  stylesheet (inline styles, JavaScript).
- `include` option: opt-in groups `percentages`, `viewport-units`,
  `container-units`, `borders`, `transforms`, `opacity`, or `all`.
- Percentages, viewport units and container units can interpolate
  (`w-12 md:w-1/2`, `w-full md:w-64`, `mt-[2vw]`). `calc()` mixes them with
  other lengths, so the ends of a curve need not share a unit. In an
  auto-height parent a percentage height can't resolve and the whole value
  is auto, so `h-12 md:h-1/2` there is auto below `md` as well.
- `exclude` option: properties to leave out of the fluid list, so one can
  be dropped without restating the other hundred.
- With `borders`, border widths (`border-*`, `border-x-*`, `border-s-*`,
  `divide-x-*`, …), `outline-width` and `outline-offset` are fluid. A multi-value
  `border-width` splits into its sides or axes.
- With `transforms` and `opacity`: `rotate` interpolates angles; `opacity`
  and `scale` interpolate ratios, with percentages published as numbers so
  `opacity-50` (dev) and `.5` (optimized) are one family.
- With `transforms`, translate and scale interpolate through Tailwind's
  per-axis variables (`--tw-translate-x`, `--tw-scale-y`, …, and Tailwind 3's `--tw-rotate`),
  so `scale-100 md:scale-x-150` composes the way Tailwind does. Tokens for
  a variable drop its leading dashes: `--fl-tw-scale-x-48rem`.
- Logical properties are fluid by default: `margin-inline-start` and the
  other start/end longhands for margins, paddings, scroll margins and
  paddings and insets (`ms-*`, `pe-*`, `start-*`, `end-*`), and the logical
  corner radii (`rounded-s-*`, `rounded-ss-*`, …). Two-value
  `margin-inline` and friends split into their start and end.
- `space-x-*` and `space-y-*` are fluid. Their twins target the same
  children at the same zero specificity, and a rule's own custom properties
  (`--tw-space-y-reverse`) count as known when classifying its values.
- Unitless `line-height` values interpolate on a token family of their own
  (`--fl-line-height-num-*`), so the ratios `text-*` sets glide with the
  font size. A ratio and a length are walls for each other.
- Unnamed container queries (`@md:`) interpolate over the container width
  (`100cqw`), from `containerMinWidth` (new option, defaults to `minWidth`).
  Outside a container the base value holds.


### Fixed
- `sr-only` under a breakpoint was read as a scale. `w-24 lg:sr-only` shrank
  towards 1px on the way to `lg`, `p-4 lg:sr-only` lost its padding, and
  `sr-only md:w-40` was 136px wide at 700px while still hidden. `sr-only`
  and `not-sr-only` are a switch: their values are now fixed, like a
  keyword, under any variant or prefix.
- `p-4 pt-2` rendered `padding-top: 1rem` whenever the build had a
  responsive `padding` but no responsive `padding-top`: the twin of `p-4`
  comes after everything Tailwind wrote, `pt-2` had no twin, and the
  shorthand overrode it. A rule that sets a side, axis or corner of a fluid
  property (`pt-*`, `px-*`, `ps-*`, `left-*`, `gap-x-*`, `rounded-t-*`, …)
  now always gets a twin re-asserting its value.
- A theme variable that is a bare `0` (`--spacing-none: 0`) broke the curve
  of anything interpolating with it: inside `calc()` a bare zero is a
  number, as with a written `0`. `p-xs md:p-none` had no padding below
  `md`. Where the variable is declared once, on the root, its zero is now
  published as `0px`; one that is set again elsewhere stays live.
- `mt-4 md:mt-8 @md:mt-12` rendered the `md` value where Tailwind renders the
  container one: the container value was only a base token, and the
  viewport token above it won. Wherever a container query sets a value, the
  element now follows the container.
- Slash radii (`rounded-[4px/8px]`, and `rounded-[4px_/_8px]` once the
  optimizer strips its spaces) rendered square at every width: the value was
  tokenised, and inside `calc()` the slash divided the two lengths into a
  number. A value with a top-level `/` is now fixed and kept as written.
- `rounded-sm md:rounded-full` was fully round almost from the base in
  production builds, where the optimizer folds `calc(infinity * 1px)` into
  `2147483647px` and that was interpolated. Tailwind 3 writes `9999px`,
  which did the same. Lengths of 9999 units or more are now fixed.
- A selector that appears twice (`.a { … } .b { … } .a { … }`) had both
  rules merged into one twin at the first one's place, so the second no
  longer came after what sat between them and lost to it. Each rule now
  gets its own twin, in its own place.
- Leaving a longhand out (`exclude: 'padding-top'`, `properties: 'padding'`)
  brought back the `p-4 pt-2` override above: only listed properties were
  read, so `pt-2` had no twin to re-assert it. Whatever shares a side with
  a listed property is now read, and kept as written.
- A shorthand whose values sit on separate lines (`padding: 1rem⏎2rem`) was
  read as one value, and the padding was lost. Any whitespace separates.
- Running the plugin over its own output (listed twice, or in two
  pipelines) read the twins as utilities and appended a second, broken
  appendix. A stylesheet that already has one is left as it is.
- `opacity` and `scale` that read a root variable ignored its overrides
  (`.section { --o: 1 }`): the value was resolved at build time. It stays
  live now, as for lengths; only a percentage behind a variable is still
  resolved, since a token has to be a number.
- Copies of a responsive root variable were emitted when the only rule
  reading it was one the plugin skips (`.card .title`, `!important`).
- A root variable declared more than once was classified by its first
  value, conditions included (`@media print { :root { --gap: auto } }`
  before the real one made `--gap` a keyword). The theme is now what the
  cascade leaves on the root: the last value under no condition.
- A custom `@utility` with its own `@variant md`, used as `md:`, rendered the
  outer value from md up: the nested value's token was published under a
  redundant media query and then overridden by the outer one. Min-width
  queries implied by the token's breakpoint are no longer kept as conditions,
  and a token rule is never placed before an earlier one it competes with.
- Selector lists from Tailwind's optimizer (`.h1, .md\:h0 { … }`) were skipped
  entirely, so their twins went missing in production builds. Each lone class
  in a list is now read as its own rule.

## [0.4.0] - 2026-10-30

### Added
- `layers: 'auto'` is the new default: only `@layer utilities` is read when
  the stylesheet has one, every rule otherwise (Tailwind v3).
- `units` option to opt relative units such as `%` or `vw` into interpolation.
- Stop tokens: a fixed value at a breakpoint (`md:w-full`, `md:mt-auto`) holds
  the band below it instead of letting it bend towards a later breakpoint.
- `flex-basis`, `scroll-margin-*` and `scroll-padding-*` in the default properties.
- `repository`, `homepage` and `bugs` fields in package.json.

### Changed
- Only lengths interpolate. `var()` is resolved through root custom
  properties, and `%`, viewport and container units, unitless ratios,
  keywords and unresolvable variables are re-asserted verbatim.
- `line-height` ratios step at breakpoints instead of making the property
  invalid when they meet a length.

### Removed
- `text-indent` from the default properties.

### Fixed
- `w-64 md:w-full lg:w-96` interpolated `100%` against `24rem`.
- Bare-zero values from Tailwind's optimizer (`top-0`, `m-0`, `inset-0`) were
  invalid inside `calc()` and fell back to `auto` in production builds; they
  are now published as `0px`.

## [0.3.0] - 2026-09-09

### Added
- Multi-value `padding`, `margin`, `inset` and `gap` are split into longhands,
  so each component interpolates on its own.
- `layers` option to scope the plugin to named cascade layers.
- A warning when responsive values for fluid properties are present but none
  could be read.

### Fixed
- Unoptimized Tailwind output (dev and watch builds), where the media query
  sits inside the rule, produced no output at all.
- Tailwind's `.container` blocks could pull twins backwards past rules they
  must beat; group reuse is now run-local.

## [0.2.1] - 2026-09-06

### Fixed
- The package is now CommonJS, so `require('postcss-fluid-variants')` returns
  the plugin factory (webpack, laravel-mix, Gulp).

## [0.2.0] - 2026-09-06

### Added
- Every generated node carries a `source`, for source maps and to silence
  Vite's sourceless-node warnings.

### Changed
- Twins mirror their original's selector, at-rule ancestors (layers included)
  and order, and are emitted only under the original's media.
- Properties that never vary across breakpoints get no twins, and only
  published tokens are registered with `@property`.

### Fixed
- Tokens inherited into children; they are now registered with
  `inherits: false`.
- `2xl:` utilities were skipped because of Tailwind's `\32 ` escape.
- Tailwind v3's unlayered output outranked the layered twins.

## [0.1.0] - 2026-09-06

### Added
- Initial release: responsive Tailwind utilities become fluid by appending
  twins that feed a shared `@function` interpolator inside `@supports`.

[Unreleased]: https://github.com/danieledep/postcss-autofluid/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/danieledep/postcss-autofluid/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/danieledep/postcss-autofluid/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/danieledep/postcss-autofluid/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/danieledep/postcss-autofluid/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/danieledep/postcss-autofluid/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/danieledep/postcss-autofluid/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/danieledep/postcss-autofluid/releases/tag/v0.1.0
