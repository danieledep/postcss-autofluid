import { test } from 'node:test'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import fluidVariants from '../index.js'

// What `@tailwindcss/postcss` emits for:
//   <div class="mt-6 md:mt-8 text-base xl:text-xl 2xl:mt-11 hover:mt-8 md:flex
//               md:mt-auto mt-6! max-md:mt-2 @md:mt-8 dark:mt-10 dark:md:mt-4">
const fixture = `
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
  assert.match(out, /@function --fl\(--v0, --v48rem, --v80rem, --v96rem\)/)
  assert.match(out, /@media \(width >= 48rem\)/)
  assert.match(out, /@media \(width >= 96rem\)/)
  assert.match(out, /result: clamp\(min\(var\(--lo\), var\(--hi\)\)/)
})

test('walks fallbacks toward the nearest defined token', async () => {
  const out = await appendix(fixture)
  // first band: nothing below, everything above
  assert.match(out, /--hi: var\(--v48rem, var\(--v80rem, var\(--v96rem, var\(--lo\)\)\)\)/)
  // last band: everything below, nothing above
  assert.match(out, /--lo: var\(--v96rem, var\(--v80rem, var\(--v48rem, var\(--v0\)\)\)\)/)
  assert.match(out, /--lo-w: if\(style\(--v96rem\): 96rem; style\(--v80rem\): 80rem; style\(--v48rem\): 48rem; else: 20rem\)/)
})

test('emits one wrapper per fluid property', async () => {
  const out = await appendix(fixture)
  assert.match(out, /@function --fl-margin-top\(\)/)
  assert.match(out, /@function --fl-font-size\(\)/)
  assert.match(out, /@function --fl-line-height\(\)/)
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
  assert.match(out, /@media \(width >= 80rem\) \{ \.xl\\:text-xl \{ font-size: --fl-font-size\(\); line-height: --fl-line-height\(\); \}/)
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
  assert.match(
    await equivalent(`@layer utilities { .mt-6 { margin-top: 1.5rem } } @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } }`),
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
