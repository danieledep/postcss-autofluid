import { test } from 'node:test'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import fluidVariants from '../index.js'

// What `@tailwindcss/postcss` emits for:
//   <div class="mt-6 md:mt-8 text-base xl:text-xl 2xl:mt-11 hover:mt-8 md:flex
//               md:mt-auto mt-6! max-md:mt-2 @md:mt-8 dark:mt-10 dark:md:mt-4">
const fixture = `
@layer theme {
  :root, :host {
    --spacing: 0.25rem;
    --text-base: 1rem;
    --text-base--line-height: calc(1.5 / 1);
    --text-xl: 1.25rem;
    --text-xl--line-height: calc(1.75 / 1.25);
  }
}
@layer utilities {
  .mt-6 { margin-top: calc(var(--spacing) * 6); }
  .mt-6\\! { margin-top: calc(var(--spacing) * 6) !important; }
  .text-base {
    font-size: var(--text-base);
    line-height: var(--tw-leading, var(--text-base--line-height));
  }
  @media (hover: hover) {
    .hover\\:mt-8:hover { margin-top: calc(var(--spacing) * 8); }
  }
  @media (width < 48rem) {
    .max-md\\:mt-2 { margin-top: calc(var(--spacing) * 2); }
  }
  @media (width >= 48rem) {
    .md\\:mt-8 { margin-top: calc(var(--spacing) * 8); }
    .md\\:mt-auto { margin-top: auto; }
    .md\\:flex { display: flex; }
  }
  @media (width >= 80rem) {
    .xl\\:text-xl {
      font-size: var(--text-xl);
      line-height: var(--tw-leading, var(--text-xl--line-height));
    }
  }
  @media (width >= 96rem) {
    .\\32 xl\\:mt-11 { margin-top: calc(var(--spacing) * 11); }
  }
  @container (width >= 28rem) {
    .\\@md\\:mt-8 { margin-top: calc(var(--spacing) * 8); }
  }
  @media (prefers-color-scheme: dark) {
    .dark\\:mt-10 { margin-top: calc(var(--spacing) * 10); }
    @media (width >= 48rem) {
      .dark\\:md\\:mt-4 { margin-top: calc(var(--spacing) * 4); }
    }
  }
}
`

const run = async (css, opts) =>
  (await postcss([fluidVariants(opts)]).process(css, { from: undefined })).css

const warningsFor = async (css, opts) =>
  (await postcss([fluidVariants(opts)]).process(css, { from: undefined })).warnings().map((w) => w.text)

const appendix = async (css, opts) => {
  const out = await run(css, opts)
  return out.slice(out.indexOf('@supports'))
}

/** Collapse whitespace and normalise trailing semicolons so structural assertions fit on one line. */
const flat = (css) => css.replace(/\s+/g, ' ').replace(/;? \}/g, '; }')

test('leaves the original Tailwind output untouched', async () => {
  const out = await run(fixture)
  assert.ok(out.trimStart().startsWith(fixture.trim()))
})

