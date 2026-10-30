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

**Property.** Margins, paddings, insets, scroll margins and paddings, gaps, `font-size`, `line-height`, `letter-spacing`, widths and heights with their min and max, `flex-basis`, and border radii.

**Value.** Only lengths interpolate. Before deciding, the plugin resolves `var()` through the theme variables Tailwind emits on `:root` (and your own root variables), so `calc(var(--spacing) * 8)` or `var(--text-xl)` is known to be `2rem` or `1.25rem` at build time. Then:

- interpolated: `px`, `rem`, `em` and the other absolute or font-relative lengths, and `calc()` / `min()` / `max()` / `clamp()` over them — `mt-8`, `text-xl`, `w-96`, `max-w-md`, `mt-[31px]`, `tracking-tight`
- kept as written: keywords (`auto`, `none`, `fit-content`…), percentages (`w-full`, `w-1/2`, `p-[10%]`), viewport and container units (`w-screen`, `h-dvh`, `mt-[2vw]`), unitless numbers (`leading-none`, the `line-height` ratios `text-*` ships), and variables that can't be resolved at build time (`mt-(--gap)` with `--gap` set somewhere other than the root)

Percentages and viewport units are valid in `calc()`, but the interpolation runs over the viewport: a curve from `16rem` to `50%` would bend with the parent's width rather than the screen's. Opt them back in with `units` if that is what you want.

A kept value at a breakpoint is a wall. In `w-64 md:w-full lg:w-96` the width stays `16rem` up to `md`, is `100%` from `md` to `lg`, and is `24rem` above — exactly Tailwind — rather than bending towards `24rem` below `md`. The twin publishes a stop token at `md` that the interpolator checks before looking further up.

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
  properties: [...],     // which properties to make fluid (see index.js for defaults)
  layers: 'auto',        // 'auto': utilities if present, else all; null: all; or a list of layer names
  units: [...],          // units that interpolate; default: px, rem, em and other absolute lengths
}
```

`layers: 'auto'` reads `@layer utilities` when the stylesheet has one and every rule otherwise. Pass a list to name the layers yourself, or `null` to read everything regardless.

`units` lists the units a value may use to interpolate. Add `'%'` or `'vw'` to let `w-full md:w-64` or `mt-[2vw]` take part, accepting that the curve then depends on the parent or the viewport twice over.

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

Twins compress well because they repeat selectors and values already in the file. Expect roughly a fifth on top of your CSS over the wire. These numbers predate the length-only fence (0.4), which skips percentage, viewport and ratio values, so current builds should come in at or below them.

## What is and isn't picked up

Every rule that has the specificity of one class — a single class selector, optionally wrapped in `:where()` the way class-based `dark:` is — and sits in at-rules only. So:

- `mt-6`, `md:mt-8`, `xl:text-lg`, `2xl:mt-11`, `min-[900px]:mt-8` — yes, these are the tokens
- `dark:mt-10`, `max-md:mt-2`, `print:mt-0`, `@md:mt-8` (container), `supports-[…]:mt-4` — yes: the value becomes the *base* token, under that condition
- `dark:md:mt-4`, `md:max-lg:mt-8` — yes: the `md` token, under the remaining condition
- `hover:mt-8`, `group-hover:mt-8`, `first:mt-0`, `[&_p]:mt-4` — left alone; their extra specificity keeps beating the twins, exactly as in Tailwind
- `md:mt-auto`, `max-w-none`, `w-fit`, `md:w-full`, `md:leading-none` — not lengths; the twin re-asserts the value so it keeps winning, and stops the interpolation below it
- `padding: 0 20px`, `margin: 1px 2px 3px 4px`, `gap: 8px 12px`, `inset: 1px 2px` — split into their longhands first, so each component interpolates on its own
- `border-radius: 1px 2px` — left alone; its values map to corners and the elliptical `/` form does not split
- `mt-6!` — left alone; `!important` opts a declaration out
- `md:flex`, `md:bg-red-500` — not a fluid property

Tailwind's own `container` class is picked up like anything else: it sets `max-width` once per breakpoint, so those steps become an interpolation and the container tracks the viewport instead of jumping. Drop `max-width` from `properties` to keep the steps.

If a stylesheet has responsive values for fluid properties and none of them can be read, the plugin emits a PostCSS warning rather than quietly producing nothing.

In other words a non-breakpoint variant answers "what is the value at this breakpoint under this condition", and the interpolation runs through it. This matches Tailwind wherever Tailwind's own variant order puts the condition before the breakpoints (all built-in media variants). For a custom variant Tailwind orders *after* the breakpoints, such as class-based `dark`, `mt-6 dark:mt-10 md:mt-8` is "dark base is 40, md is 32" here, where plain Tailwind would let `dark:` win at every width. Stack them (`dark:md:mt-8`) to say what you mean.

### `line-height` ratios step

Tailwind's `text-*` utilities set `line-height` to a ratio (`text-lg` → `calc(1.75 / 1.125)`). Ratios are kept as written, so in `text-sm md:text-lg` the font size interpolates but the ratio steps at `md`, exactly as in Tailwind. Since the ratio multiplies an already-fluid font size, the jump is small — about 2px at `md` here. For a fully smooth line height, give both ends a length: `text-sm/6 md:text-lg/8`, or `leading-6 md:leading-8`.

Mixing kinds is safe: `leading-6 md:leading-none` holds `1.5rem` below `md` and is `1` from there on, as in Tailwind.

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
