import { test } from 'node:test'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import autofluid from '../index.js'
import names from '../lib/names.js'
import options from '../lib/options.js'

const { SHORT, namer } = names
const { DEFAULT_PROPERTIES, GROUPS } = options

const flat = (css) => css.replace(/\s+/g, ' ').replace(/;? \}/g, '; }')
const unhash = (css) => css.replace(/--([a-z][a-z0-9-]*?)_[0-9a-z]{5}\b/g, '--$1')
const appendix = async (css, opts) => {
  const out = unhash((await postcss([autofluid({ layers: null, ...opts })]).process(css, { from: undefined })).css)
  return flat(out.slice(out.indexOf('@supports')))
}

const every = [...DEFAULT_PROPERTIES, ...Object.values(GROUPS).flatMap((group) => group.properties ?? [])]

test('every fluid property has a name of its own', () => {
  const name = namer(new Set(every))
  const seen = new Map()
  for (const prop of every) {
    const short = name(prop)
    assert.match(short, /^[a-z][a-z0-9-]*$/, prop)
    assert.ok(!seen.has(short) || seen.get(short) === prop, `${prop} and ${seen.get(short)} are both ${short}`)
    seen.set(short, prop)
  }
  // the unitless family of a property is `<name>-num`, which no property may be called
  for (const short of seen.keys()) assert.ok(!short.endsWith('-num'), short)
})

test('the table only names properties the plugin knows, and shortens each of them', () => {
  for (const [prop, short] of Object.entries(SHORT)) {
    assert.ok(every.includes(prop), `${prop} is not a default or opt-in property`)
    assert.ok(short.length < prop.replace(/^-+/, '').length, `${short} is not shorter than ${prop}`)
  }
})

test('names follow Tailwind, with CSS initials for type', () => {
  const name = namer(new Set(every))
  const expected = {
    'margin-top': 'mt', 'margin-inline': 'mx', 'margin-block-start': 'mbs', 'padding-inline-end': 'pe', padding: 'p',
    'scroll-margin-top': 'scroll-mt', 'scroll-padding-inline': 'scroll-px',
    inset: 'inset', top: 'top', 'inset-inline': 'inset-x', 'inset-block-end': 'inset-be',
    gap: 'gap', 'row-gap': 'gap-y', 'column-gap': 'gap-x',
    'font-size': 'fs', 'line-height': 'lh', 'letter-spacing': 'ls',
    width: 'w', 'min-width': 'min-w', 'max-width': 'max-w', height: 'h', 'min-height': 'min-h', 'max-height': 'max-h', 'flex-basis': 'basis',
    'border-radius': 'rounded', 'border-top-left-radius': 'rounded-tl', 'border-end-end-radius': 'rounded-ee',
    'border-width': 'border', 'border-inline-width': 'border-x', 'outline-width': 'outline', 'outline-offset': 'outline-offset',
    '--tw-translate-x': 'translate-x', '--tw-scale-y': 'scale-y', '--tw-rotate': 'tw-rotate', rotate: 'rotate', scale: 'scale', opacity: 'opacity',
  }
  for (const [prop, short] of Object.entries(expected)) assert.equal(name(prop), short, prop)
})

test('tokens, wrappers and registrations all carry the short name', async () => {
  const out = await appendix(`.mt-6 { margin-top: 1.5rem } .text-sm { font-size: 0.875rem; line-height: 1.4 } .leading-6 { line-height: 1.5rem }
    @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } .md\\:text-xl { font-size: 1.25rem; line-height: 1.6 } .md\\:leading-8 { line-height: 2rem } }`)
  assert.ok(out.includes('.mt-6 { --fl-mt-0: 1.5rem; margin-top: --fl-mt(); }'))
  // md is a wall between the two line-height families, so every wrapper has a stop to pass; only theirs is real
  assert.ok(out.includes('@function --fl-mt() { result: --fl(var(--fl-mt-0), var(--fl-mt-48rem), var(--fl-0)); }'))
  assert.ok(out.includes('@function --fl-lh() { result: --fl(var(--fl-lh-0), var(--fl-lh-48rem), var(--fl-lh-48rem-stop)); }'))
  assert.ok(out.includes('@property --fl-mt-48rem { syntax: "*"; inherits: false; }'))
  // a length and a number on one property: two families, `lh` and `lh-num`
  assert.ok(out.includes('.text-sm { --fl-fs-0: 0.875rem; --fl-lh-num-0: 1.4; font-size: --fl-fs(); line-height: --fl-lh-num(); }'))
  assert.ok(out.includes('.leading-6 { --fl-lh-0: 1.5rem; line-height: --fl-lh(); }'))
  // the property itself is never renamed
  assert.doesNotMatch(out, /--fl-(margin-top|font-size|line-height)/)
})