test('declares one interpolator with a parameter per breakpoint found', async () => {
  const out = await appendix(fixture)
  // md:mt-auto is a wall at 48rem, so a stop parameter follows the value ones
  assert.match(out, /@function --fl\(--v0, --v48rem, --v80rem, --v96rem, --s48rem\)/)
  assert.match(out, /@media \(width >= 48rem\)/)
  assert.match(out, /@media \(width >= 96rem\)/)
  assert.match(out, /result: clamp\(min\(var\(--lo\), var\(--hi\)\)/)
})

test('walks fallbacks toward the nearest defined token', async () => {
  const out = await appendix(fixture)
  // first band: nothing below, everything above — and the md stop is checked first
  assert.match(out, /--hi: if\(style\(--s48rem\): var\(--lo\); style\(--v48rem\): var\(--v48rem\); style\(--v80rem\): var\(--v80rem\); style\(--v96rem\): var\(--v96rem\); else: var\(--lo\)\)/)
  // a band with no stop above it keeps the plain fallback chain
  assert.match(out, /--hi: var\(--v80rem, var\(--v96rem, var\(--lo\)\)\)/)
  // last band: everything below, nothing above
  assert.match(out, /--lo: var\(--v96rem, var\(--v80rem, var\(--v48rem, var\(--v0\)\)\)\)/)
  assert.match(out, /--lo-w: if\(style\(--v96rem\): 96rem; style\(--v80rem\): 80rem; style\(--v48rem\): 48rem; else: 20rem\)/)
})

test('emits one wrapper per fluid property', async () => {
  const out = await appendix(fixture)
  assert.match(out, /@function --fl-margin-top\(\)/)
  assert.match(out, /@function --fl-font-size\(\)/)
  // text-base and text-xl set line-height to ratios, which never interpolate
  assert.doesNotMatch(out, /@function --fl-line-height/)
  assert.doesNotMatch(out, /@function --fl-display/)
})

test('registers every published token as non-inherited, and nothing else', async () => {
  const out = flat(await appendix(fixture))
  for (const key of ['0', '48rem', '96rem']) {
    assert.match(out, new RegExp(`@property --fl-margin-top-${key} \\{ syntax: "\\*"; inherits: false; \\}`))
  }
  assert.match(out, /@property --fl-font-size-0 \{/)
  assert.match(out, /@property --fl-font-size-80rem \{/)
  assert.doesNotMatch(out, /@property --fl-font-size-48rem/)
  assert.doesNotMatch(out, /@property --fl-margin-top-80rem/)
  assert.doesNotMatch(out, /@property --fl-display/)
})

test('skips properties that never vary across breakpoints', async () => {
  const css = `@layer utilities { .w-full { width: 100% } .mt-6 { margin-top: 1.5rem } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } } }`
  const out = await appendix(css)
  assert.match(out, /--fl-margin-top-0/)
  assert.doesNotMatch(out, /w-full|--fl-width/)
})

test('twins live in the same layer as their originals', async () => {
  const out = flat(await appendix(fixture))
  assert.match(out, /@supports \(top: --fl\(\)\) \{ @function/)
  assert.match(out, /@layer utilities \{ \.mt-6 \{ --fl-margin-top-0: calc\(var\(--spacing\) \* 6\); margin-top: --fl-margin-top\(\); \}/)
})

test('publishes breakpoint tokens unconditionally, but hands over the property only inside the breakpoint', async () => {
  const out = flat(await appendix(fixture))
  assert.match(out, /\} \.md\\:mt-8 \{ --fl-margin-top-48rem: calc\(var\(--spacing\) \* 8\); \} @media/)
  assert.match(out, /@media \(width >= 48rem\) \{ \.md\\:mt-8 \{ margin-top: --fl-margin-top\(\); \}/)
  assert.match(out, /@media \(width >= 80rem\) \{ \.xl\\:text-xl \{ font-size: --fl-font-size\(\); \}/)
})

test('understands escaped leading digits such as 2xl', async () => {
  const out = flat(await appendix(fixture))
  assert.match(out, /\.\\32 xl\\:mt-11 \{ --fl-margin-top-96rem: calc\(var\(--spacing\) \* 11\); \}/)
  assert.match(out, /@media \(width >= 96rem\) \{ \.\\32 xl\\:mt-11 \{ margin-top: --fl-margin-top\(\); \}/)
})

test('re-asserts keyword values so they keep beating earlier twins', async () => {
  const out = flat(await appendix(fixture))
  assert.match(out, /@media \(width >= 48rem\) \{ \.md\\:mt-8 \{ margin-top: --fl-margin-top\(\); \} \.md\\:mt-auto \{ margin-top: auto; \}/)
  assert.doesNotMatch(out, /--fl-margin-top-48rem: auto/)
})

test('leaves !important declarations to win on their own', async () => {
  const out = await appendix(fixture)
  assert.doesNotMatch(out, /mt-6\\!/)
})

test('mirrors non-breakpoint conditions instead of skipping them', async () => {
  const out = flat(await appendix(fixture))
  // a max-width variant is a base token that only exists below the breakpoint
  assert.match(out, /@media \(width < 48rem\) \{ \.max-md\\:mt-2 \{ --fl-margin-top-0: calc\(var\(--spacing\) \* 2\); margin-top: --fl-margin-top\(\); \}/)
  // container queries and colour schemes likewise
  assert.match(out, /@container \(width >= 28rem\) \{ \.\\@md\\:mt-8 \{ --fl-margin-top-0: calc\(var\(--spacing\) \* 8\); margin-top: --fl-margin-top\(\); \}/)
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{ \.dark\\:mt-10 \{ --fl-margin-top-0: calc\(var\(--spacing\) \* 10\); margin-top: --fl-margin-top\(\); \}/)
})

test('strips only the breakpoint from a stacked variant token', async () => {
  const out = flat(await appendix(fixture))
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{ \.dark\\:mt-10 \{[^}]*\} \.dark\\:md\\:mt-4 \{ --fl-margin-top-48rem: calc\(var\(--spacing\) \* 4\); \} @media \(width >= 48rem\) \{ \.dark\\:md\\:mt-4 \{ margin-top: --fl-margin-top\(\); \}/)
})

test('ignores non-fluid properties and selectors with extra specificity', async () => {
  const out = await appendix(fixture)
  assert.doesNotMatch(out, /md\\:flex/)
  assert.doesNotMatch(out, /hover\\:mt-8/)
})

test('accepts the zero-specificity :where() wrapper of class-based variants', async () => {
  const css = `.mt-6 { margin-top: 1.5rem } .dark\\:mt-10:where(.dark, .dark *) { margin-top: 2.5rem } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } }`
  const out = flat(await appendix(css))
  assert.match(out, /\.dark\\:mt-10:where\(\.dark, \.dark \*\) \{ --fl-margin-top-0: 2\.5rem; margin-top: --fl-margin-top\(\); \}/)
})

test('works on unlayered Tailwind v3 output', async () => {
  const css = `.mt-6 { margin-top: 1.5rem } @media (min-width: 768px) { .md\\:mt-8 { margin-top: 2rem } }`
  const out = flat(await appendix(css))
  assert.match(out, /@function --fl\(--v0, --v768px\)/)
  assert.doesNotMatch(out, /@layer/)
  assert.match(out, /\.md\\:mt-8 \{ --fl-margin-top-768px: 2rem; \} @media \(min-width: 768px\) \{ \.md\\:mt-8 \{ margin-top: --fl-margin-top\(\); \}/)
})

test('is a no-op when nothing is fluidable', async () => {
  const css = `.flex { display: flex } @media (width >= 48rem) { .md\\:mt-auto { margin-top: auto } }`
  assert.equal(await run(css), css)
})

test('honours prefix and minWidth options', async () => {
  const out = await appendix(fixture, { prefix: 'fluid', minWidth: '320px' })
  assert.match(out, /@function --fluid\(/)
  assert.match(out, /--fluid-margin-top-48rem/)
  assert.match(out, /else: 320px\)/)
})

test('gives every generated node a source location', async () => {
  const root = postcss.parse(fixture, { from: '/app.css' })
  await postcss([fluidVariants()]).process(root, { from: '/app.css' })
  const missing = []
  root.walk((node) => { if (!node.source?.input.file) missing.push(node.type + ' ' + (node.selector || node.prop || node.params)) })
  assert.deepEqual(missing, [])
  const twin = root.last.nodes.find((n) => n.name === 'layer').nodes.find((n) => n.selector === '.mt-6')
  assert.equal(twin.source.start.line, fixture.split('\n').findIndex((l) => l.includes('.mt-6 {')) + 1)
})

/**
 * Turn flat output — `@media { .sel { … } }` — into the nested shape Tailwind
 * emits when its optimizer is off: `.sel { @media { … } }`. Only top-level
 * media whose children are all rules are inverted, which is enough to mirror
 * every flat fixture here.
 */
function nest(css) {
  const root = postcss.parse(css)
  root.walkAtRules('media', (at) => {
    if (at.parent?.type !== 'root') return
    const replacements = []
    at.each((rule) => {
      if (rule.type !== 'rule') return
      const inner = at.clone({ nodes: [] })
      rule.each((node) => inner.append(node.clone()))
      replacements.push(rule.clone({ nodes: [inner] }))
    })
    if (replacements.length === at.nodes.length) at.replaceWith(replacements)
  })
  return root.toString()
}

const equivalent = async (css, opts) => {
  const flat = await appendix(css, opts)
  const nested = await appendix(nest(css), opts)
  assert.equal(nested, flat)
  return flat
}

test('reads a breakpoint nested inside its rule, not just above it', async () => {
  const out = await appendix(
    `.md\\:mt-8 { @media (width >= 48rem) { margin-top: 2rem } } .mt-6 { margin-top: 1.5rem }`,
  )
  assert.match(flat(out), /\.md\\:mt-8 \{ --fl-margin-top-48rem: 2rem; \}/)
  assert.match(flat(out), /@media \(width >= 48rem\) \{ \.md\\:mt-8 \{ margin-top: --fl-margin-top\(\); \}/)
})

test('flat and nested input produce identical appendices', async () => {
  // simple responsive
  assert.match(
    await equivalent(`.mt-6 { margin-top: 1.5rem } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } } @media (width >= 64rem) { .lg\\:mt-12 { margin-top: 3rem } }`),
    /@function --fl\(--v0, --v48rem, --v64rem\)/,
  )
  // two properties under one breakpoint share a group
  assert.match(
    await equivalent(`.p-4 { padding: 1rem } @media (width >= 48rem) { .md\\:p-8 { padding: 2rem; margin-top: 2rem } }`),
    /@media \(width >= 48rem\)/,
  )
  // an ancestor at-rule and a descendant one combine in the right order
  // (the breakpoint sits outside the layer, so every layer has to be read)
  assert.match(
    await equivalent(`@layer utilities { .mt-6 { margin-top: 1.5rem } } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } }`, { layers: null }),
    /@layer utilities/,
  )
  // a keyword value emits no functions at all
  assert.doesNotMatch(
    await equivalent(`.mt-6 { margin-top: 1.5rem } @media (width >= 48rem) { .md\\:mt-auto { margin-top: auto } }`),
    /--fl-margin-top-48rem:/,
  )
})

test('skips &-nested rules in the nested shape, as it does when flattened', async () => {
  const out = await appendix(
    `.mt-6 { margin-top: 1.5rem } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } } .hover\\:mt-8 { &:hover { @media (width >= 48rem) { margin-top: 2rem } } }`,
  )
  assert.doesNotMatch(out, /hover/)
})

test('reads a breakpoint nested two deep inside a rule', async () => {
  const out = flat(await appendix(
    `.mt-6 { margin-top: 1.5rem } .dark\\:md\\:mt-4 { @media (prefers-color-scheme: dark) { @media (width >= 48rem) { margin-top: 1rem } } }`,
  ))
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{ \.dark\\:md\\:mt-4 \{ --fl-margin-top-48rem: 1rem; \} @media \(width >= 48rem\) \{ \.dark\\:md\\:mt-4 \{ margin-top: --fl-margin-top\(\); \}/)
})

test('warns instead of silently emitting nothing when responsive values go unread', async () => {
  // every responsive utility is behind extra specificity, so none is readable
  const warnings = await warningsFor(`@media (width >= 48rem) { .md\\:mt-8 > p { margin-top: 2rem } }`)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /nothing was made fluid/)
})

test('stays silent when there is simply nothing responsive to make fluid', async () => {
  for (const css of [
    `.flex { display: flex }`,
    `@media (width >= 48rem) { .md\\:flex { display: flex } }`,
    `@media (width >= 48rem) { .md\\:mt-auto { margin-top: auto } }`,
  ]) {
    assert.deepEqual(await warningsFor(css), [], css)
  }
})

// ── Fences: layer, value kind, walls ───────────────────────────────────────

const themed = (body) => `@layer theme { :root, :host { --spacing: 0.25rem; --leading-none: 1; --container-md: 28rem } } ${body}`

test('reads only @layer utilities when the stylesheet has one', async () => {
  const css = themed(`
    @layer components { .card { padding: 1rem } @media (width >= 48rem) { .card { padding: 2rem } } }
    @layer utilities { .mt-6 { margin-top: 1.5rem } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } } }`)
  const out = await appendix(css)
  assert.match(out, /--fl-margin-top-48rem/)
  assert.doesNotMatch(out, /\.card|--fl-padding/)
  // an explicit null reads every layer again
  assert.match(await appendix(css, { layers: null }), /\.card \{ --fl-padding-48rem: 2rem/)
})

test('does not warn about responsive CSS outside the layers it reads', async () => {
  const css = themed(`@layer components { @media (width >= 48rem) { .card { padding: 2rem } } } @layer utilities { .flex { display: flex } }`)
  assert.deepEqual(await warningsFor(css), [])
})

test('interpolates lengths resolved through the theme, and nothing else', async () => {
  const css = themed(`@layer utilities {
    .w-64 { width: calc(var(--spacing) * 64) }
    .w-full { width: 100% }
    .w-1\\/2 { width: calc(1/2 * 100%) }
    .w-screen { width: 100vw }
    .w-\\(--x\\) { width: var(--x) }
    .max-w-md { max-width: var(--container-md) }
    @media (width >= 48rem) {
      .md\\:w-96 { width: calc(var(--spacing) * 96) }
      .md\\:max-w-\\[40rem\\] { max-width: 40rem }
    }
  }`)
  const out = flat(await appendix(css))
  assert.match(out, /\.w-64 \{ --fl-width-0: calc\(var\(--spacing\) \* 64\); width: --fl-width\(\); \}/)
  assert.match(out, /\.max-w-md \{ --fl-max-width-0: var\(--container-md\);/)
  // percentages, viewport units and unknown variables keep their value
  assert.match(out, /\.w-full \{ width: 100%; \}/)
  assert.match(out, /\.w-1\\\/2 \{ width: calc\(1\/2 \* 100%\); \}/)
  assert.match(out, /\.w-screen \{ width: 100vw; \}/)
  assert.match(out, /\.w-\\\(--x\\\) \{ width: var\(--x\); \}/)
  assert.doesNotMatch(out, /--fl-width-0: (100%|calc\(1\/2|100vw|var\(--x\))/)
})

test('lets units opt relative lengths back in', async () => {
  const css = `.w-full { width: 100% } @media (width >= 48rem) { .md\\:w-64 { width: 16rem } }`
  assert.match(flat(await appendix(css, { units: ['rem', '%'] })), /\.w-full \{ --fl-width-0: 100%;/)
})

test('treats unitless values as fixed, so line-height ratios never meet lengths', async () => {
  const css = themed(`@layer utilities {
    .leading-6 { line-height: calc(var(--spacing) * 6) }
    @media (width >= 48rem) { .md\\:leading-none { line-height: var(--leading-none) } .md\\:leading-10 { line-height: calc(var(--spacing) * 10) } }
  }`)
  const out = flat(await appendix(css))
  assert.match(out, /\.leading-6 \{ --fl-line-height-0: calc\(var\(--spacing\) \* 6\);/)
  assert.match(out, /\.md\\:leading-10 \{ --fl-line-height-48rem:/)
  assert.match(out, /\.md\\:leading-none \{ --fl-line-height-48rem-stop: 1; \}/)
  assert.doesNotMatch(out, /--fl-line-height-48rem: var\(--leading-none\)/)
})

test('a fixed value at a breakpoint is a wall the band below cannot see past', async () => {
  const css = themed(`@layer utilities {
    .w-64 { width: calc(var(--spacing) * 64) }
    @media (width >= 48rem) { .md\\:w-full { width: 100% } }
    @media (width >= 64rem) { .lg\\:w-96 { width: calc(var(--spacing) * 96) } }
  }`)
  const out = flat(await appendix(css))
  // the stop is published without the breakpoint, the value re-asserted inside it
  assert.match(out, /\.md\\:w-full \{ --fl-width-48rem-stop: 1; \} @media \(width >= 48rem\) \{ \.md\\:w-full \{ width: 100%; \}/)
  assert.match(out, /@function --fl\(--v0, --v48rem, --v64rem, --s48rem\)/)
  assert.match(out, /--hi: if\(style\(--s48rem\): var\(--lo\); style\(--v48rem\): var\(--v48rem\); style\(--v64rem\): var\(--v64rem\); else: var\(--lo\)\)/)
  assert.match(out, /--hi-w: if\(style\(--s48rem\): 48rem; style\(--v48rem\): 48rem; style\(--v64rem\): 64rem; else: 99999px\)/)
  assert.match(out, /@property --fl-width-48rem-stop \{ syntax: "\*"; inherits: false; \}/)
  assert.match(out, /--fl-width\(\) \{ result: --fl\(var\(--fl-width-0\), var\(--fl-width-48rem\), var\(--fl-width-64rem\), var\(--fl-width-48rem-stop\)\); \}/)
})

test('a property whose only responsive values are fixed is left alone', async () => {
  const css = themed(`@layer utilities { .w-64 { width: 16rem } @media (width >= 48rem) { .md\\:w-full { width: 100% } } }`)
  assert.equal(await run(css), css)
})

test('publishes a bare zero as 0px, since 0 inside calc() is a number', async () => {
  // Tailwind's optimizer emits `top: 0` for `top-0` and `margin-top: 0` for `mt-0`
  const css = `.top-0 { top: 0 } .mt-0 { margin-top: 0 } @media (width >= 48rem) { .md\\:top-4 { top: 1rem } .md\\:mt-8 { margin-top: 2rem } }`
  const out = flat(await appendix(css))
  assert.match(out, /\.top-0 \{ --fl-top-0: 0px; top: --fl-top\(\); \}/)
  assert.match(out, /\.mt-0 \{ --fl-margin-top-0: 0px;/)
})

test('points the no-op warning at the first unread declaration', async () => {
  const css = `@media (width >= 48rem) { .md\\:mt-8 > p { margin-top: 2rem } }`
  const [warning] = (await postcss([fluidVariants()]).process(css, { from: undefined })).warnings()
  assert.equal(warning.plugin, 'postcss-fluid-variants')
  assert.equal(warning.node.prop, 'margin-top')
  assert.equal(warning.line, 1)
})

// What `@tailwindcss/postcss` 4.3 emits for `h1 md:h0 md:h2 md:h3` with
//   @utility h0 { font-size: 64px; line-height: 72px; @variant md { font-size: 88px; line-height: 96px; } }
//   @utility h1 { font-size: 48px; line-height: 56px; @variant md { font-size: 64px; line-height: 72px; } }
//   @utility h2 { font-size: 40px; @variant lg { font-size: 56px; } }
//   @utility h3 { font-size: 30px; @variant max-lg { font-size: 20px; } }
// `md:` on a utility with its own `@variant md` nests one breakpoint in another.
const nestedVariants = {
  dev: `
@layer utilities {
  .h1 {
    font-size: 48px;
    line-height: 56px;
    @media (width >= 48rem) {
      font-size: 64px;
      line-height: 72px;
    }
  }
  @media (width >= 48rem) {
    .md\\:h0 {
      font-size: 64px;
      line-height: 72px;
    }
    @media (width >= 48rem) {
      .md\\:h0 {
        font-size: 88px;
        line-height: 96px;
      }
    }
    .md\\:h2 {
      font-size: 40px;
    }
    @media (width >= 64rem) {
      .md\\:h2 {
        font-size: 56px;
      }
    }
    .md\\:h3 {
      font-size: 30px;
    }
    @media (width < 64rem) {
      .md\\:h3 {
        font-size: 20px;
      }
    }
  }
}
`,
  // The optimizer also merges `.h1` and `.md\\:h0` into one list at md.
  optimized: `@layer utilities{.h1{font-size:48px;line-height:56px}@media (min-width:48rem){.h1,.md\\:h0{font-size:64px;line-height:72px}@media (min-width:48rem){.md\\:h0{font-size:88px;line-height:96px}}.md\\:h2{font-size:40px}@media (min-width:64rem){.md\\:h2{font-size:56px}}.md\\:h3{font-size:30px}@media not all and (min-width:64rem){.md\\:h3{font-size:20px}}}}`,
}

/** Every publication of a token for a selector, in order, with the media queries it sits under. */
const publications = (css, selector, name) => {
  const out = []
  postcss.parse(css.slice(css.indexOf('@supports'))).walkDecls(name, (d) => {
    if (d.parent.selector !== selector) return
    const media = []
    for (let p = d.parent.parent; p.type !== 'root'; p = p.parent) if (p.name === 'media') media.unshift(p.params)
    out.push({ value: d.value, media })
  })
  return out
}

for (const [shape, css] of Object.entries(nestedVariants)) {
  test(`a breakpoint nested in the same breakpoint publishes the inner value last (${shape} output)`, async () => {
    const out = await run(css)
    for (const [prop, inner] of [['font-size', '88px'], ['line-height', '96px']]) {
      const tokens = publications(out, '.md\\:h0', `--fl-${prop}-48rem`)
      // the inner value wins at md and up, as it does in plain Tailwind, and is
      // published without media so the band below can interpolate towards it
      assert.equal(tokens.at(-1)?.value, inner, `${prop}: ${JSON.stringify(tokens)}`)
      for (const { media } of tokens) assert.deepEqual(media, [], prop)
    }
    // the merged `.h1, .md\\:h0` list still twins `.h1`
    assert.deepEqual(publications(out, '.h1', '--fl-font-size-48rem'), [{ value: '64px', media: [] }])
  })

  test(`a breakpoint nested in a lower one publishes at the higher breakpoint (${shape} output)`, async () => {
    const out = await run(css)
    assert.deepEqual(publications(out, '.md\\:h2', '--fl-font-size-48rem'), [{ value: '40px', media: [] }])
    assert.deepEqual(publications(out, '.md\\:h2', '--fl-font-size-64rem'), [{ value: '56px', media: [] }])
  })

  test(`a max-width variant nested in a breakpoint stays a condition, after the outer value (${shape} output)`, async () => {
    const out = await run(css)
    const tokens = publications(out, '.md\\:h3', '--fl-font-size-48rem')
    assert.equal(tokens.length, 2)
    assert.deepEqual(tokens[0], { value: '30px', media: [] })
    assert.equal(tokens[1].value, '20px')
    assert.equal(tokens[1].media.length, 1)
    assert.doesNotMatch(tokens[1].media[0], /^\((?:min-)?width\s*(?:>=|:)/)
  })
}
