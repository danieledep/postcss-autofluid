# postcss-autofluid

Make Tailwind's responsive type and spacing fluid, after the fact.

```html
<!-- this is all you write -->
<h1 class="text-2xl md:text-4xl xl:text-6xl mt-6 lg:mt-12">
```

Anywhere an element carries two or more lengths for the same property across breakpoints, the value now interpolates smoothly between them instead of jumping at each breakpoint. Anywhere it carries one, or a value that isn't a length like `w-full` or `mt-auto`, it behaves exactly like Tailwind. No tildes, no new syntax, nothing to migrate: drop the plugin in after Tailwind and existing markup becomes fluid.

See it running at [danieledep.github.io/fluid-variants-site](https://danieledep.github.io/fluid-variants-site/): every size on that page is plain responsive Tailwind made fluid by this plugin.

## Install

Not published to npm yet. Once it is:

```sh
npm install -D postcss-autofluid
```

```js
// postcss.config.js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    'postcss-autofluid': {},
  },
}
```

Order matters. This plugin reads Tailwind's *output*, so it has to run after it, and before any minifier that doesn't understand `@function`.

### CommonJS

The package is plain CommonJS, so a `require()` in a webpack, laravel-mix or Gulp config gets the plugin factory directly:

```js
// webpack.mix.js
mix.options({
  postCss: [
    require('@tailwindcss/postcss'),
    require('postcss-autofluid'),
  ],
})
```

`import autofluid from 'postcss-autofluid'` resolves to the same factory.

### Vite

With `@tailwindcss/vite`, keep Tailwind in `vite.config.js` and add this plugin to `postcss.config.js` as above; Vite runs PostCSS after the Tailwind plugin, so the order is right by construction. `@tailwindcss/postcss` in `postcss.config.js` works too.

Dev and production builds are both read. With its optimizer off (dev and watch builds) Tailwind emits nested CSS, with the media query inside the rule rather than around it; the plugin reads either shape.

One caveat: Vite's `css.transformer: 'lightningcss'` replaces PostCSS entirely, so *no* PostCSS plugin runs there and the output is plain Tailwind. Leave the transformer at its default; using Lightning CSS only as the minifier (`build.cssMinify: 'lightningcss'`) is fine.

## What changes on your site

By default, only **type and spacing in absolute or font-relative lengths** (`px`, `rem`, `em` and friends) become fluid:

- margins, paddings, insets, gaps, scroll margins and paddings (physical and logical: `ms-*`, `pe-*`, `start-*`, `space-x-*`, `space-y-*`)
- `font-size`, `line-height` (lengths, and the unitless ratios `text-*` sets), `letter-spacing`
- widths and heights with their min and max, `flex-basis`
- border radii

Everything else steps at its breakpoints exactly as in Tailwind. That includes percentages, viewport and container units, transforms, opacity, border widths and font weights, because a responsive value there is as often a switch between two states as a scale:

| Pattern | Intent | If it were fluid |
|---|---|---|
| `-translate-x-full lg:translate-x-0` | drawer hidden on mobile | half on screen at tablet widths |
| `opacity-0 md:opacity-100` | show on desktop | fades in from 320px to 768px |
| `w-full md:w-1/2` | stack, then columns | 75% wide and still stacked at 544px |
| `border-0 md:border` | border on desktop | sub-pixel hairline in between |

Each of those can be opted in with `include` (see [Options](#options)) when you do want the curve.

`sr-only` and `not-sr-only` are a switch as well, under any variant: `w-24 lg:sr-only` stays 6rem wide up to `lg` instead of shrinking towards the 1px box that hides it. Their values are never interpolated.

### Keeping one element stepped

There is no per-element switch. To keep a single utility out of the curve, mark it `!important` (`md:mt-8!`): important declarations are left alone, and the value steps at its breakpoint as in Tailwind. It also wins over every non-important `margin-top` on that element, so use it where that is what you want anyway. To keep a whole property stepped, list it in `exclude`.

### Gotchas

- **Class-based `dark:` and other custom variants Tailwind sorts after the breakpoints.** A non-breakpoint variant becomes the *base* value under its condition, so `mt-6 dark:mt-10 md:mt-8` reads as "the dark base is 40, md is 32", where plain Tailwind lets `dark:` win at every width. Stack them (`dark:md:mt-8`) to say what you mean. Built-in media variants (`max-md:`, `print:`, `prefers-color-scheme` dark) match Tailwind.
- **A theme variable set outside the stylesheet.** Utilities that read a [variable the root changes per breakpoint](#theme-variables-that-change-at-a-breakpoint) follow the values the stylesheet gives it. One set through a `style` attribute, from JavaScript, or in a stylesheet built separately (a component's scoped styles, say) is not seen, and those utilities keep following the stylesheet's values. Set it in a rule the plugin processes, or mark the utility `!important` to keep it reading the live variable.
- **Viewport and container breakpoints on one property.** With `mt-4 md:mt-8 @md:mt-12` every value is right at every breakpoint, but the step into the container value is not interpolated.
- **Percentage heights, once opted in.** When the parent's height is auto, a percentage can't resolve and the browser treats the *whole* value as auto, `3rem` and all. So in an auto-height parent, `h-12 md:h-1/2` is auto below `md` too, where plain Tailwind keeps `3rem`. Give the parent a height, or use `vh`/`dvh`.
- **Several Tailwind builds on one page.** Each stylesheet names its functions after its own breakpoints and tokens, so two builds on one page don't overwrite each other's curves. Builds that both define the *same* utility still override each other in source order, as they do without this plugin.
- **A root font size other than the browser's.** A breakpoint in `rem` or `em` is measured against the browser's default font size in a media query, and against the root's (`rem`) or the element's own (`em`) inside the curve. With `html { font-size: 62.5% }`, or `em` breakpoints, the curve runs over the wrong widths. Write those breakpoints, and `minWidth`, in `px`.
- **Browsers.** Chromium renders the fluid sizes, Firefox and Safari render plain Tailwind. Expect different sizes between breakpoints when comparing screenshots across browsers.

## How it works

Tailwind emits one rule per class. A responsive variant is just a rule inside a `min-width` media query:

```css
.mt-6 { margin-top: calc(var(--spacing) * 6) }
@media (width >= 48rem) { .md\:mt-8 { margin-top: calc(var(--spacing) * 8) } }
```

That rule already contains everything needed: the breakpoint (from the media query) and the property and value (from the declaration). The plugin leaves it in place and appends a twin that publishes the value as a breakpoint-tagged token, then hands the property to a shared CSS function:

```css
@supports (top: --fl()) {
  @function --fl_k3x9a(--v0, --v48rem) { /* one interpolator, ~1kb, emitted once */ }
  @function --fl_k3x9a-mt() {
    result: --fl_k3x9a(var(--fl-mt-0), var(--fl-mt-48rem));
  }
  @property --fl-mt-0     { syntax: "*"; inherits: false }
  @property --fl-mt-48rem { syntax: "*"; inherits: false }

  @layer utilities {
    .mt-6     { --fl-mt-0: calc(var(--spacing) * 6); margin-top: --fl_k3x9a-mt() }
    .md\:mt-8 { --fl-mt-48rem: calc(var(--spacing) * 8) }
    @media (width >= 48rem) {
      .md\:mt-8 { margin-top: --fl_k3x9a-mt() }
    }
  }
}
```

Tokens and wrappers carry a short name for their property, the one Tailwind uses for it: `mt`, `px`, `max-w`, `rounded-tl`, `gap-x`. Type uses the CSS initials `fs`, `lh` and `ls`. A property you add with `properties` keeps its full name. The property is written a few hundred times in a build, so the short names save 12 to 17% of the appended CSS.

A twin mirrors its original exactly (same selector, same at-rule ancestors, layers included, same order), so it wins precisely where the original would have won and never disturbs anything else. The one deliberate difference: the token is published *without* the breakpoint media, so the band below can already interpolate towards it.

The plugin never needs to know which classes share an element. Each class contributes one uniquely named token; the browser's cascade assembles whichever tokens happen to co-occur; the interpolator walks `var()` fallbacks to the nearest defined token below and above the current viewport, reads their widths with `if(style())`, and interpolates. A single token means the upper end falls back to the lower one and the value is the plain one.

The `_k3x9a` suffix is a short hash of the functions themselves: the interpolator and what each wrapper reads. Custom functions are global to the page, so it keeps two stylesheets with different breakpoints or different tokens from redefining each other's functions.

Why not a Tailwind plugin? Because inside Tailwind's plugin API the breakpoint is known to the variant and the property to the utility, and neither can see the other. Tailwind's output is the first place both facts sit on the same node. See [the write-up](https://dan-webnotes.com/posts/2025-07-02-generate-fluid-styles-tailwind-plugin/) for the earlier attempts.

## What gets interpolated

Three fences decide what the plugin touches, so it stays out of everything that isn't a Tailwind length utility.

**Layer.** By default only `@layer utilities` is read. Tailwind 4 puts generated utilities and your own `@utility` blocks there; `@layer components`, `@layer base` and unlayered hand-written CSS are not touched unless you list them in `layers`. Tailwind 3 output is unlayered, so it needs `layers: null` (see Options).

**Property.** The type and spacing list above, plus whatever `include` adds: `borders` (border widths by side, axis and logical side, `divide-x-*` / `divide-y-*`, `outline-width`, `outline-offset`), `transforms` (`rotate`, `scale`, and translate and scale through the per-axis variables Tailwind composes them from: `--tw-translate-x`, `--tw-scale-y`, …; Tailwind 3's `--tw-rotate` too), `opacity` and `font-weight`.

**Value.** Before deciding, the plugin resolves `var()` through the theme variables Tailwind emits on `:root` (and your own root variables), so `calc(var(--spacing) * 8)` or `var(--text-xl)` is known to be `2rem` or `1.25rem` at build time. Then:

- interpolated: absolute and font-relative lengths (`px`, `rem`, `em`, `ch`, `lh`, …) and `calc()` / `min()` / `max()` / `clamp()` over them: `mt-8`, `text-xl`, `w-96`, `max-w-md`, `mt-[31px]`, `tracking-tight`
- interpolated once opted in: percentages (`percentages`: `w-full`, `w-1/2`, `-translate-x-full`), viewport units (`viewport-units`: `w-screen`, `mt-[2vw]`), container units (`container-units`: `w-[50cqw]`)
- interpolated against each other, never against a length: unitless `line-height` values, the ratios `text-*` sets (`text-sm md:text-lg`), `leading-none`, `leading-tight`
- with `transforms`: angles on `rotate` (`rotate-0 md:rotate-90`, `rotate-[0.25turn]`) and ratios on `scale`; with `opacity`: ratios on `opacity`. A percentage and a number are the same ratio, so Tailwind's `opacity-50` and the optimizer's `.5` always meet
- with `font-weight`: numeric weights (`font-light md:font-black`, `font-[350]`), which a variable font renders at every step in between. A static font shows its nearest face, so the text still steps, just not at your breakpoints. `bold` and `bolder` are keywords and stay as written
- kept as written: keywords (`auto`, `none`, `fit-content`…), units that are not opted in, unitless numbers on any other property, variables that can't be resolved at build time (`mt-(--gap)` with `--gap` set somewhere other than the root), and transform functions (`rotate-x-*`, `skew-*`, which Tailwind writes as `rotateX(…)` inside a variable)

A kept value at a breakpoint is a wall, and so is a value of the other kind (a length where ratios interpolate, or the reverse). In `w-64 md:w-fit lg:w-96` the width stays `16rem` up to `md`, is `fit-content` from `md` to `lg`, and is `24rem` above (exactly Tailwind) rather than bending towards `24rem` below `md`. The twin publishes a stop token at `md` that the interpolator checks before looking further up. The same holds for `w-64 md:w-full lg:w-96` unless `percentages` is opted in.

Once units are opted in, the two ends of a curve need not share one, since `calc()` mixes them: `w-12 md:w-1/2` runs from `3rem` at `20rem` to exactly half the parent at `md`. Between the breakpoints the curve is straight in the viewport, so a percentage end bends with the parent's width and a `vh` end with the screen's height; the values at the breakpoints are always Tailwind's.

### Container queries

Unnamed container variants (`@md:`, `@lg:`) are breakpoints too, on the container's width. `p-2 @md:p-6` interpolates from `p-2` at a container `20rem` wide (`containerMinWidth`, which defaults to `minWidth`) to `p-6` at `28rem`, over `100cqw`. Outside any container `@md:` never applies, as in Tailwind, and the base value holds.

An element follows the container wherever one of its container queries matches, since Tailwind sorts `@` variants after breakpoints and they win. Named containers (`@md/card:`) and container queries stacked with a breakpoint (`@lg:md:`) stay conditions, as below.

### Theme variables that change at a breakpoint

Design tokens are often redefined per breakpoint on the root, and read by utilities that have no variants of their own:

```css
@theme { --h1: 64px; --spacing-xs: 12px; --input-padding: var(--spacing-xs); }
@layer theme {
  :root {
    @variant md { --h1: 96px; --spacing-xs: 16px; }
    @variant lg { --h1: 140px; }
  }
}
@utility h1 { font-size: var(--h1); }
```

`h1` interpolates 64px → 96px → 140px and `p-xs` 12px → 16px, as if each utility held a variant for every breakpoint its variable changes at. That holds through anything that reads the variable: `calc(var(--spacing-xs) * -1)` (`-mt-xs`), a fallback, or another root variable such as `--input-padding` above.

The variable itself is never touched, and only utilities on a fluid property follow it. So the fences above still hold: `grid-cols-(--columns)` steps, `translate-x-(--spacing-xs)` steps unless `transforms` is opted in, and so does everything outside the layers the plugin reads. A variable that is a length at one breakpoint and something else at another (`16px`, then `auto`) is a switch, and steps too.

`var(--h1)` only ever holds the value for the current viewport, and an interpolation needs both ends. So each value is published again under a name of its own, without its breakpoint, and the utility's tokens read those:

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

A declaration holds from its breakpoint up, until a later one says otherwise: it sets the copy at its own breakpoint and clears the ones above (`initial`), and a token that reads a cleared copy says nothing.

Each copy sits where its declaration sits (same selector, same layer, same order), so the cascade settles the copies the way it settles the variable:

- **Setting the variable again works as in Tailwind**, anywhere in the stylesheet: `.section { --spacing-xs: 4px }`, `[--spacing-xs:2px]`, `dark:[--spacing-xs:3px]`, a theme under `[data-theme]`. Inside it `p-xs` is 4px at every width; give the override its own `@variant` and it interpolates between those instead.
- **Other classes win as in Tailwind.** `p-xs sm:p-0` is 0 from `sm` up, though the variable changes at `md`; `h1 lg:text-sm` follows the variable up to 96px at `md` and then heads for `text-sm`.
- **Only the root makes a variable responsive.** One that only a component changes per breakpoint (`.card { --pad: 8px; @variant md { --pad: 16px } }`) is read live and steps, as before. That is what keeps Tailwind's own `--tw-*` variables out of it.
- **Container variants read it live.** In `@md:p-xs` the padding steps when the variable does: a container's width says nothing about the viewport's.

What the plugin cannot see, it cannot copy: see the gotcha above about values set outside the stylesheet.

## What is and isn't picked up

Every rule that has the specificity of one class (a single class selector, optionally wrapped in `:where()` the way class-based `dark:` is) and sits in at-rules only. So:

- `mt-6`, `md:mt-8`, `xl:text-lg`, `2xl:mt-11`, `min-[900px]:mt-8`: yes, these are the tokens
- `p-xs`, `mt-(--gap)`, a custom `@utility h1 { font-size: var(--h1) }`, where the root redefines the variable per breakpoint: yes, one token for each of the variable's breakpoints (see above)
- `@md:mt-8`, `@lg:p-6`: yes, container breakpoints, interpolated over the container (see above)
- `space-y-4 md:space-y-8`, `space-x-*`: yes, the twins target the same children, at the same zero specificity
- `dark:mt-10`, `max-md:mt-2`, `print:mt-0`, `@md/card:mt-8` (named container), `supports-[…]:mt-4`: yes, the value becomes the *base* token, under that condition
- `dark:md:mt-4`, `md:max-lg:mt-8`: yes, the `md` token, under the remaining condition
- `hover:mt-8`, `group-hover:mt-8`, `first:mt-0`, `[&_p]:mt-4`: left alone; their extra specificity keeps beating the twins, exactly as in Tailwind
- `md:mt-auto`, `max-w-none`, `w-fit`, and by default `md:w-full` and `md:h-1/2`: not interpolated lengths; the twin re-asserts the value so it keeps winning, and stops the interpolation below it
- `padding: 0 20px`, `margin: 1px 2px 3px 4px`, `gap: 8px 12px`, `inset: 1px 2px`, `margin-inline: 4px 8px`: split into their longhands first, so each component interpolates on its own
- `border-radius: 1px 2px`, `rounded-[4px/8px]`: left alone; its values map to corners and the elliptical `/` form does not split
- `md:rounded-full`: not a size: `calc(infinity * 1px)`, or `2147483647px` once optimized, is kept as written and stops the interpolation like a keyword
- `mt-6!`: left alone; `!important` opts a declaration out
- `md:flex`, `md:bg-red-500`: not a fluid property

Tailwind's own `container` class is picked up like anything else: it sets `max-width` once per breakpoint, so those steps become an interpolation and the container tracks the viewport instead of jumping. Pass `exclude: ['max-width']` to keep the steps.

If a stylesheet has responsive values for fluid properties and none of them can be read, the plugin emits a PostCSS warning rather than quietly producing nothing.

### `line-height` ratios and lengths

Tailwind's `text-*` utilities set `line-height` to a ratio (`text-lg` → `calc(1.75 / 1.125)`). Ratios interpolate with ratios, so in `text-sm md:text-lg` the ratio glides along with the font size instead of jumping at `md`.

A ratio never meets a length. In `text-sm/6 md:text-lg`, `1.5rem` holds up to `md` and the ratio takes over from there, as in Tailwind; `leading-6 md:leading-none` holds `1.5rem` below `md` and is `1` from there on. `leading-*` keeps winning over `text-*` the way it does in Tailwind, through `--tw-leading`.

## Options

```js
'postcss-autofluid': {
  prefix: 'fl',          // token and function names: --fl-<name>-<bp>, --fl_<hash>()
  minWidth: '20rem',     // viewport where the base (unprefixed) value sits; a number is px
  containerMinWidth: …,  // container width where the base value sits for @md: and friends; defaults to minWidth
  include: [],           // opt-in groups, see below; 'all' for every group
  properties: [...],     // replaces the default type-and-spacing list (see lib/options.js)
  exclude: [],           // properties to leave out
  layers: ['utilities'], // layer names to read; null: every rule; 'auto': utilities if present, else all
}
```

`include` takes any of these groups, or `'all'`:

| group | adds |
|---|---|
| `percentages` | `%` as an interpolating length unit |
| `viewport-units` | `vw`, `vh`, `dvh`, `svw`, `vmin`, … |
| `container-units` | `cqw`, `cqh`, `cqi`, … |
| `borders` | border widths and `outline-width`, `outline-offset` |
| `transforms` | translate, scale and rotate |
| `opacity` | `opacity` |
| `font-weight` | `font-weight`, for variable fonts |

`transforms` without `percentages` interpolates `translate-x-4 md:translate-x-12` but keeps `-translate-x-full` a wall, since `full` is a percentage.

`exclude` is the way to drop a few properties and keep the rest: `exclude: ['max-width']` keeps Tailwind's `container` stepping at its breakpoints. Names are exact, so excluding `padding` leaves `padding-top` and the other longhands fluid, and excluding `padding-top` leaves `pt-2` stepping and still winning over `p-4`. `properties` replaces the default list instead; `include` and `exclude` apply on top of either.

`layers` defaults to `['utilities']`, where Tailwind 4 puts every generated utility and your `@utility` blocks. Add `'components'` to make your own component classes fluid too: a component's fixed value then curves towards a responsive utility on the same element, and stays fixed without one. Tailwind 3 output has no layers, so pass `layers: null` (every rule) or `'auto'` (utilities when the stylesheet has that layer, every rule otherwise); if responsive values exist but none of the listed layers does, the plugin warns.

A single name can be passed as a string anywhere a list is expected (`layers: 'utilities'`, `exclude: 'max-width'`). Anything else the plugin can't use throws when it is created, with a message that names the option: an unknown option, a `minWidth` that isn't a length, an unknown group. The `units` option of 0.4 is gone, and passing it says what replaced it.

Values are copied verbatim once they pass the fence, so the token is still resolved on the element: a per-element `[--spacing:1px]` override applies, as do arbitrary values like `mt-[31px]` and `w-[calc(2rem+3px)]`. The one rewrite is a variable the root changes per breakpoint, which is read through its copies.

Breakpoints and cascade layers are discovered from Tailwind's output, not configured: custom `--breakpoint-*` values, one-off `min-[900px]:` variants and Tailwind v3's `min-width:` queries all work, and twins land in whatever layer (or no layer) the originals use. The breakpoints a root variable changes at count too, whether or not any class uses them.

## Runtime requirements

The generated CSS relies on three features that, as of November 2026, ship in Chromium 139+ only:

- `@function`: CSS custom functions
- `if()` with `style()` queries
- typed arithmetic in `calc()` (dividing a length by a length)

Everything is wrapped in `@supports (top: --fl())`, so browsers without custom functions ignore the whole block and get Tailwind's original breakpoint behaviour. There is no degraded middle state.

The output survives esbuild, Lightning CSS and cssnano minification unchanged in meaning (verified in Chromium 141), so the usual Vite or PostCSS production pipelines need no special configuration.

## Cost

Measured on four public Tailwind codebases, built with Tailwind 4.3 and minified with Lightning CSS, before 0.4. The overhead is one twin per utility of a property that varies across breakpoints somewhere in the build (properties that never vary are skipped entirely), plus the shared functions and one `@property` per token.

| codebase | utilities | fluid twins | minified | min + brotli |
|---|---|---|---|---|
| cruip landing page template | 371 | 103 | 45 → 56 kB (+24%) | 7.1 → 8.3 kB (+17%) |
| cruip open react template | 283 | 68 | 42 → 51 kB (+21%) | 6.1 → 7.1 kB (+16%) |
| tailwindcss.com | 4544 | 1163 | 448 → 546 kB (+22%) | 44 → 52 kB (+17%) |
| shadcn/ui monorepo | 2488 | 1129 | 280 → 371 kB (+33%) | 34 → 41 kB (+22%) |

Responsive theme variables add to that only where they are used: one copy per value of each variable a fluid utility reads, one token per breakpoint on each utility that reads it, and one clearing declaration per such breakpoint on the other utilities of that property.

Since those measurements, tokens got short names and each wrapper stopped naming tokens no rule publishes. On four sample builds (marketing blocks, a docs UI, a component library, a token-driven site) that took 15 to 19% off the appended CSS minified and 12 to 14% after brotli.

Twins compress well because they repeat selectors and values already in the file. Expect roughly a fifth on top of your CSS over the wire. The numbers need re-measuring on the current version: the defaults now skip percentages, viewport units, transforms, opacity and border widths, which removes twins, while logical properties, `space-*`, line-height ratios and container queries add some.

## Testing

```sh
npm test
```

Uses `node:test`. No dependencies beyond `postcss`.

`test/browser.test.mjs` additionally renders a real Tailwind build in Chromium and compares computed styles with plain Tailwind at several widths, with the defaults and with every group opted in. CI runs it on pull requests and on `main`. Locally it skips itself unless the optional tooling is installed:

```sh
npm i --no-save playwright @tailwindcss/postcss tailwindcss && npx playwright install chromium
```

Where Playwright's browser download is blocked, point `CHROMIUM_PATH` at any Chromium 139+ binary. Set `BROWSER_TEST=1` to make a missing tool fail the run instead of skipping.

## License

MIT
