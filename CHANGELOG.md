# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- The "nothing was made fluid" warning now points at the first unread
  declaration, so runners report a file and line.

### Fixed
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
