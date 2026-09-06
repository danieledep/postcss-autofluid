# postcss-fluid-variants

Make Tailwind's responsive utilities fluid, after the fact.

```html
<!-- this is all you write -->
<h1 class="text-2xl md:text-4xl xl:text-6xl mt-6 lg:mt-12">
```

Anywhere an element carries two or more values for the same property across breakpoints, the value now interpolates smoothly between them with `clamp()`. Anywhere it carries one, it behaves exactly like Tailwind. No tildes, no new syntax, nothing to migrate: drop the plugin in after Tailwind and existing markup becomes fluid.

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

## How it works

Tailwind emits one rule per class. A responsive variant is just a rule inside a `min-width` media query:

```css
.mt-6 { margin-top: calc(var(--spacing) * 6) }
@media (width >= 48rem) { .md\:mt-8 { margin-top: calc(var(--spacing) * 8) } }
```

That rule already contains everything needed: the breakpoint (from the media query) and the property and value (from the declaration). The plugin leaves it in place and appends an unconditional twin that publishes the value as a breakpoint-tagged token, then hands the property to a shared CSS function:

```css
@layer utilities {
  @supports (top: --fl()) {
    @function --fl(--v0, --v48rem) { /* one interpolator, ~1kb, emitted once */ }
    @function --fl-margin-top() {
      result: --fl(var(--fl-margin-top-0), var(--fl-margin-top-48rem));
    }
    .mt-6      { --fl-margin-top-0: calc(var(--spacing) * 6);     margin-top: --fl-margin-top() }
    .md\:mt-8  { --fl-margin-top-48rem: calc(var(--spacing) * 8); margin-top: --fl-margin-top() }
  }
}
```

The plugin never needs to know which classes share an element. Each class contributes one uniquely-named token; the browser's cascade assembles whichever tokens happen to co-occur; `--fl()` walks `var()` fallbacks to the nearest defined token below and above the current viewport, reads their widths with `if(style())`, and interpolates. A single token means `--hi` falls back to `--lo` and the clamp collapses to the plain value.

Why not a Tailwind plugin? Because inside Tailwind's plugin API the breakpoint is known to the variant and the property to the utility, and neither can see the other. Tailwind's output is the first place both facts sit on the same node. See [the write-up](https://dan-webnotes.com/posts/2025-07-02-generate-fluid-styles-tailwind-plugin/) for the earlier attempts.

## Runtime requirements

The generated CSS relies on three features that, as of September 2026, ship in Chromium 140+ only:

- `@function` — CSS custom functions
- `if()` with `style()` queries
- typed arithmetic in `calc()` (dividing a length by a length)

Everything is wrapped in `@supports (top: --fl())`, so browsers without custom functions ignore the whole block and get Tailwind's original breakpoint behaviour. There is no degraded middle state.

## Options

```js
'postcss-fluid-variants': {
  prefix: 'fl',          // token and function names: --fl, --fl-<prop>, --fl-<prop>-<bp>
  minWidth: '20rem',     // viewport where the base (unprefixed) value sits
  layer: 'utilities',    // cascade layer to emit into; false for unlayered
  properties: [...],     // which properties to make fluid (see index.js for defaults)
}
```

Default properties are the length-valued ones where interpolation makes sense: margins, paddings, insets, gaps, `font-size`, `line-height`, `letter-spacing`, `text-indent`, sizes, and border radii.

## What is and isn't picked up

Only rules that are a single class selector, sitting directly in a `min-width` media query (or unconditionally), inside a `@layer` or at the root. So:

- `mt-6`, `md:mt-8`, `xl:text-lg` — yes
- `hover:mt-8`, `dark:md:mt-8`, `@md:mt-8` (container), `max-md:mt-8` — no, left alone
- `md:flex`, `md:bg-red-500` — no, not interpolable
- values like `auto`, `none`, `fit-content` — skipped

A `max-*` variant or a non-breakpoint variant on the same property still works; it just isn't part of the interpolation.

## Testing

```sh
npm test
```

Uses `node:test`. No dependencies beyond `postcss`.

## License

MIT
