# postcss-fluid-variants

Make Tailwind's responsive utilities fluid, after the fact.

```html
<!-- this is all you write -->
<h1 class="text-2xl md:text-4xl xl:text-6xl mt-6 lg:mt-12">
```

Anywhere an element carries two or more lengths for the same property across breakpoints, the value now interpolates smoothly between them with `clamp()`. Anywhere it carries one — or a value that isn't a plain length, like `w-full` or `mt-auto` — it behaves exactly like Tailwind. No tildes, no new syntax, nothing to migrate: drop the plugin in after Tailwind and existing markup becomes fluid.

See it running at [danieledep.github.io/fluid-variants-site](https://danieledep.github.io/fluid-variants-site/): every size on that page is plain responsive Tailwind made fluid by this plugin.

## Install

```sh
npm install -D postcss-fluid-variants
```

```js
// postcss.config.js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    'postcss-fluid-variants': {},
  },
}
```

Order matters. This plugin reads Tailwind's *output*, so it has to run after it — and before any minifier that doesn't understand `@function`.

### CommonJS

The package is plain CommonJS, so a `require()` in a webpack, laravel-mix or Gulp config gets the plugin factory directly:

```js
// webpack.mix.js
mix.options({
  postCss: [
    require('@tailwindcss/postcss'),
    require('postcss-fluid-variants'),
  ],
})
```

`import fluidVariants from 'postcss-fluid-variants'` resolves to the same factory.

### Vite

With `@tailwindcss/vite`, keep Tailwind in `vite.config.js` and add this plugin to `postcss.config.js` as above; Vite runs PostCSS after the Tailwind plugin, so the *order* is right by construction. `@tailwindcss/postcss` in `postcss.config.js` works too.

That says nothing about the *shape* of what arrives. With its optimizer off — dev and watch builds — Tailwind emits nested CSS, with the media query inside the rule rather than around it. Both shapes are read, so dev and production agree; older releases of this plugin silently emitted nothing in dev.

One caveat: Vite's `css.transformer: 'lightningcss'` replaces PostCSS entirely, so *no* PostCSS plugin runs there and the output is plain Tailwind. Leave the transformer at its default; using Lightning CSS only as the minifier (`build.cssMinify: 'lightningcss'`) is fine.

## How it works

Tailwind emits one rule per class. A responsive variant is just a rule inside a `min-width` media query:

```css
.mt-6 { margin-top: calc(var(--spacing) * 6) }
@media (width >= 48rem) { .md\:mt-8 { margin-top: calc(var(--spacing) * 8) } }
```

That rule already contains everything needed: the breakpoint (from the media query) and the property and value (from the declaration). The plugin leaves it in place and appends a twin that publishes the value as a breakpoint-tagged token, then hands the property to a shared CSS function:

```css
@supports (top: --fl()) {
  @function --fl(--v0, --v48rem) { /* one interpolator, ~1kb, emitted once */ }
  @function --fl-margin-top() {
    result: --fl(var(--fl-margin-top-0), var(--fl-margin-top-48rem));
  }
  @property --fl-margin-top-0     { syntax: "*"; inherits: false }
  @property --fl-margin-top-48rem { syntax: "*"; inherits: false }

  @layer utilities {
    .mt-6     { --fl-margin-top-0: calc(var(--spacing) * 6); margin-top: --fl-margin-top() }
    .md\:mt-8 { --fl-margin-top-48rem: calc(var(--spacing) * 8) }
    @media (width >= 48rem) {
      .md\:mt-8 { margin-top: --fl-margin-top() }
    }
  }
}
```

A twin mirrors its original exactly — same selector, same at-rule ancestors (layers included), same order — so it wins precisely where the original would have won and never disturbs anything else. The one deliberate difference: the token is published *without* the breakpoint media, so the band below can already interpolate towards it.

The plugin never needs to know which classes share an element. Each class contributes one uniquely-named token; the browser's cascade assembles whichever tokens happen to co-occur; `--fl()` walks `var()` fallbacks to the nearest defined token below and above the current viewport, reads their widths with `if(style())`, and interpolates. A single token means `--hi` falls back to `--lo` and the clamp collapses to the plain value.

Why not a Tailwind plugin? Because inside Tailwind's plugin API the breakpoint is known to the variant and the property to the utility, and neither can see the other. Tailwind's output is the first place both facts sit on the same node. See [the write-up](https://dan-webnotes.com/posts/2025-07-02-generate-fluid-styles-tailwind-plugin/) for the earlier attempts.

## What gets interpolated

Three fences decide what the plugin touches, so it stays out of everything that isn't a Tailwind length utility.

**Layer.** When the stylesheet has an `@layer utilities` block — every Tailwind v4 build does — only that layer is read. Generated utilities and your own `@utility` blocks live there; `@layer components`, `@layer base` and unlayered hand-written CSS are never touched. Without one (Tailwind v3, whose output is unlayered) every rule is read.

**Property.** Margins, paddings, insets, scroll margins and paddings (physical and logical, so `ms-*`, `pe-*`, `start-*` and `space-x-*` / `space-y-*` too), gaps, `font-size`, `line-height`, `letter-spacing`, widths and heights with their min and max, `flex-basis`, border radii (corners and logical corners such as `rounded-s-*`), border widths (sides, axes and logical sides, `divide-x-*` / `divide-y-*` too), `outline-width` and `outline-offset`, `rotate`, `scale`, `opacity`, and translate and scale through the per-axis variables Tailwind composes them from (`--tw-translate-x`, `--tw-scale-y`, …; Tailwind 3's `--tw-rotate` too).

**Value.** Lengths interpolate, and so do the unitless `line-height` ratios that `text-*` ships, on a family of their own. Angles interpolate on `rotate`, and ratios on `opacity` and `scale`. Before deciding, the plugin resolves `var()` through the theme variables Tailwind emits on `:root` (and your own root variables), so `calc(var(--spacing) * 8)` or `var(--text-xl)` is known to be `2rem` or `1.25rem` at build time. Then:

- interpolated: every length — `px`, `rem`, `em` and the other absolute or font-relative units, percentages, viewport and container units — and `calc()` / `min()` / `max()` / `clamp()` over them: `mt-8`, `text-xl`, `w-96`, `max-w-md`, `mt-[31px]`, `tracking-tight`, `w-full`, `w-1/2`, `w-screen`, `mt-[2vw]`
- interpolated against each other, never against a length: unitless `line-height` values — the ratios `text-*` sets (`text-sm md:text-lg`), `leading-none`, `leading-tight`
- angles on `rotate`: `rotate-0 md:rotate-90`, `-rotate-12`, `rotate-[0.25turn]`
- ratios on `opacity` and `scale`, where a percentage and a number are the same thing: `opacity-20 md:opacity-100`, `scale-100 md:scale-150`, `scale-[1.2]`. Tailwind's optimizer writes `opacity-50` as `.5`, so percentages are published as the number they stand for and the two always meet
- kept as written: keywords (`auto`, `none`, `fit-content`…), unitless numbers on any other property, variables that can't be resolved at build time (`mt-(--gap)` with `--gap` set somewhere other than the root), and transform functions (`rotate-x-*`, `skew-*`, which Tailwind writes as `rotateX(…)` inside a variable)

The two ends of a curve need not share a unit, since `calc()` mixes them: `w-12 md:w-1/2` runs from `3rem` at `20rem` to exactly half the parent at `md`. Between the breakpoints the curve is straight in the viewport, so a percentage end bends with the parent's width and a `vh` end with the screen's height; the values at the breakpoints are always Tailwind's.

One caveat for percentage heights and vertical offsets (`height`, `max-height`, `flex-basis`, `top`, `bottom`). When the parent's height is auto, the percentage can't resolve, and the browser treats the *whole* value as auto, `3rem` and all. So in an auto-height parent `h-12 md:h-1/2` is auto below `md` too, where plain Tailwind keeps `3rem`. From `md` up both are auto, since `h-1/2` does nothing there in Tailwind either. Give the parent a height (or use `vh`/`dvh`) and the curve is exact.

A kept value at a breakpoint is a wall, and so is a value of the other kind (a length where ratios interpolate, or the reverse). In `w-64 md:w-fit lg:w-96` the width stays `16rem` up to `md`, is `fit-content` from `md` to `lg`, and is `24rem` above — exactly Tailwind — rather than bending towards `24rem` below `md`. The twin publishes a stop token at `md` that the interpolator checks before looking further up.

### Container queries

Unnamed container variants (`@md:`, `@lg:`) are breakpoints too, on the container's width. `p-2 @md:p-6` interpolates from `p-2` at a container `20rem` wide (`containerMinWidth`, which defaults to `minWidth`) to `p-6` at `28rem`, over `100cqw`. Outside any container `@md:` never applies, as in Tailwind, and the base value holds.

An element follows the container wherever one of its container queries matches, since Tailwind sorts `@` variants after breakpoints and they win. With both kinds on one property (`mt-4 md:mt-8 @md:mt-12`) every value is still right at every breakpoint, but the step into the container value is not interpolated. Named containers (`@md/card:`) and container queries stacked with a breakpoint (`@lg:md:`) stay conditions, as below.

## Runtime requirements

The generated CSS relies on three features that, as of September 2026, ship in Chromium 139+ only:

- `@function` — CSS custom functions
- `if()` with `style()` queries
- typed arithmetic in `calc()` (dividing a length by a length)

Everything is wrapped in `@supports (top: --fl())`, so browsers without custom functions ignore the whole block and get Tailwind's original breakpoint behaviour. There is no degraded middle state.

The output survives esbuild, Lightning CSS and cssnano minification unchanged in meaning (verified in Chromium 141), so the usual Vite or PostCSS production pipelines need no special configuration.

## Options

```js
'postcss-fluid-variants': {
  prefix: 'fl',          // token and function names: --fl, --fl-<prop>, --fl-<prop>-<bp>
  minWidth: '20rem',     // viewport where the base (unprefixed) value sits
  containerMinWidth: …,  // container width where the base value sits for @md: and friends; defaults to minWidth
  properties: [...],     // which properties to make fluid; replaces the default list (see index.js)
  exclude: [],           // properties to leave out of that list
  layers: 'auto',        // 'auto': utilities if present, else all; null: all; or a list of layer names
}
```

`exclude` is the way to drop a few properties and keep the rest: `exclude: ['max-width']` keeps Tailwind's `container` stepping at its breakpoints. Names are exact, so excluding `padding` leaves `padding-top` and the other longhands fluid. `properties` replaces the whole list instead.

`layers: 'auto'` reads `@layer utilities` when the stylesheet has one and every rule otherwise. Pass a list to name the layers yourself, or `null` to read everything regardless.

Values are copied verbatim once they pass the fence, so the token is still resolved on the element: a per-element `[--spacing:1px]` override applies, as do arbitrary values like `mt-[31px]` and `w-[calc(2rem+3px)]`.

Breakpoints and cascade layers are discovered from Tailwind's output, not configured: custom `--breakpoint-*` values, one-off `min-[900px]:` variants and Tailwind v3's `min-width:` queries all work, and twins land in whatever layer (or no layer) the originals use.

## Cost

Measured on four public Tailwind codebases, built with Tailwind 4.3 and minified with Lightning CSS. The overhead is one twin per utility of a property that varies across breakpoints somewhere in the build (properties that never vary are skipped entirely), plus the shared functions and one `@property` per token.

| codebase | utilities | fluid twins | minified | min + brotli |
|---|---|---|---|---|
| cruip landing page template | 371 | 103 | 45 → 56 kB (+24%) | 7.1 → 8.3 kB (+17%) |
| cruip open react template | 283 | 68 | 42 → 51 kB (+21%) | 6.1 → 7.1 kB (+16%) |
| tailwindcss.com | 4544 | 1163 | 448 → 546 kB (+22%) | 44 → 52 kB (+17%) |
| shadcn/ui monorepo | 2488 | 1129 | 280 → 371 kB (+33%) | 34 → 41 kB (+22%) |

Twins compress well because they repeat selectors and values already in the file. Expect roughly a fifth on top of your CSS over the wire. These numbers predate the length-only fence (0.4), which skips percentage and viewport values, and the newer support for logical properties, `space-*`, ratios and container queries, which adds twins for those utilities. On a synthetic build of common utilities the newer support costs about 1% more over the wire when none of them is used responsively, and grows with the number of responsive `space-*`, logical and `@` utilities.

## What is and isn't picked up

Every rule that has the specificity of one class — a single class selector, optionally wrapped in `:where()` the way class-based `dark:` is — and sits in at-rules only. So:

- `mt-6`, `md:mt-8`, `xl:text-lg`, `2xl:mt-11`, `min-[900px]:mt-8` — yes, these are the tokens
- `@md:mt-8`, `@lg:p-6` — yes: container breakpoints, interpolated over the container (see above)
- `space-y-4 md:space-y-8`, `space-x-*` — yes: the twins target the same children, at the same zero specificity
- `dark:mt-10`, `max-md:mt-2`, `print:mt-0`, `@md/card:mt-8` (named container), `supports-[…]:mt-4` — yes: the value becomes the *base* token, under that condition
- `dark:md:mt-4`, `md:max-lg:mt-8` — yes: the `md` token, under the remaining condition
- `hover:mt-8`, `group-hover:mt-8`, `first:mt-0`, `[&_p]:mt-4` — left alone; their extra specificity keeps beating the twins, exactly as in Tailwind
- `md:mt-auto`, `max-w-none`, `w-fit`, `md:h-full`, `md:leading-none` — not lengths (or, for `h-full`, a percentage that may not resolve); the twin re-asserts the value so it keeps winning, and stops the interpolation below it
- `padding: 0 20px`, `margin: 1px 2px 3px 4px`, `gap: 8px 12px`, `inset: 1px 2px`, `margin-inline: 4px 8px` — split into their longhands first, so each component interpolates on its own
- `border-radius: 1px 2px`, `rounded-[4px/8px]` — left alone; its values map to corners and the elliptical `/` form does not split
- `md:rounded-full` — not a size: `calc(infinity * 1px)`, or `2147483647px` once optimized, is kept as written and stops the interpolation like a keyword
- `mt-6!` — left alone; `!important` opts a declaration out
- `md:flex`, `md:bg-red-500` — not a fluid property

Tailwind's own `container` class is picked up like anything else: it sets `max-width` once per breakpoint, so those steps become an interpolation and the container tracks the viewport instead of jumping. Pass `exclude: ['max-width']` to keep the steps.

If a stylesheet has responsive values for fluid properties and none of them can be read, the plugin emits a PostCSS warning rather than quietly producing nothing.

In other words a non-breakpoint variant answers "what is the value at this breakpoint under this condition", and the interpolation runs through it. This matches Tailwind wherever Tailwind's own variant order puts the condition before the breakpoints (all built-in media variants). For a custom variant Tailwind orders *after* the breakpoints, such as class-based `dark`, `mt-6 dark:mt-10 md:mt-8` is "dark base is 40, md is 32" here, where plain Tailwind would let `dark:` win at every width. Stack them (`dark:md:mt-8`) to say what you mean.

### `line-height` ratios and lengths

Tailwind's `text-*` utilities set `line-height` to a ratio (`text-lg` → `calc(1.75 / 1.125)`). Ratios interpolate with ratios, so in `text-sm md:text-lg` the ratio glides along with the font size instead of jumping at `md`.

A ratio never meets a length. In `text-sm/6 md:text-lg`, `1.5rem` holds up to `md` and the ratio takes over from there, as in Tailwind; `leading-6 md:leading-none` holds `1.5rem` below `md` and is `1` from there on. `leading-*` keeps winning over `text-*` the way it does in Tailwind, through `--tw-leading`.

## Testing

```sh
npm test
```

Uses `node:test`. No dependencies beyond `postcss`.

`test/browser.test.mjs` additionally renders a real Tailwind build in Chromium and compares computed styles with plain Tailwind at several widths. It skips itself unless the optional tooling is installed:

```sh
npm i -D playwright @tailwindcss/postcss tailwindcss && npx playwright install chromium
```

Where Playwright's browser download is blocked, point `CHROMIUM_PATH` at any Chromium 139+ binary.

## License

MIT
