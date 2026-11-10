import { test } from 'node:test'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import autofluid from '../index.js'

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

// Most cases below are bare fragments with no layers, shaped like Tailwind v3
// output, so they read every rule; anything layered keeps the default.
const options = (css, opts) => ({ ...(/@layer\b/.test(css) ? {} : { layers: null }), ...opts })

const unhash = (css) => css.replace(/--([a-z][a-z0-9-]*?)_[0-9a-z]{5}\b/g, '--$1')
const run = async (css, opts) =>
  unhash((await postcss([autofluid(options(css, opts))]).process(css, { from: undefined })).css)

const warningsFor = async (css, opts) =>
  (await postcss([autofluid(options(css, opts))]).process(css, { from: undefined })).warnings().map((w) => w.text)

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
  // container breakpoints (@md:) follow the viewport ones, then the stops and the container flag
  assert.match(out, /@function --fl\(--v0, --v48rem, --v80rem, --v96rem, --vc28rem, --s48rem, --cq\)/)
  assert.match(out, /@media \(width >= 48rem\)/)
  assert.match(out, /@media \(width >= 96rem\)/)
  assert.match(out, /result: if\(style\(--cq\): clamp\(min\(var\(--clo\), var\(--chi\)\)/)
  assert.match(out, /; style\(--v48rem\) or style\(--s48rem\) or style\(--v80rem\) or style\(--v96rem\): clamp\(min\(var\(--lo\), var\(--hi\)\)/)
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
  // text-base and text-xl set line-height to ratios: their own family, no length one
  assert.match(out, /@function --fl-line-height-num\(\)/)
  assert.doesNotMatch(out, /@function --fl-line-height\(\)/)
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
  assert.match(out, /@media \(width >= 80rem\) \{ \.xl\\:text-xl \{ font-size: --fl-font-size\(\); line-height: --fl-line-height-num\(\); \}/)
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
  // colour schemes likewise
  
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
  await postcss([autofluid()]).process(root, { from: '/app.css' })
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

test('reads only the utilities layer by default, and says so when the stylesheet has none', async () => {
  const v3 = `.mt-6 { margin-top: 1.5rem } @media (min-width: 768px) { .md\\:mt-8 { margin-top: 2rem } }`
  const plugin = (opts) => postcss([autofluid(opts)]).process(v3, { from: undefined })
  const res = await plugin()
  assert.equal(res.css, v3)
  assert.equal(res.warnings().length, 1)
  assert.match(res.warnings()[0].text, /none inside @layer utilities.*layers: null/)
  // 'auto' and null read unlayered output
  for (const layers of ['auto', null]) assert.match((await plugin({ layers })).css, /--fl-margin-top-768px: 2rem/)
  // a plain stylesheet with nothing responsive stays silent
  assert.deepEqual((await postcss([autofluid()]).process(`.a { margin-top: 1rem }`, { from: undefined })).warnings(), [])
})

test('does not warn about responsive CSS outside the layers it reads', async () => {
  const css = themed(`@layer components { @media (width >= 48rem) { .card { padding: 2rem } } } @layer utilities { .flex { display: flex } }`)
  assert.deepEqual(await warningsFor(css), [])
})

test('with percentages and viewport and container units opted in, interpolates every length and nothing else', async () => {
  const css = themed(`@layer utilities {
    .w-64 { width: calc(var(--spacing) * 64) }
    .w-full { width: 100% }
    .w-1\\/2 { width: calc(1/2 * 100%) }
    .w-screen { width: 100vw }
    .w-\\[50cqw\\] { width: 50cqw }
    .w-\\(--x\\) { width: var(--x) }
    .w-fit { width: fit-content }
    .max-w-md { max-width: var(--container-md) }
    @media (width >= 48rem) {
      .md\\:w-96 { width: calc(var(--spacing) * 96) }
      .md\\:max-w-\\[40rem\\] { max-width: 40rem }
    }
  }`)
  const out = flat(await appendix(css, { include: ['percentages', 'viewport-units', 'container-units'] }))
  assert.match(out, /\.w-64 \{ --fl-width-0: calc\(var\(--spacing\) \* 64\); width: --fl-width\(\); \}/)
  assert.match(out, /\.max-w-md \{ --fl-max-width-0: var\(--container-md\);/)
  // calc() mixes them with rem, so the two ends need not share a unit
  assert.match(out, /\.w-full \{ --fl-width-0: 100%; width: --fl-width\(\); \}/)
  assert.match(out, /\.w-1\\\/2 \{ --fl-width-0: calc\(1\/2 \* 100%\);/)
  assert.match(out, /\.w-screen \{ --fl-width-0: 100vw;/)
  assert.match(out, /\.w-\\\[50cqw\\\] \{ --fl-width-0: 50cqw;/)
  // keywords and unknown variables keep their value
  assert.match(out, /\.w-\\\(--x\\\) \{ width: var\(--x\); \}/)
  assert.match(out, /\.w-fit \{ width: fit-content; \}/)
  assert.doesNotMatch(out, /--fl-width-0: (fit-content|var\(--x\))/)
})

test('interpolates opted-in percentage heights and offsets too', async () => {
  const css = `.h-12 { height: 3rem } .top-4 { top: 1rem }
    @media (width >= 48rem) { .md\\:h-1\\/2 { height: 50% } .md\\:top-1\\/2 { top: 50% } }`
  const out = flat(await appendix(css, { include: 'percentages' }))
  assert.match(out, /\.md\\:h-1\\\/2 \{ --fl-height-48rem: 50%; \}/)
  assert.match(out, /\.md\\:top-1\\\/2 \{ --fl-top-48rem: 50%; \}/)
})

test('with borders opted in, splits border widths into their sides and axes', async () => {
  const css = `.border-2 { border-width: 2px } .border-\\[1px_2px\\] { border-width: 1px 2px } .border-x-2 { border-inline-width: 2px 4px }
    @media (width >= 48rem) { .md\\:border-8 { border-width: 8px } .md\\:border-y-4 { border-block-width: 4px } .md\\:border-s-4 { border-inline-start-width: 4px } }`
  const out = flat(await appendix(css, { include: 'borders' }))
  assert.match(out, /\.border-2 \{ --fl-border-width-0: 2px; border-width: --fl-border-width\(\); \}/)
  // only the longhands with a responsive value anywhere get tokens
  assert.match(out, /\.border-\\\[1px_2px\\\] \{ --fl-border-block-width-0: 1px; border-block-width: --fl-border-block-width\(\); \}/)
  assert.match(out, /\.border-x-2 \{ --fl-border-inline-start-width-0: 2px; border-inline-start-width: --fl-border-inline-start-width\(\); \}/)
  assert.match(out, /\.md\\:border-y-4 \{ --fl-border-block-width-48rem: 4px; \}/)
})

test('with transforms and opacity opted in, interpolates Tailwind transform variables, rotate angles and opacity', async () => {
  const css = themed(`@layer utilities {
    .translate-x-4 { --tw-translate-x: calc(var(--spacing) * 4); translate: var(--tw-translate-x) var(--tw-translate-y) }
    .scale-100 { --tw-scale-x: 100%; --tw-scale-y: 100%; --tw-scale-z: 100%; scale: var(--tw-scale-x) var(--tw-scale-y) }
    .-scale-y-110 { --tw-scale-y: calc(110% * -1); scale: var(--tw-scale-x) var(--tw-scale-y) }
    .rotate-0 { rotate: 0 } .opacity-50 { opacity: 50% } .opacity-0 { opacity: 0 }
    .rotate-x-12 { --tw-rotate-x: rotateX(12deg) }
    @media (width >= 48rem) {
      .md\\:translate-x-1\\/2 { --tw-translate-x: calc(1 / 2 * 100%); translate: var(--tw-translate-x) var(--tw-translate-y) }
      .md\\:scale-150 { --tw-scale-x: 150%; --tw-scale-y: 150%; --tw-scale-z: 150%; scale: var(--tw-scale-x) var(--tw-scale-y) }
      .md\\:rotate-45 { rotate: 45deg } .md\\:opacity-100 { opacity: 1 } .md\\:rotate-x-45 { --tw-rotate-x: rotateX(45deg) }
    }
  }`)
  const out = flat(await appendix(css, { include: ['transforms', 'opacity', 'percentages'] }))
  // the variable is the property; its tokens drop the leading dashes
  assert.match(out, /\.translate-x-4 \{ --fl-tw-translate-x-0: calc\(var\(--spacing\) \* 4\); --tw-translate-x: --fl-tw-translate-x\(\); \}/)
  assert.match(out, /@function --fl-tw-translate-x\(\) \{ result: --fl\(var\(--fl-tw-translate-x-0\), var\(--fl-tw-translate-x-48rem\)\); \}/)
  assert.match(out, /\.md\\:translate-x-1\\\/2 \{ --fl-tw-translate-x-48rem: calc\(1 \/ 2 \* 100%\); \}/)
  // a ratio's percentage is published as its number
  assert.match(out, /\.scale-100 \{ --fl-tw-scale-x-0: 1; --fl-tw-scale-y-0: 1; --fl-tw-scale-z-0: 1; --tw-scale-x: --fl-tw-scale-x\(\);/)
  assert.match(out, /\.-scale-y-110 \{ --fl-tw-scale-y-0: calc\(1\.1 \* -1\);/)
  assert.match(out, /\.md\\:scale-150 \{ --fl-tw-scale-x-48rem: 1\.5;/)
  assert.match(out, /\.opacity-50 \{ --fl-opacity-0: 0\.5;/)
  assert.match(out, /\.opacity-0 \{ --fl-opacity-0: 0;/)
  assert.match(out, /\.md\\:opacity-100 \{ --fl-opacity-48rem: 1; \}/)
  // an angle's zero is 0deg; transform functions are not values
  assert.match(out, /\.rotate-0 \{ --fl-rotate-0: 0deg;/)
  assert.match(out, /\.md\\:rotate-45 \{ --fl-rotate-48rem: 45deg; \}/)
  assert.doesNotMatch(out, /--fl-tw-rotate-x/)
  // the composed `translate` / `scale` declarations are left to Tailwind
  assert.doesNotMatch(out, /--fl-translate|--fl-scale-/)
})

test('reads opted-in Tailwind 3 transforms, which compose every axis in transform', async () => {
  const css = `.rotate-0 { --tw-rotate: 0deg; transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) }
    .scale-100 { --tw-scale-x: 1; --tw-scale-y: 1; transform: translate(var(--tw-translate-x), var(--tw-translate-y)) scale(var(--tw-scale-x), var(--tw-scale-y)) }
    @media (min-width: 768px) {
      .md\\:rotate-45 { --tw-rotate: 45deg; transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) }
      .md\\:scale-150 { --tw-scale-x: 1.5; --tw-scale-y: 1.5; transform: translate(var(--tw-translate-x), var(--tw-translate-y)) scale(var(--tw-scale-x), var(--tw-scale-y)) }
    }`
  const out = flat(await appendix(css, { include: 'transforms' }))
  assert.match(out, /\.rotate-0 \{ --fl-tw-rotate-0: 0deg; --tw-rotate: --fl-tw-rotate\(\); \}/)
  assert.match(out, /\.md\\:scale-150 \{ --fl-tw-scale-x-768px: 1\.5;/)
})

test('exclude leaves the named properties out of the list, and only those', async () => {
  const css = `.max-w-md { max-width: 28rem } .mt-6 { margin-top: 1.5rem } .p-4 { padding: 1rem } .pt-4 { padding-top: 1rem }
    @media (width >= 48rem) { .md\\:max-w-xl { max-width: 36rem } .md\\:mt-8 { margin-top: 2rem } .md\\:p-8 { padding: 2rem } .md\\:pt-8 { padding-top: 2rem } }`
  const out = flat(await appendix(css, { exclude: ['max-width', 'padding'] }))
  assert.doesNotMatch(out, /--fl-max-width|--fl-padding-0|--fl-padding-48rem/)
  assert.match(out, /--fl-margin-top-48rem: 2rem/)
  assert.match(out, /--fl-padding-top-48rem: 2rem/)
  // it applies to a custom list too
  assert.doesNotMatch(flat(await appendix(css, { properties: ['margin-top', 'max-width'], exclude: ['max-width'] })), /--fl-max-width/)
})

test('interpolates line-height ratios on a family of their own, walled off from lengths', async () => {
  const css = themed(`@layer utilities {
    .leading-6 { line-height: calc(var(--spacing) * 6) }
    @media (width >= 48rem) { .md\\:leading-none { line-height: var(--leading-none) } .md\\:leading-10 { line-height: calc(var(--spacing) * 10) } }
  }`)
  const out = flat(await appendix(css))
  assert.match(out, /\.leading-6 \{ --fl-line-height-0: calc\(var\(--spacing\) \* 6\);/)
  // each kind publishes its own token and a stop for the other family
  assert.match(out, /\.md\\:leading-10 \{ --fl-line-height-num-48rem-stop: 1; --fl-line-height-48rem: calc/)
  assert.match(out, /\.md\\:leading-none \{ --fl-line-height-48rem-stop: 1; --fl-line-height-num-48rem: var\(--leading-none\); \}/)
  assert.match(out, /\.md\\:leading-none \{ line-height: --fl-line-height-num\(\); \}/)
  assert.doesNotMatch(out, /--fl-line-height-48rem: var\(--leading-none\)/)
})

test('a fixed value at a breakpoint is a wall the band below cannot see past', async () => {
  const css = themed(`@layer utilities {
    .w-64 { width: calc(var(--spacing) * 64) }
    @media (width >= 48rem) { .md\\:w-auto { width: auto } }
    @media (width >= 64rem) { .lg\\:w-96 { width: calc(var(--spacing) * 96) } }
  }`)
  const out = flat(await appendix(css))
  // the stop is published without the breakpoint, the value re-asserted inside it
  assert.match(out, /\.md\\:w-auto \{ --fl-width-48rem-stop: 1; \} @media \(width >= 48rem\) \{ \.md\\:w-auto \{ width: auto; \}/)
  assert.match(out, /@function --fl\(--v0, --v48rem, --v64rem, --s48rem\)/)
  assert.match(out, /--hi: if\(style\(--s48rem\): var\(--lo\); style\(--v48rem\): var\(--v48rem\); style\(--v64rem\): var\(--v64rem\); else: var\(--lo\)\)/)
  assert.match(out, /--hi-w: if\(style\(--s48rem\): 48rem; style\(--v48rem\): 48rem; style\(--v64rem\): 64rem; else: 99999px\)/)
  assert.match(out, /@property --fl-width-48rem-stop \{ syntax: "\*"; inherits: false; \}/)
  assert.match(out, /--fl-width\(\) \{ result: --fl\(var\(--fl-width-0\), var\(--fl-width-48rem\), var\(--fl-width-64rem\), var\(--fl-width-48rem-stop\)\); \}/)
})

test('a property whose only responsive values are fixed is left alone', async () => {
  const css = themed(`@layer utilities { .w-64 { width: 16rem } @media (width >= 48rem) { .md\\:w-auto { width: auto } } }`)
  assert.equal(await run(css), css)
})

test('publishes a bare zero as 0px, since 0 inside calc() is a number', async () => {
  // Tailwind's optimizer emits `top: 0` for `top-0` and `margin-top: 0` for `mt-0`
  const css = `.top-0 { top: 0 } .mt-0 { margin-top: 0 } @media (width >= 48rem) { .md\\:top-4 { top: 1rem } .md\\:mt-8 { margin-top: 2rem } }`
  const out = flat(await appendix(css))
  assert.match(out, /\.top-0 \{ --fl-top-0: 0px; top: --fl-top\(\); \}/)
  assert.match(out, /\.mt-0 \{ --fl-margin-top-0: 0px;/)
})

test('keeps slash radii as written, since a top-level / is a separator, not division', async () => {
  // `rounded-[4px/8px]`; the optimizer also strips the spaces from `rounded-[4px_/_8px]`
  const css = `.rounded-sm { border-radius: 0.25rem } .rounded-\\[4px\\/8px\\] { border-radius: 4px/8px }
    @media (width >= 48rem) { .md\\:rounded-2xl { border-radius: 1rem } .md\\:rounded-\\[16px\\/32px\\] { border-radius: 16px/32px } }`
  const out = flat(await appendix(css))
  assert.match(out, /\.rounded-\\\[4px\\\/8px\\\] \{ border-radius: 4px\/8px; \}/)
  assert.match(out, /\.md\\:rounded-\\\[16px\\\/32px\\\] \{ --fl-border-radius-48rem-stop: 1; \}/)
  assert.doesNotMatch(out, /--fl-border-radius-(0|48rem): (4|16)px\//)
  // division inside calc() is still arithmetic
  assert.match(out, /\.rounded-sm \{ --fl-border-radius-0: 0\.25rem;/)
})

test('treats lengths standing in for infinity as fixed', async () => {
  // Tailwind's optimizer folds `rounded-full`'s calc(infinity * 1px) into 2147483647px
  const css = `.rounded-sm { border-radius: 0.25rem } .w-4 { width: calc(1rem / 1) }
    @media (width >= 48rem) { .md\\:rounded-full { border-radius: 2147483647px } .md\\:rounded-xl { border-radius: 0.75rem } .md\\:w-8 { width: 2rem } }`
  const out = flat(await appendix(css))
  assert.match(out, /\.md\\:rounded-full \{ --fl-border-radius-48rem-stop: 1; \}/)
  assert.match(out, /@media \(width >= 48rem\) \{ \.md\\:rounded-full \{ border-radius: 2147483647px; \}/)
  assert.doesNotMatch(out, /--fl-border-radius-48rem: 2147483647px/)
  assert.match(out, /\.w-4 \{ --fl-width-0: calc\(1rem \/ 1\);/)
})

test('makes start and end utilities fluid, and splits two-value logical shorthands', async () => {
  const css = `.ms-4 { margin-inline-start: 1rem } .start-0 { inset-inline-start: 0 } .rounded-s-sm { border-start-start-radius: 0.25rem; border-end-start-radius: 0.25rem }
    .mx-pair { margin-inline: 4px 8px }
    @media (width >= 48rem) { .md\\:ms-8 { margin-inline-start: 2rem } .md\\:start-8 { inset-inline-start: 2rem } .md\\:rounded-s-2xl { border-start-start-radius: 1rem; border-end-start-radius: 1rem } .md\\:mx-pair { margin-inline: 8px 16px } }`
  const out = flat(await appendix(css))
  for (const prop of ['margin-inline-start', 'inset-inline-start', 'border-start-start-radius', 'border-end-start-radius', 'margin-inline-end']) {
    assert.match(out, new RegExp(`@function --fl-${prop}\\(\\)`), prop)
  }
  assert.match(out, /\.start-0 \{ --fl-inset-inline-start-0: 0px;/)
  assert.match(out, /\.mx-pair \{ --fl-margin-inline-start-0: 4px; --fl-margin-inline-end-0: 8px; margin-inline-start: --fl-margin-inline-start\(\); margin-inline-end: --fl-margin-inline-end\(\); \}/)
})

test('makes space-x and space-y fluid on the children they target', async () => {
  // what Tailwind emits for space-y-4 md:space-y-8 (dev output; the optimizer only drops the spaces around >)
  const css = themed(`@layer utilities {
    :where(.space-y-4 > :not(:last-child)) { --tw-space-y-reverse: 0; margin-block-start: calc(calc(var(--spacing) * 4) * var(--tw-space-y-reverse)); margin-block-end: calc(calc(var(--spacing) * 4) * calc(1 - var(--tw-space-y-reverse))) }
    :where(.space-y-reverse > :not(:last-child)) { --tw-space-y-reverse: 1 }
    @media (min-width:48rem) { :where(.md\\:space-y-8>:not(:last-child)) { --tw-space-y-reverse: 0; margin-block-start: calc(calc(var(--spacing) * 8) * var(--tw-space-y-reverse)); margin-block-end: calc(calc(var(--spacing) * 8) * calc(1 - var(--tw-space-y-reverse))) } }
  }`)
  const out = flat(await appendix(css))
  // the reverse variable is the rule's own, so the value is known to be a length
  assert.match(out, /:where\(\.space-y-4 > :not\(:last-child\)\) \{ --fl-margin-block-start-0: calc\(calc\(var\(--spacing\) \* 4\) \* var\(--tw-space-y-reverse\)\); --fl-margin-block-end-0: /)
  assert.match(out, /:where\(\.md\\:space-y-8>:not\(:last-child\)\) \{ --fl-margin-block-start-48rem: /)
  assert.match(out, /@media \(min-width:48rem\) \{ :where\(\.md\\:space-y-8>:not\(:last-child\)\) \{ margin-block-start: --fl-margin-block-start\(\); margin-block-end: --fl-margin-block-end\(\); \}/)
  // the reverse flip itself is not a fluid property
  assert.doesNotMatch(out, /\.space-y-reverse/)
})

test('still ignores other child selectors and anything more specific', async () => {
  const css = `:where(.kids > *) { margin-top: 1rem } .a > .b { margin-top: 1rem } @media (width >= 48rem) { :where(.md\\:kids > *) { margin-top: 2rem } }`
  assert.equal(await run(css), css)
})

test('interpolates container breakpoints over the container width', async () => {
  const css = `.mt-4 { margin-top: 1rem } @container (width >= 28rem) { .\\@md\\:mt-8 { margin-top: 2rem } } @container (width >= 36rem) { .\\@xl\\:mt-16 { margin-top: 4rem } }
    @container card (width >= 28rem) { .\\@md\\/card\\:mt-3 { margin-top: 0.75rem } }`
  const out = flat(await appendix(css, { containerMinWidth: '16rem' }))
  assert.match(out, /@function --fl\(--v0, --vc28rem, --vc36rem, --cq\)/)
  // outside any container the base holds; inside one the bands run over 100cqw
  assert.match(out, /--clo: var\(--v0\); --clo-w: 16rem; --chi: var\(--clo\); --chi-w: 99999px; @container \(width >= 0px\) \{ --clo: var\(--v0\); --clo-w: 16rem; --chi: var\(--vc28rem, var\(--vc36rem, var\(--clo\)\)\);/)
  assert.match(out, /@container \(width >= 28rem\) \{ --clo: var\(--vc28rem, var\(--v0\)\);/)
  assert.match(out, /result: if\(style\(--cq\): clamp\(.*100cqw.*; style\(--vc28rem\) or style\(--vc36rem\): clamp\(.*100cqw.*; else: clamp\(.*100vw/)
  // tokens are published without the query; the property and the flag only under it
  assert.match(out, /\.\\@md\\:mt-8 \{ --fl-margin-top-c28rem: 2rem; \} @container \(width >= 28rem\) \{ \.\\@md\\:mt-8 \{ --fl-margin-top-cq: 1; margin-top: --fl-margin-top\(\); \}/)
  assert.match(out, /@property --fl-margin-top-cq \{ syntax: "\*"; inherits: false; \}/)
  // a named container is a condition on the base token, as before
  assert.match(out, /@container card \(width >= 28rem\) \{ \.\\@md\\\/card\\:mt-3 \{ --fl-margin-top-0: 0\.75rem; margin-top: --fl-margin-top\(\); \}/)
})

test('a container query mixed with a breakpoint stays a condition', async () => {
  const css = `.mt-4 { margin-top: 1rem } @container (width >= 32rem) { @media (width >= 48rem) { .\\@lg\\:md\\:mt-2 { margin-top: 0.5rem } } }`
  const out = flat(await appendix(css))
  assert.match(out, /@container \(width >= 32rem\) \{ \.\\@lg\\:md\\:mt-2 \{ --fl-margin-top-48rem: 0\.5rem; \}/)
  assert.doesNotMatch(out, /--vc/)
})

test('output without container breakpoints has no container machinery', async () => {
  const out = await appendix(`.mt-4 { margin-top: 1rem } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } }`)
  assert.doesNotMatch(out, /--cq|--clo|cqw|@container/)
  assert.match(out, /result: clamp\(min\(var\(--lo\), var\(--hi\)\)/)
})

test('points the no-op warning at the first unread declaration', async () => {
  const css = `@media (width >= 48rem) { .md\\:mt-8 > p { margin-top: 2rem } }`
  const [warning] = (await postcss([autofluid()]).process(css, { from: undefined })).warnings()
  assert.equal(warning.plugin, 'postcss-autofluid')
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

// What `@tailwindcss/postcss` 4.3.4 emits for `mt-6 md:mt-8 scoped:mt-2 md:scoped:mt-10` with
//   @custom-variant scoped { @scope (.card) { @slot; } }
// Since 4.3.4 an `@scope` variant wraps the utility; earlier releases nested
// the `@scope` inside the rule, and the optimizer emptied it.
const scopeVariant = {
  dev: `
@layer theme {
  :root, :host {
    --spacing: 0.25rem;
  }
}
@layer utilities {
  .mt-6 {
    margin-top: calc(var(--spacing) * 6);
  }
  @media (width >= 48rem) {
    .md\\:mt-8 {
      margin-top: calc(var(--spacing) * 8);
    }
  }
  @scope (.card) {
    .scoped\\:mt-2 {
      margin-top: calc(var(--spacing) * 2);
    }
  }
  @media (width >= 48rem) {
    @scope (.card) {
      .md\\:scoped\\:mt-10 {
        margin-top: calc(var(--spacing) * 10);
      }
    }
  }
}
`,
  optimized: `@layer theme{:root,:host{--spacing:.25rem}}@layer utilities{.mt-6{margin-top:calc(var(--spacing) * 6)}@media (min-width:48rem){.md\\:mt-8{margin-top:calc(var(--spacing) * 8)}}@scope(.card){.scoped\\:mt-2{margin-top:calc(var(--spacing) * 2)}}@media (min-width:48rem){@scope(.card){.md\\:scoped\\:mt-10{margin-top:calc(var(--spacing) * 10)}}}}`,
}

/** Every declaration of `prop` for a selector inside the appendix, with its at-rules below `@layer`. */
const placements = (css, selector, prop) => {
  const out = []
  postcss.parse(css.slice(css.indexOf('@supports'))).walkDecls(prop, (d) => {
    if (d.parent.selector !== selector) return
    const at = []
    for (let p = d.parent.parent; p.type !== 'root'; p = p.parent) {
      if (p.name === 'media' || p.name === 'scope') at.unshift(`@${p.name} ${p.params.replace(/^\(/, ' (').trim()}`)
    }
    out.push({ value: d.value, at })
  })
  return out
}

for (const [shape, css] of Object.entries(scopeVariant)) {
  test(`an @scope variant is mirrored as a condition around its twin (${shape} output)`, async () => {
    const out = await run(css)
    // Tailwind's own rules are untouched
    assert.ok(out.startsWith(css))
    const scope = /^@scope \(\.card\)$/

    const base = placements(out, '.scoped\\:mt-2', '--fl-margin-top-0')
    assert.equal(base.length, 1)
    assert.equal(base[0].value, 'calc(var(--spacing) * 2)')
    assert.equal(base[0].at.length, 1)
    assert.match(base[0].at[0], scope)

    // the md token keeps the scope and drops only the breakpoint
    const md = placements(out, '.md\\:scoped\\:mt-10', '--fl-margin-top-48rem')
    assert.equal(md.length, 1)
    assert.equal(md[0].value, 'calc(var(--spacing) * 10)')
    assert.equal(md[0].at.length, 1)
    assert.match(md[0].at[0], scope)

    // the property is handed over only under both the breakpoint and the scope
    const handed = placements(out, '.md\\:scoped\\:mt-10', 'margin-top')
    assert.equal(handed.length, 1)
    assert.equal(handed[0].value, '--fl-margin-top()')
    assert.equal(handed[0].at.length, 2)
    assert.match(handed[0].at[0], /^@media /)
    assert.match(handed[0].at[1], scope)
  })
}

test('by default, percentages, viewport and container units are walls, not curves', async () => {
  // stack then columns: full width below md, half from md, as in Tailwind
  const css = `@layer utilities { .w-full { width: 100% } .w-12 { width: 3rem } .mt-\\[2vw\\] { margin-top: 2vw } .mt-4 { margin-top: 1rem }
    @media (width >= 48rem) { .md\\:w-1\\/2 { width: calc(1/2 * 100%) } .md\\:w-64 { width: 16rem } .md\\:mt-\\[50cqw\\] { margin-top: 50cqw } .md\\:mt-8 { margin-top: 2rem } } }`
  const out = flat(await appendix(css))
  assert.doesNotMatch(out, /--fl-width-0: 100%|--fl-width-48rem: calc\(1\/2/)
  // a fixed value at md re-asserts itself and walls off the band below
  assert.match(out, /\.md\\:w-1\\\/2 \{ --fl-width-48rem-stop: 1; \}/)
  assert.match(out, /\.md\\:w-1\\\/2 \{ width: calc\(1\/2 \* 100%\); \}/)
  assert.match(out, /\.w-12 \{ --fl-width-0: 3rem;/)
  assert.match(out, /\.mt-\\\[2vw\\\] \{ margin-top: 2vw; \}/)
  assert.match(out, /--fl-margin-top-48rem-stop: 1/)
})

test('by default, transforms, opacity and border widths step like Tailwind', async () => {
  // an off-canvas drawer, a show-on-desktop element and a border that appears
  const css = `@layer utilities {
    .-translate-x-full { --tw-translate-x: -100%; translate: var(--tw-translate-x) var(--tw-translate-y) }
    .opacity-0 { opacity: 0% } .border-0 { border-width: 0px } .rotate-0 { rotate: 0deg }
    @media (width >= 64rem) {
      .lg\\:translate-x-0 { --tw-translate-x: 0px; translate: var(--tw-translate-x) var(--tw-translate-y) }
      .lg\\:opacity-100 { opacity: 100% } .lg\\:border { border-width: 1px } .lg\\:rotate-180 { rotate: 180deg }
    } }`
  assert.equal(await run(css), css)
  // opting in to transforms alone keeps the drawer's -100% a wall: it is a percentage
  const out = flat(await appendix(css, { include: 'transforms' }))
  assert.match(out, /\.-translate-x-full \{ --tw-translate-x: -100%; \}/)
  assert.match(out, /\.lg\\:translate-x-0 \{ --fl-tw-translate-x-64rem: 0px; \}/)
  assert.match(out, /--fl-rotate-64rem: 180deg/)
  assert.doesNotMatch(out, /--fl-opacity|--fl-border/)
  // 'all' turns every group on
  const all = flat(await appendix(css, { include: 'all' }))
  for (const name of ['--fl-tw-translate-x-0: -100%', '--fl-opacity-64rem: 1', '--fl-border-width-64rem: 1px']) assert.ok(all.includes(name), name)
})

test('names the shared functions after their signature, so stylesheets on one page do not collide', async () => {
  const build = async (css) => (await postcss([autofluid()]).process(css, { from: undefined })).css
  const names = (css) => [...css.matchAll(/@function (--[\w-]+)\(/g)].map((m) => m[1])
  const md = `@layer utilities { .mt-6 { margin-top: 1.5rem } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } } }`
  const smLg = `@layer utilities { .mt-6 { margin-top: 1.5rem } @media (width >= 40rem) { .sm\\:mt-8 { margin-top: 2rem } } @media (width >= 64rem) { .lg\\:mt-8 { margin-top: 3rem } } }`
  const a = names(await build(md))
  const b = names(await build(smLg))
  assert.match(a[0], /^--fl_[0-9a-z]{5}$/)
  assert.equal(a[1], `${a[0]}-margin-top`)
  assert.notEqual(a[0], b[0])
  assert.notEqual(a[1], b[1])
  // the same breakpoints give the same names, whatever else the file holds
  const c = names(await build(md.replace('2rem', '3rem')))
  assert.deepEqual(c, a)
  // the feature check keeps its plain name
  assert.match(await build(md), /@supports \(top: --fl\(\)\)/)
})

test('accepts the obvious forms of each option', async () => {
  const css = `@layer utilities { .mt-6 { margin-top: 1.5rem } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } } }`
  // a single layer name as a string
  assert.match(await appendix(css, { layers: 'utilities' }), /--fl-margin-top-48rem/)
  // a bare number of pixels
  assert.match(await appendix(css, { minWidth: 320 }), /else: 320px\)/)
  assert.match(await appendix(css, { minWidth: '0' }), /else: 0px\)/)
  // a single property name as a string
  assert.match(await appendix(css, { properties: 'margin-top' }), /--fl-margin-top-48rem/)
  assert.doesNotMatch(await appendix(css, { exclude: 'margin-top' }), /--fl-margin-top/)
  // postcss-load-config passes `true` or nothing for an option-less plugin
  assert.doesNotThrow(() => autofluid(true))
  assert.doesNotThrow(() => autofluid())
})

test('throws a clear error for an option it cannot use', () => {
  const throws = (opts, pattern) => assert.throws(() => autofluid(opts), (error) => {
    assert.match(error.message, /^postcss-autofluid: /)
    assert.match(error.message, pattern)
    return true
  })
  throws({ units: ['%'] }, /`units` was removed.*include: \['percentages'/)
  throws({ minwidth: '20rem' }, /unknown option `minwidth`\. Known options: prefix, minWidth/)
  throws({ minWidth: '20' }, /`minWidth` must be a length/)
  throws({ minWidth: '20vw' }, /`minWidth` must be a length/)
  throws({ containerMinWidth: -1 }, /`containerMinWidth` must be a length/)
  throws({ include: ['transform'] }, /unknown group 'transform' in `include`\. Groups: percentages, viewport-units, container-units, borders, transforms, opacity, all/)
  throws({ layers: 42 }, /`layers` must be a string or an array of strings/)
  throws({ properties: [''] }, /`properties` must be a string or an array of strings/)
  throws({ prefix: 'f l' }, /`prefix` must be letters, digits and dashes/)
  throws({ prefix: 'fl_x' }, /`prefix` must be/)
  throws('fl', /options must be an object/)
})
