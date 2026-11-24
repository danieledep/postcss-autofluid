# postcss-autofluid

Make responsive type and spacing fluid between your breakpoints, with no changes to your markup.

You already chose a size for each breakpoint. This PostCSS plugin connects them: instead of jumping at each breakpoint, a value scales smoothly from one to the next. No `clamp()` math, no new classes, no new syntax.

```html
<!-- Unchanged markup -->
<h1 class="text-2xl md:text-4xl xl:text-6xl">
```

| Viewport | Plain Tailwind | With postcss-autofluid |
|---|---|---|
| 320px and below | 24px | 24px |
| 544px | 24px | 30px |
| 768px (`md`) | 36px | 36px |
| 1024px | 36px | 48px |
| 1280px (`xl`) and above | 60px | 60px |

Every value is exactly Tailwind's at every breakpoint; only the widths in between change. A class with no responsive variant, or a value that isn't a size, like `w-fit` or `mt-auto`, behaves exactly as before.

It reads your built CSS, so there is nothing to configure: custom breakpoints, arbitrary values, your own `@utility` blocks and container queries all work, and so do Tailwind 3 and hand-written single-class rules inside `min-width` media queries (with `layers: null`). Browsers without CSS custom functions (currently everything but Chromium) get your original stepped values.

**[See it running →](https://danieledep.github.io/fluid-variants-site/)** Every size on that page is plain responsive Tailwind.

## Contents

- [Install](#install)
- [What becomes fluid](#what-becomes-fluid)
- [How it works](#how-it-works)
- [Options](#options)
- [Browser support](#browser-support)
- [Caveats](#caveats)
- [Reference](#reference)
- [Output size](#output-size)
- [Development](#development)

## Install

> Not published to npm yet. The commands below are how it will install once it is.

```sh
npm install -D postcss-autofluid
```

Add it to your PostCSS config **after Tailwind**, and before any minifier that doesn't understand `@function` (esbuild, Lightning CSS and cssnano are all fine):

```js
// postcss.config.js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    'postcss-autofluid': {},
  },
}
```

That's it. Dev and production builds both work.

**Vite.** With `@tailwindcss/vite`, keep Tailwind in `vite.config.js` and add only `postcss-autofluid` to `postcss.config.js`; Vite runs PostCSS after the Tailwind plugin. Do not set `css.transformer: 'lightningcss'`: it replaces PostCSS, so no PostCSS plugin runs. Using Lightning CSS as the minifier (`build.cssMinify: 'lightningcss'`) is fine.

**CommonJS** (webpack, Laravel Mix, Gulp). The package is CommonJS, so `require('postcss-autofluid')` returns the plugin:

```js
// webpack.mix.js
mix.options({
  postCss: [require('@tailwindcss/postcss'), require('postcss-autofluid')],
})
```

**Tailwind 3**, or CSS without cascade layers: pass `layers: null` (see [Options](#options)). By default only `@layer utilities` is read, and Tailwind 3 output has no layers.

Requires Node 20+ and PostCSS 8.4+.

## What becomes fluid

A property becomes fluid on an element when it has **a size at two or more breakpoints**, counting the unprefixed class as the first one. Below `minWidth` (default `20rem`, 320px) the base value holds, and above the last breakpoint the last value holds.

By default that covers type and spacing in absolute and font-relative lengths (`px`, `rem`, `em`, `ch`, `lh`, `pt` and friends):

- margin, padding, inset (`top`, `left`, …), gap, scroll margin and scroll padding, including logical sides (`ms-*`, `pe-*`, `start-*`) and `space-x-*` / `space-y-*`
- `font-size`, `line-height` and `letter-spacing`
- width and height with their min and max, and `flex-basis`
- border radius

Everything else steps at its breakpoints, as in Tailwind. That includes percentages, viewport and container units, border widths, transforms, opacity and font weight, because a responsive value there is as often a **switch** between two states as a scale:

| Classes | Intent | If it were fluid |
|---|---|---|
| `-translate-x-full lg:translate-x-0` | drawer hidden on mobile | half on screen at tablet widths |
| `opacity-0 md:opacity-100` | show on desktop | fades in between 320px and 768px |
| `w-full md:w-1/2` | stack, then columns | 75% wide and still stacked at 544px |
| `border-0 md:border` | border on desktop | sub-pixel hairline in between |

Each of those can be turned on with the [`include`](#options) option when you do want the curve.

A value that can't interpolate (`auto`, `none`, `fit-content`, a unit that isn't turned on) at a breakpoint is a wall: in `w-64 md:w-fit lg:w-96` the width is `16rem` up to `md`, `fit-content` from `md` to `lg`, and `24rem` above, exactly as in Tailwind.

Unitless `line-height`, such as the ratio each `text-*` class sets, interpolates with other ratios, so in `text-sm md:text-lg` the line height glides along with the font size. A ratio and a length never interpolate with each other: in `text-sm/6 md:text-lg`, `1.5rem` holds up to `md` and the ratio takes over from there.

**Container queries.** Unnamed container variants (`@md:`, `@lg:`) are breakpoints on the container's width: `p-2 @md:p-6` interpolates from `p-2` at a container `20rem` wide (`containerMinWidth`) to `p-6` at `28rem`. Outside any container `@md:` never applies and the base value holds, as in Tailwind.

**Theme variables that change per breakpoint** are followed too. If the root redefines a variable at a breakpoint, every fluid utility that reads it interpolates between those values:

```css
@theme { --h1: 64px; --spacing-xs: 12px; }
@layer theme {
  :root {
    @variant md { --h1: 96px; --spacing-xs: 16px; }
    @variant lg { --h1: 140px; }
  }
}
@utility h1 { font-size: var(--h1); }
```

Here `h1` runs 64px → 96px → 140px and `p-xs` 12px → 16px, with no variants in the markup. The variable itself is never changed, and overriding it later (`.section { --spacing-xs: 4px }`, `[--spacing-xs:2px]`) works as in Tailwind.

### Keeping something stepped

- **One utility:** mark it `!important` (`md:mt-8!`). Important declarations are left alone, and step as in Tailwind (they also beat the property's other classes on that element, as `!important` always does).
- **One property everywhere:** list it in `exclude`, for example `exclude: ['max-width']` to keep Tailwind's `container` class stepping.

There is no per-element switch by design: the plugin never sees your markup.

## How it works

Tailwind emits one rule per class, and a responsive variant is that rule inside a `min-width` media query:

```css
.mt-6 { margin-top: calc(var(--spacing) * 6) }
@media (width >= 48rem) { .md\:mt-8 { margin-top: calc(var(--spacing) * 8) } }
```

That rule is the first place where the breakpoint and the property's value meet, which is why this is a PostCSS plugin and not a Tailwind plugin: inside Tailwind's plugin API a variant doesn't know the property and a utility doesn't know the breakpoint. ([The write-up](https://dan-webnotes.com/posts/2025-07-02-generate-fluid-styles-tailwind-plugin/) covers the earlier attempts.)

The plugin leaves Tailwind's rules untouched and appends, inside `@supports`, a twin of each rule that publishes its value as a custom property tagged with its breakpoint, and hands the property to a shared CSS function:

```css
@supports (top: --fl()) {
  @function --fl_k3x9a(--v0, --v48rem) { /* the interpolator, emitted once */ }
  @function --fl_k3x9a-mt() { result: --fl_k3x9a(var(--fl-mt-0), var(--fl-mt-48rem)); }
  @property --fl-mt-0     { syntax: "*"; inherits: false }
  @property --fl-mt-48rem { syntax: "*"; inherits: false }

  @layer utilities {
    .mt-6     { --fl-mt-0: calc(var(--spacing) * 6); margin-top: --fl_k3x9a-mt() }
    .md\:mt-8 { --fl-mt-48rem: calc(var(--spacing) * 8) }
    @media (width >= 48rem) { .md\:mt-8 { margin-top: --fl_k3x9a-mt() } }
  }
}
```

The plugin never needs to know which classes share an element. Each class publishes one uniquely named value, the cascade collects whichever ones co-occur on an element, and the function finds the nearest value below and above the current viewport and interpolates between them. With only one value, it returns that value.

Each twin has the same selector, the same at-rules (layers included) and the same relative order as its original, so it wins exactly where the original would have won. The `_k3x9a` suffix is a hash of the generated functions, so two stylesheets on one page with different breakpoints don't overwrite each other's functions.

## Options

```js
// postcss.config.js
'postcss-autofluid': {
  minWidth: 360,             // a number is px
  include: ['percentages'],  // also interpolate w-full, w-1/2, …
  exclude: ['max-width'],    // keep the container class stepping
}
```

| Option | Default | Description |
|---|---|---|
| `minWidth` | `'20rem'` | Viewport width where the base (unprefixed) value sits. A length in `px`, `rem` or `em`, or a number of pixels. |
| `containerMinWidth` | `minWidth` | Container width where the base value sits, for `@md:` and other container variants. |
| `include` | `[]` | Groups to turn on, from the table below, or `'all'`. |
| `exclude` | `[]` | Property names to keep stepped. Names are exact: excluding `padding` leaves `padding-top` fluid. |
| `properties` | type and spacing | Replaces the default property list ([`DEFAULT_PROPERTIES`](lib/options.js)). `include` and `exclude` apply on top. |
| `layers` | `['utilities']` | Cascade layers to read. `null` reads every rule; `'auto'` reads `utilities` if the stylesheet has it, every rule otherwise. |
| `prefix` | `'fl'` | Prefix for generated names: `--fl-mt-48rem`, `--fl_<hash>()`. |

`include` takes **groups, not property names**:

| Group | Makes fluid |
|---|---|
| `percentages` | `%` values (`w-full`, `w-1/2`) |
| `viewport-units` | `vw`, `vh`, `dvh`, `svw`, `vmin` and the rest |
| `container-units` | `cqw`, `cqh`, `cqi` and the rest |
| `borders` | border widths on every side and axis, `outline-width`, `outline-offset` |
| `transforms` | `rotate`, `scale` and translate (through Tailwind's `--tw-translate-*` and `--tw-scale-*` variables) |
| `opacity` | `opacity` |
| `font-weight` | numeric `font-weight` (`font-light md:font-black`); renders smoothly only with a variable font |

Once a unit group is on, the two ends of a curve may use different units: `w-12 md:w-1/2` runs from `3rem` to exactly half the parent at `md`. Unit and property groups combine: `transforms` alone interpolates `translate-x-4 md:translate-x-12` but keeps `-translate-x-full` stepped, because `full` is a percentage.

Add `'components'` to `layers` to make your own component classes fluid too: a component's fixed value then curves towards a responsive utility on the same element.

Any list option also takes a single string (`exclude: 'max-width'`). An invalid option (an unknown name, an unknown group, a `minWidth` that isn't a length) throws when the plugin is created, with a message naming the option. If a stylesheet has responsive values for fluid properties but none of them can be read, for example because the listed layers don't exist, the plugin emits a PostCSS warning instead of silently doing nothing.

## Browser support

The generated CSS uses CSS custom functions (`@function`), `if()` with `style()` queries, and typed arithmetic in `calc()`. As of November 2026 these ship in **Chromium 139+** only.

Everything the plugin adds is wrapped in `@supports (top: --fl())`. Firefox, Safari and older browsers ignore the whole block and render your original Tailwind CSS, stepping at the breakpoints as before. There is no partly working middle state. Expect different sizes between breakpoints when comparing screenshots across browsers.

## Caveats

- **Custom variants sorted after the breakpoints**, such as class-based `dark:`, become the *base* value under their condition: `mt-6 dark:mt-10 md:mt-8` reads as "dark base is 40px, `md` is 32px", where plain Tailwind lets `dark:` win at every width. Stack them (`dark:md:mt-8`) to say what you mean. Built-in media variants (`max-md:`, `print:`, media-query `dark:`) match Tailwind.
- **Viewport and container breakpoints on one property** (`mt-4 md:mt-8 @md:mt-12`) are right at every breakpoint, but the change into the container value steps instead of interpolating.
- **A root font size other than the browser's** (`html { font-size: 62.5% }`) or `em` breakpoints make the curve run over the wrong widths, because media queries measure `rem` against the browser default. Write those breakpoints, and `minWidth`, in `px`.
- **Theme variables set outside the stylesheet**, through a `style` attribute, JavaScript or a separately built stylesheet, aren't seen; utilities keep following the stylesheet's values. Set them in CSS the plugin processes, or mark the utility `!important`.
- **Percentage heights, once `percentages` is on.** In a parent with auto height, `h-12 md:h-1/2` computes to `auto` below `md` too, where Tailwind keeps `3rem`. Give the parent a height, or use `vh` / `dvh`.
- **Several Tailwind builds on one page** don't break each other's curves, but builds that define the *same* utility still override each other in source order, as they do without the plugin.

## Reference

<details>
<summary><b>Which rules are read</b></summary>

A rule is read when it has the specificity of one class (a single class, optionally followed by `:where(…)` as class-based `dark:` writes it) and sits only inside at-rules. Breakpoints are `min-width` / `width >=` media queries in `px`, `rem` or `em`, discovered from the output: custom `--breakpoint-*` values, one-off `min-[900px]:` variants and Tailwind 3's `min-width:` all work.

| Classes | Result |
|---|---|
| `mt-6`, `md:mt-8`, `2xl:mt-11`, `min-[900px]:mt-8`, `mt-[31px]` | interpolated |
| `@md:mt-8`, `@lg:p-6` | interpolated over the container's width |
| `space-y-4 md:space-y-8` | interpolated on the same children Tailwind targets |
| `dark:mt-10`, `max-md:mt-2`, `print:mt-0`, `@md/card:mt-8`, `supports-[…]:mt-4` | the base value, under that condition |
| `dark:md:mt-4`, `md:max-lg:mt-8` | the `md` value, under the remaining condition |
| `md:mt-auto`, `w-fit`, `max-w-none`, `md:rounded-full` | kept as written, a wall for the interpolation |
| `padding: 0 20px`, `gap: 8px 12px`, `inset: 1px 2px` | split into longhands, each interpolated on its own |
| `border-radius: 1px 2px`, `rounded-[4px/8px]` | kept as written |
| `sr-only`, `not-sr-only` under any variant | kept as written: `w-24 lg:sr-only` stays 6rem up to `lg` |
| `mt-6!` | left alone |
| `hover:mt-8`, `group-hover:mt-8`, `first:mt-0` | left alone |
| `md:flex`, `md:bg-red-500` | not a fluid property |

Values are resolved through the theme variables on `:root` at build time to decide whether they are sizes (`calc(var(--spacing) * 8)` is `2rem`), but are published as written, so a per-element override such as `[--spacing:1px]` still applies. Variables that can't be resolved at build time (`mt-(--gap)` with `--gap` set somewhere other than the root) are kept as written.

</details>

<details>
<summary><b>Theme variables in detail</b></summary>

`var(--h1)` only holds the current viewport's value, and an interpolation needs both ends. So each root value is also published under a name of its own, without its breakpoint, and the utility reads those copies:

```css
@layer utilities {
  .h1 {
    --fl-fs-0: var(--fl--h1-0);
    --fl-fs-48rem: var(--fl--h1-48rem);
    --fl-fs-64rem: var(--fl--h1-64rem);
    font-size: --fl_k3x9a-fs();
  }
}
@layer theme {
  :root, :host { --fl--h1-0: 64px; --fl--h1-48rem: initial; --fl--h1-64rem: initial }
  :root        { --fl--h1-48rem: 96px; --fl--h1-64rem: 140px }
}
```

Each copy sits where its declaration sits, so the cascade settles the copies the way it settles the variable:

- **Overrides work as in Tailwind**, anywhere in the stylesheet: `.section { --spacing-xs: 4px }`, `dark:[--spacing-xs:3px]`, a theme under `[data-theme]`. Inside it `p-xs` is 4px at every width; give the override its own `@variant` and it interpolates between those values instead.
- **Other classes win as in Tailwind.** `p-xs sm:p-0` is 0 from `sm` up, even though the variable changes at `md`.
- **Only the root makes a variable responsive.** A variable that only a component changes per breakpoint is read live and steps. That also keeps Tailwind's own `--tw-*` variables out of it.
- **Aliases are followed**: `--input-padding: var(--spacing-xs)` is responsive too, as are `calc()` and fallbacks over a responsive variable.
- **The property fence still holds**: `grid-cols-(--columns)` steps, and so does `translate-x-(--spacing-xs)` unless `transforms` is on. A variable that is a length at one breakpoint and a keyword at another steps too.
- **Container variants read it live**: in `@md:p-xs` the padding steps when the variable does.

</details>

<details>
<summary><b>Generated names</b></summary>

Tokens and wrapper functions are named after the property's Tailwind short name (`mt`, `px`, `max-w`, `rounded-tl`, `gap-x`), with `fs`, `lh` and `ls` for font size, line height and letter spacing. A property added through `properties` keeps its full name. A stylesheet that already contains the plugin's output is returned untouched, so listing the plugin twice is harmless.

</details>

## Output size

The plugin adds one twin per utility of a property that varies across breakpoints somewhere in the build; properties that never vary are skipped. Measured on four public codebases with Tailwind 4.3 and Lightning CSS, before 0.4:

| Codebase | Utilities | Fluid twins | Minified | Minified + brotli |
|---|---|---|---|---|
| Cruip landing page template | 371 | 103 | 45 → 56 kB (+24%) | 7.1 → 8.3 kB (+17%) |
| Cruip Open React template | 283 | 68 | 42 → 51 kB (+21%) | 6.1 → 7.1 kB (+16%) |
| tailwindcss.com | 4544 | 1163 | 448 → 546 kB (+22%) | 44 → 52 kB (+17%) |
| shadcn/ui monorepo | 2488 | 1129 | 280 → 371 kB (+33%) | 34 → 41 kB (+22%) |

Expect roughly a fifth on top of your CSS over the wire. These numbers are due for re-measuring: since then, shorter generated names took 12 to 14% off the added CSS after brotli, and the narrower defaults removed twins, while logical properties, `space-*`, line-height ratios and container queries added some.

## Development

```sh
npm test
```

Tests use `node:test`, and the only dependency is `postcss`. `test/browser.test.mjs` also renders a real Tailwind build in Chromium and compares computed styles with plain Tailwind at several widths. It runs in CI and skips itself locally unless the optional tooling is installed:

```sh
npm i --no-save playwright @tailwindcss/postcss tailwindcss && npx playwright install chromium
```

Set `CHROMIUM_PATH` to use a Chromium 139+ binary you already have, and `BROWSER_TEST=1` to make missing tooling fail the run instead of skipping it. See [CHANGELOG.md](CHANGELOG.md) for changes between versions.

## License

MIT