test('a property outside the table keeps its own name', async () => {
  const out = await appendix(
    `.indent-4 { text-indent: 1rem } .mt-6 { margin-top: 1.5rem } @media (width >= 48rem) { .md\\:indent-8 { text-indent: 2rem } .md\\:mt-8 { margin-top: 2rem } }`,
    { properties: ['text-indent', 'margin-top'] },
  )
  assert.ok(out.includes('.indent-4 { --fl-text-indent-0: 1rem; text-indent: --fl-text-indent(); }'))
  assert.ok(out.includes('.mt-6 { --fl-mt-0: 1.5rem; margin-top: --fl-mt(); }'))
})

test('a short name gives way to a property that is really called that', async () => {
  // `--w` is `w` without its dashes, which is what `width` would be called
  const name = namer(new Set(['width', '--w', 'border', 'border-width']))
  assert.deepEqual(['width', '--w', 'border', 'border-width'].map(name), ['width', 'w', 'border', 'border-width'])

  const out = await appendix(
    `.w-4 { width: 1rem } .box { --w: 1rem } @media (width >= 48rem) { .md\\:w-8 { width: 2rem } .md\\:box { --w: 3rem } }`,
    { properties: ['width', '--w'] },
  )
  assert.ok(out.includes('.w-4 { --fl-width-0: 1rem; width: --fl-width(); }'))
  assert.ok(out.includes('.box { --fl-w-0: 1rem; --w: --fl-w(); }'))
  assert.ok(out.includes('.md\\:w-8 { --fl-width-48rem: 2rem; }'))
  assert.ok(out.includes('.md\\:box { --fl-w-48rem: 3rem; }'))
})

test('a wrapper names only the tokens some rule publishes', async () => {
  // margin-top speaks at the base, md and xl; padding at the base and lg only
  const css = `.mt-6 { margin-top: 1.5rem } .p-4 { padding: 1rem } .w-full { width: 100% }
    @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } .md\\:w-auto { width: auto } }
    @media (width >= 64rem) { .lg\\:p-8 { padding: 2rem } .lg\\:w-96 { width: 24rem } }
    @media (width >= 80rem) { .xl\\:mt-12 { margin-top: 3rem } }`
  const out = await appendix(css)
  assert.match(out, /@function --fl\(--v0, --v48rem, --v64rem, --v80rem, --s48rem\)/)
  assert.ok(out.includes('@function --fl-mt() { result: --fl(var(--fl-mt-0), var(--fl-mt-48rem), var(--fl-0), var(--fl-mt-80rem), var(--fl-0)); }'))
  assert.ok(out.includes('@function --fl-p() { result: --fl(var(--fl-p-0), var(--fl-0), var(--fl-p-64rem), var(--fl-0), var(--fl-0)); }'))
  // width has no base token (100% is fixed), a stop at md and a value at lg
  assert.ok(out.includes('@function --fl-w() { result: --fl(var(--fl-0), var(--fl-0), var(--fl-w-64rem), var(--fl-0), var(--fl-w-48rem-stop)); }'))

  // every token a wrapper does name is registered and set by some rule; the stand-in is neither
  const named = new Set([...out.matchAll(/var\((--fl-[\w-]+)\)/g)].map((m) => m[1]))
  named.delete('--fl-0')
  const registered = new Set([...out.matchAll(/@property (--fl-[\w-]+)/g)].map((m) => m[1]))
  assert.deepEqual([...named].sort(), [...registered].sort())
  for (const token of named) assert.ok(out.includes(`${token}: `), token)
  assert.doesNotMatch(out, /--fl-0\s*[:{]/)
})

test('the stand-in for an unpublished token follows the prefix, and the container flag is trimmed too', async () => {
  const css = `.mt-6 { margin-top: 1.5rem } .p-4 { padding: 1rem }
    @media (width >= 48rem) { .md\\:mt-8 { margin-top: 2rem } }
    @container (width >= 28rem) { .\\@md\\:p-8 { padding: 2rem } }`
  const out = await appendix(css, { prefix: 'fluid' })
  assert.ok(out.includes('@function --fluid-mt() { result: --fluid(var(--fluid-mt-0), var(--fluid-mt-48rem), var(--fluid-0), var(--fluid-0)); }'))
  assert.ok(out.includes('@function --fluid-p() { result: --fluid(var(--fluid-p-0), var(--fluid-0), var(--fluid-p-c28rem), var(--fluid-p-cq)); }'))
})
