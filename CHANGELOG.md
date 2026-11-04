# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Percentages, viewport units and container units interpolate by default
  (`w-12 md:w-1/2`, `w-full md:w-64`, `mt-[2vw]`). `calc()` mixes them with
  other lengths, so the ends of a curve need not share a unit. In an
  auto-height parent a percentage height can't resolve and the whole value
  is auto, so `h-12 md:h-1/2` there is auto below `md` as well.

### Removed
- The `units` option. Every length unit now interpolates.

### Added
- Border widths (`border-*`, `border-x-*`, `border-s-*`, `divide-x-*`, …),
  `outline-width` and `outline-offset` are fluid. A multi-value
  `border-width` splits into its sides or axes.
- `rotate` interpolates angles; `opacity` and `scale` interpolate ratios,
  with percentages published as numbers so `opacity-50` (dev) and `.5`
  (optimized) are one family.
- Translate and scale interpolate through Tailwind's per-axis variables
  (`--tw-translate-x`, `--tw-scale-y`, …, and Tailwind 3's `--tw-rotate`),
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

### Changed
- The "nothing was made fluid" warning now points at the first unread
  declaration, so runners report a file and line.

### Fixed
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
  `2147483647px` and that was interpolated. Lengths of a million units or
  more are now fixed.
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

[Unreleased]: https://github.com/danieledep/postcss-fluid-variants/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/danieledep/postcss-fluid-variants/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/danieledep/postcss-fluid-variants/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/danieledep/postcss-fluid-variants/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/danieledep/postcss-fluid-variants/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/danieledep/postcss-fluid-variants/releases/tag/v0.1.0
