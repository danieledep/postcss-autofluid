import { test } from 'node:test'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import fluidVariants from '../index.js'

// What `@tailwindcss/postcss` emits for:
//   <div class="mt-6 md:mt-8 text-base xl:text-xl hover:mt-8 md:flex dark:md:mt-4">
const fixture = `
@layer utilities {
  .mt-6 { margin-top: calc(var(--spacing) * 6); }
  .text-base {
    font-size: var(--text-base);
    line-height: var(--tw-leading, var(--text-base--line-height));
  }
  .hover\\:mt-8:hover { margin-top: calc(var(--spacing) * 8); }
  @media (width >= 48rem) {
    .md\\:mt-8 { margin-top: calc(var(--spacing) * 8); }
    .md\\:flex { display: flex; }
  }
  @media (prefers-color-scheme: dark) {
    @media (width >= 48rem) {
      .dark\\:md\\:mt-4 { margin-top: calc(var(--spacing) * 4); }
    }
  }
  @media (width >= 80rem) {
    .xl\\:text-xl {
      font-size: var(--text-xl);
      line-height: var(--tw-leading, var(--text-xl--line-height));
    }
  }
}
`

const run = async (css, opts) =>
  (await postcss([fluidVariants(opts)]).process(css, { from: undefined })).css

test('leaves the original Tailwind output untouched', async () => {
  const out = await run(fixture)
  assert.ok(out.trimStart().startsWith(fixture.trim()))
})

test('declares one interpolator with a parameter per breakpoint found', async () => {
  const out = await run(fixture)
  assert.match(out, /@function --fl\(--v0, --v48rem, --v80rem\)/)
  assert.match(out, /@media \(width >= 48rem\)/)
  assert.match(out, /@media \(width >= 80rem\)/)
  assert.match(out, /result: clamp\(min\(var\(--lo\), var\(--hi\)\)/)
})

test('walks fallbacks toward the nearest defined token', async () => {
  const out = await run(fixture)
  // top band: nothing below, everything above
  assert.match(out, /--hi: var\(--v48rem, var\(--v80rem, var\(--lo\)\)\)/)
  // top-most band: everything below, nothing above
  assert.match(out, /--lo: var\(--v80rem, var\(--v48rem, var\(--v0\)\)\)/)
  assert.match(out, /--lo-w: if\(style\(--v80rem\): 80rem; style\(--v48rem\): 48rem; else: 20rem\)/)
})

test('emits one wrapper per fluid property', async () => {
  const out = await run(fixture)
  assert.match(out, /@function --fl-margin-top\(\)/)
  assert.match(out, /@function --fl-font-size\(\)/)
  assert.match(out, /@function --fl-line-height\(\)/)
  assert.doesNotMatch(out, /@function --fl-display/)
})

test('publishes breakpoint-tagged tokens on unconditional twins', async () => {
  const out = await run(fixture)
  assert.match(out, /\.mt-6 \{\s*--fl-margin-top-0: calc\(var\(--spacing\) \* 6\);\s*margin-top: --fl-margin-top\(\)/)
  assert.match(out, /\.md\\:mt-8 \{\s*--fl-margin-top-48rem: calc\(var\(--spacing\) \* 8\);\s*margin-top: --fl-margin-top\(\)/)
  assert.match(out, /\.xl\\:text-xl \{\s*--fl-font-size-80rem: var\(--text-xl\)/)
})

test('ignores non-fluid properties and non-breakpoint variants', async () => {
  const out = await run(fixture)
  const appended = out.slice(out.indexOf('@supports'))
  assert.doesNotMatch(appended, /md\\:flex/)
  assert.doesNotMatch(appended, /hover\\:mt-8/)
  assert.doesNotMatch(appended, /dark\\:md\\:mt-4/)
})

test('is a no-op when nothing is fluidable', async () => {
  const css = `.flex { display: flex }`
  assert.equal(await run(css), css)
})

test('guards everything behind @supports inside the utilities layer', async () => {
  const out = await run(fixture)
  assert.match(out, /@layer utilities \{\s*@supports \(top: --fl\(\)\)/)
  const unlayered = await run(fixture, { layer: false })
  assert.match(unlayered, /\}\s*@supports \(top: --fl\(\)\)/)
})

test('honours prefix and minWidth options', async () => {
  const out = await run(fixture, { prefix: 'fluid', minWidth: '320px' })
  assert.match(out, /@function --fluid\(/)
  assert.match(out, /--fluid-margin-top-48rem/)
  assert.match(out, /else: 320px\)/)
})
