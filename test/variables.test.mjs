/**
 * Root variables redefined per breakpoint, and the utilities that read them:
 *
 *   :root { --h1: 64px; @variant md { --h1: 96px } }
 *   @utility h1 { font-size: var(--h1) }
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import autofluid from '../index.js'

const unhash = (css) => css.replace(/--([a-z][a-z0-9-]*?)_[0-9a-z]{5}\b/g, '--$1')

/** A node on one line, in one formatting whatever the input's was. */
const tidy = (node) => {
  const clean = node.clone()
  clean.cleanRaws()
  clean.walk?.((child) => child.cleanRaws())
  return clean.toString().replace(/\s+/g, ' ').replace(/;? \}/g, '; }').replace(/;$/, '')
}

/** The appendix. Fragments without layers read every rule, as Tailwind 3 output does. */
const appendix = async (css, opts) => {
  const options = { ...(/@layer\b/.test(css) ? {} : { layers: null }), ...opts }
  const out = unhash((await postcss([autofluid(options)]).process(css, { from: undefined })).css)
  return tidy(postcss.parse(out.slice(out.indexOf('@supports'))))
}

/** Every rule the appendix has for a selector, so an assertion reads as the rules it expects. */
const rule = (out, selector) => {
  const found = []
  postcss.parse(out).walkRules((node) => { if (node.selector === selector) found.push(tidy(node)) })
  return found
}

// What Tailwind emits for the tokens above: the base in its own theme rule,
// each `@variant` as a media query around `:root`.
const theme = `
@layer theme {
  :root, :host { --h1: 64px; --xs: 12px; --pad: 48px; --cols: 4; --input: var(--xs); --none: 0; }
  @media (width >= 48rem) { :root { --h1: 96px; --xs: 16px; --pad: 72px; --cols: 8; } }
  @media (width >= 64rem) { :root { --h1: 140px; --pad: 96px; --cols: 12; } }
}`
const utilities = (css) => `${theme}\n@layer utilities { ${css} }`

test('a utility that reads a responsive root variable gets a token for each of its breakpoints', async () => {
  const out = await appendix(utilities(`.h1 { font-size: var(--h1) }`))
  assert.deepEqual(rule(out, '.h1'), [
    '.h1 { --fl-font-size-0: var(--fl--h1-0); --fl-font-size-48rem: var(--fl--h1-48rem); --fl-font-size-64rem: var(--fl--h1-64rem); font-size: --fl-font-size(); }',
  ])
  // the variable's breakpoints are the interpolator's, though no utility has a variant
  assert.match(out, /@function --fl\(--v0, --v48rem, --v64rem\)/)
  for (const key of ['0', '48rem', '64rem']) assert.match(out, new RegExp(`@property --fl-font-size-${key} \\{ syntax: "\\*"; inherits: false; \\}`))
  // the copies are plain inherited variables: nothing registers them
  assert.doesNotMatch(out, /@property --fl--/)
})

test('each value of the variable is copied without its breakpoint, where it is declared', async () => {
  const out = await appendix(utilities(`.h1 { font-size: var(--h1) }`))
  // The base holds until something above says otherwise, so it clears the
  // copies above; `:host` has no other declaration and stays 64px throughout.
  // The two breakpoint rules now share a selector and nothing else, so they merge.
  assert.match(out, /@layer theme \{ :root, :host \{ --fl--h1-0: 64px; --fl--h1-48rem: initial; --fl--h1-64rem: initial; \} :root \{ --fl--h1-48rem: 96px; --fl--h1-64rem: 140px; \}; \}/)
  // only variables a token reads are copied
  assert.doesNotMatch(out, /--fl--(xs|pad|cols|input|none)/)
})

test('leaves the original stylesheet untouched, variables included', async () => {
  const css = utilities(`.h1 { font-size: var(--h1) }`)
  const out = (await postcss([autofluid()]).process(css, { from: undefined })).css
  assert.ok(out.startsWith(css))
})

test('reads the breakpoint nested inside the root rule too, with the same result', async () => {
  const flat = `:root { --h1: 64px } @media (width >= 48rem) { :root { --h1: 96px } } .h1 { font-size: var(--h1) }`
  const nested = `:root { --h1: 64px; @media (width >= 48rem) { --h1: 96px } } .h1 { font-size: var(--h1) }`
  const out = await appendix(flat)
  assert.equal(await appendix(nested), out)
  assert.deepEqual(rule(out, ':root'), [':root { --fl--h1-0: 64px; --fl--h1-48rem: 96px; }'])
  // Tailwind 3 and the optimizer write the query as min-width
  assert.equal(await appendix(flat.replace('(width >= 48rem)', '(min-width:48rem)')), out)
})

test('only fluid properties follow: anything else that reads the variable steps as before', async () => {
  const out = await appendix(utilities(`
    .h1 { font-size: var(--h1) }
    .grid-cols-\\(--cols\\) { grid-template-columns: var(--cols) }
    .translate-x-\\(--xs\\) { --tw-translate-x: var(--xs); translate: var(--tw-translate-x) var(--tw-translate-y) }
    .w-\\[calc\\(100\\%-var\\(--xs\\)\\)\\] { width: calc(100% - var(--xs)) }
  `))
  assert.doesNotMatch(out, /grid-cols|translate|--fl--(xs|cols)/)
  // a percentage is not opted in, so the width is kept as written, live variable and all
  assert.doesNotMatch(out, /\.w-/)
  // opted in, the translate variable is a fluid property like any other
  const all = await appendix(utilities(`.translate-x-\\(--xs\\) { --tw-translate-x: var(--xs); translate: var(--tw-translate-x) var(--tw-translate-y) }`), { include: 'transforms' })
  assert.deepEqual(rule(all, '.translate-x-\\(--xs\\)'), [
    '.translate-x-\\(--xs\\) { --fl-tw-translate-x-0: var(--fl--xs-0); --fl-tw-translate-x-48rem: var(--fl--xs-48rem); --tw-translate-x: --fl-tw-translate-x(); }',
  ])
})

test('a root variable that reads a responsive one is responsive too', async () => {
  const out = await appendix(utilities(`.px-\\(--input\\) { padding-inline: var(--input) }`))
  assert.deepEqual(rule(out, '.px-\\(--input\\)'), [
    '.px-\\(--input\\) { --fl-padding-inline-0: var(--fl--input-0); --fl-padding-inline-48rem: var(--fl--input-48rem); padding-inline: --fl-padding-inline(); }',
  ])
  // the alias is copied reading the copies of what it reads, which are copied in turn
  assert.deepEqual(rule(out, ':root, :host'), [
    ':root, :host { --fl--xs-0: 12px; --fl--xs-48rem: initial; --fl--input-0: var(--fl--xs-0); --fl--input-48rem: var(--fl--xs-48rem); }',
  ])
  assert.deepEqual(rule(out, ':root'), [':root { --fl--xs-48rem: 16px; }'])
})

test('follows aliases of aliases, and stops at a loop', async () => {
  const out = await appendix(`:root { --a: 1px; --b: calc(var(--a) * 2); --c: var(--b); --x: var(--y); --y: var(--x) }
    @media (width >= 48rem) { :root { --a: 2px } }
    .p { padding: var(--c) } .m { margin: var(--x) }`)
  assert.deepEqual(rule(out, ':root'), [
    ':root { --fl--a-0: 1px; --fl--b-0: calc(var(--fl--a-0) * 2); --fl--b-48rem: calc(var(--fl--a-48rem) * 2); --fl--c-0: var(--fl--b-0); --fl--c-48rem: var(--fl--b-48rem); --fl--a-48rem: 2px; }',
  ])
  assert.doesNotMatch(out, /--fl--[xy]|\.m \{/)
})

test('arithmetic and fallbacks keep their shape around the copy', async () => {
  const out = await appendix(utilities(`
    .-mt-xs { margin-top: calc(var(--xs) * -1) }
    .mt-fallback { margin-top: var(--unset, var(--xs)) }
    .px-xs { padding-inline: var(--xs) var(--pad) }
  `))
  assert.deepEqual(rule(out, '.-mt-xs'), [
    '.-mt-xs { --fl-margin-top-0: calc(var(--fl--xs-0) * -1); --fl-margin-top-48rem: calc(var(--fl--xs-48rem) * -1); margin-top: --fl-margin-top(); }',
  ])
  assert.deepEqual(rule(out, '.mt-fallback'), [
    '.mt-fallback { --fl-margin-top-0: var(--unset, var(--fl--xs-0)); --fl-margin-top-48rem: var(--unset, var(--fl--xs-48rem)); margin-top: --fl-margin-top(); }',
  ])
  // a shorthand list is split first, so each side follows its own variable
  assert.deepEqual(rule(out, '.px-xs'), [
    '.px-xs { --fl-padding-inline-start-0: var(--fl--xs-0); --fl-padding-inline-start-48rem: var(--fl--xs-48rem); --fl-padding-inline-end-0: var(--fl--pad-0); --fl-padding-inline-end-48rem: var(--fl--pad-48rem); --fl-padding-inline-end-64rem: var(--fl--pad-64rem); padding-inline-start: --fl-padding-inline-start(); padding-inline-end: --fl-padding-inline-end(); }',
  ])
})

test('a value between two of the variable\'s breakpoints, or reading several variables, falls back through the copies below', async () => {
  const out = await appendix(utilities(`
    .p-0 { padding: 0 }
    .mt-sum { margin-top: calc(var(--xs) + var(--pad)) }
    @media (width >= 40rem) { .sm\\:p-xs { padding: var(--xs) } }
    @media (width >= 64rem) { .lg\\:p-xs { padding: var(--xs) } }
  `))
  // `--xs` says nothing at 40rem or 64rem: there the token is whatever it last was
  assert.deepEqual(rule(out, '.sm\\:p-xs'), ['.sm\\:p-xs { --fl-padding-40rem: var(--fl--xs-0); --fl-padding-48rem: var(--fl--xs-48rem); }', '.sm\\:p-xs { padding: --fl-padding(); }'])
  assert.deepEqual(rule(out, '.lg\\:p-xs'), ['.lg\\:p-xs { --fl-padding-64rem: var(--fl--xs-48rem, var(--fl--xs-0)); }', '.lg\\:p-xs { padding: --fl-padding(); }'])
  // two variables: each falls back on its own, so the sum stands wherever either is cleared
  assert.deepEqual(rule(out, '.mt-sum'), [
    '.mt-sum { --fl-margin-top-0: calc(var(--fl--xs-0) + var(--fl--pad-0)); ' +
      '--fl-margin-top-48rem: calc(var(--fl--xs-48rem, var(--fl--xs-0)) + var(--fl--pad-48rem, var(--fl--pad-0))); ' +
      '--fl-margin-top-64rem: calc(var(--fl--xs-48rem, var(--fl--xs-0)) + var(--fl--pad-64rem, var(--fl--pad-48rem, var(--fl--pad-0)))); margin-top: --fl-margin-top(); }',
  ])
})

test('a variable set again elsewhere is copied there, so the override holds at every breakpoint', async () => {
  const out = await appendix(`${theme}
    @layer components {
      .section { --xs: 5px; color: red }
      .compact { --xs: 4px } @media (width >= 80rem) { .compact { --xs: 6px } }
      .card { .dark & { --xs: 1px } }
      @media (prefers-color-scheme: dark) { .section { --xs: 7px !important } }
      @keyframes grow { from { --xs: 0px } to { --xs: 9px } }
    }
    @layer utilities { .p-xs { padding: var(--xs) } .\\[--xs\\:2px\\] { --xs: 2px } }`)
  // the same layer, the same selector, and nothing at the breakpoints above
  assert.match(out, /@layer components \{ \.section \{ --fl--xs-0: 5px; --fl--xs-48rem: initial; --fl--xs-80rem: initial; \}/)
  // a breakpoint only an override uses is one of the variable's, and the root says nothing there
  assert.deepEqual(rule(out, '.compact'), ['.compact { --fl--xs-0: 4px; --fl--xs-48rem: initial; --fl--xs-80rem: 6px; }'])
  assert.deepEqual(rule(out, ':root'), [':root { --fl--xs-48rem: 16px; --fl--xs-80rem: initial; }'])
  assert.match(rule(out, '.p-xs')[0], /--fl-padding-80rem: var\(--fl--xs-80rem\);/)
  // nesting, conditions and !important are kept as they are
  assert.match(out, /\.card \{ \.dark & \{ --fl--xs-0: 1px; --fl--xs-48rem: initial; --fl--xs-80rem: initial; \}; \}/)
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{ \.section \{ --fl--xs-0: 7px !important; --fl--xs-48rem: initial !important; --fl--xs-80rem: initial !important; \}; \}/)
  assert.match(out, /@layer utilities \{ \.\\\[--xs\\:2px\\\] \{ --fl--xs-0: 2px; --fl--xs-48rem: initial; --fl--xs-80rem: initial; \}; \}/)
  // a copy inside @keyframes would redefine the animation
  assert.doesNotMatch(out, /@keyframes/)
})

test('a variable the root never changes is not responsive, wherever else it is set', async () => {
  // Tailwind's own variables live on utilities and change under variants all the time
  const tailwind = `
    @layer theme { :root, :host { --spacing: 0.25rem; --text-sm--line-height: calc(1.25 / 0.875); --gap: 8px; } }
    @layer utilities {
      .leading-6 { --tw-leading: calc(var(--spacing) * 6); line-height: calc(var(--spacing) * 6) }
      .text-sm { line-height: var(--tw-leading, var(--text-sm--line-height)) }
      .gap-\\(--gap\\) { gap: var(--gap) }
      .card { --gap: 12px }
      @media (width >= 48rem) { .md\\:leading-none { --tw-leading: 1; line-height: 1 } .md\\:gap-4 { gap: calc(var(--spacing) * 4) } .md\\:card { --gap: 16px } }
    }`
  const out = await appendix(tailwind)
  assert.doesNotMatch(out, /--fl--/)
  assert.deepEqual(rule(out, '.text-sm'), ['.text-sm { --fl-line-height-num-0: var(--tw-leading, var(--text-sm--line-height)); line-height: --fl-line-height-num(); }'])
  assert.deepEqual(rule(out, '.gap-\\(--gap\\)'), ['.gap-\\(--gap\\) { --fl-gap-0: var(--gap); gap: --fl-gap(); }'])
  // nor one the root only sets under a breakpoint: there is no base to start from
  assert.doesNotMatch(await appendix(`@media (width >= 48rem) { :root { --late: 8px } .md\\:mt-4 { margin-top: 1rem } } .mt-\\(--late\\) { margin-top: var(--late) }`), /--fl--/)
})

test('a variable that is a length at one breakpoint and something else at another steps as before', async () => {
  const out = await appendix(`:root { --switch: 16px; --lh: 1.5; --xs: 12px }
    @media (width >= 48rem) { :root { --switch: auto; --lh: 24px; --xs: 16px } }
    .mt-switch { margin-top: var(--switch) } .leading-lh { line-height: var(--lh) } .p-xs { padding: var(--xs) }`)
  assert.doesNotMatch(out, /--fl--(switch|lh)|\.mt-switch|\.leading-lh/)
  assert.match(out, /--fl--xs-48rem: 16px/)
})

test('numbers, ratios and angles follow their variable like lengths do', async () => {
  const out = await appendix(`:root { --lh: 1.2; --o: 20%; --r: 0; }
    @media (width >= 48rem) { :root { --lh: 1.5; --o: 1; --r: 90deg; } }
    .leading-lh { line-height: var(--lh) } .opacity-o { opacity: var(--o) } .rotate-r { rotate: var(--r) }`, { include: 'all' })
  assert.deepEqual(rule(out, '.leading-lh'), ['.leading-lh { --fl-line-height-num-0: var(--fl--lh-0); --fl-line-height-num-48rem: var(--fl--lh-48rem); line-height: --fl-line-height-num(); }'])
  // a ratio is published as the number it stands for, so it is read at build time
  assert.deepEqual(rule(out, '.opacity-o'), ['.opacity-o { --fl-opacity-0: 0.2; --fl-opacity-48rem: 1; opacity: --fl-opacity(); }'])
  // a bare zero is no angle inside calc()
  assert.deepEqual(rule(out, '.rotate-r'), ['.rotate-r { --fl-rotate-0: 0deg; --fl-rotate-48rem: var(--fl--r-48rem); rotate: --fl-rotate(); }'])
})

test('a variable that reaches zero at a breakpoint is published as 0px there', async () => {
  const out = await appendix(`:root { --z: 16px } @media (width >= 48rem) { :root { --z: 0 } } .p-z { padding: var(--z) }`)
  assert.deepEqual(rule(out, '.p-z'), ['.p-z { --fl-padding-0: var(--fl--z-0); --fl-padding-48rem: 0px; padding: --fl-padding(); }'])
})

test('a zero behind a variable is published as 0px when the variable is zero everywhere', async () => {
  const css = (extra) => `:root { --none: 0; --xs: 12px } ${extra} .p-none { padding: var(--none) } @media (width >= 48rem) { .md\\:p-xs { padding: var(--xs) } }`
  // `calc(0 + (12px - 0) * …)` is invalid: inside calc() a bare 0 is a number
  assert.deepEqual(rule(await appendix(css('')), '.p-none'), ['.p-none { --fl-padding-0: 0px; padding: --fl-padding(); }'])
  // set again somewhere, it may be a length there, and stays live
  assert.deepEqual(rule(await appendix(css('.has-header { --none: 64px }')), '.p-none'), ['.p-none { --fl-padding-0: var(--none); padding: --fl-padding(); }'])
})

test('container variants keep the live variable: a container says nothing about the viewport', async () => {
  const out = await appendix(utilities(`.p-0 { padding: 0 } @container (width >= 28rem) { .\\@md\\:p-xs { padding: var(--xs) } }`))
  assert.match(out, /\.\\@md\\:p-xs \{ --fl-padding-c28rem: var\(--xs\); \}/)
  assert.doesNotMatch(out, /--fl--/)
})

test('a variant under a condition publishes its tokens under that condition', async () => {
  const out = await appendix(utilities(`@media (prefers-color-scheme: dark) { .dark\\:p-xs { padding: var(--xs) } }`))
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{ \.dark\\:p-xs \{ --fl-padding-0: var\(--fl--xs-0\); --fl-padding-48rem: var\(--fl--xs-48rem\); padding: --fl-padding\(\); \}; \}/)
})

test('a later rule clears the tokens an earlier one published ahead of itself', async () => {
  const out = await appendix(utilities(`
    .mt-pad { margin-top: var(--pad) }
    .mt-4 { margin-top: 1rem }
    .mt-auto { margin-top: auto }
    .p-xs { padding: var(--xs) }
    @media (width >= 40rem) { .sm\\:mt-0 { margin-top: 0 } }
    @media (width >= 48rem) { .md\\:mt-0 { margin-top: 0 } }
    @media (width >= 64rem) { .lg\\:mt-0 { margin-top: 0 } }
    @container (width >= 28rem) { .\\@md\\:mt-0 { margin-top: 0 } }
  `))
  // `mt-pad sm:mt-0` is 0 from sm up in Tailwind: the variable's md and lg values must not come back
  assert.deepEqual(rule(out, '.sm\\:mt-0')[0], '.sm\\:mt-0 { --fl-margin-top-40rem: 0px; --fl-margin-top-48rem: initial; --fl-margin-top-64rem: initial; }')
  // at md it sets that token itself and clears the one above; at lg there is nothing above
  assert.deepEqual(rule(out, '.md\\:mt-0')[0], '.md\\:mt-0 { --fl-margin-top-48rem: 0px; --fl-margin-top-64rem: initial; }')
  assert.ok(rule(out, '.lg\\:mt-0').includes('.lg\\:mt-0 { --fl-margin-top-64rem: 0px; }'))
  // a base utility sorted after it wins the property at every width, so it clears them all
  assert.deepEqual(rule(out, '.mt-4'), ['.mt-4 { --fl-margin-top-0: 1rem; --fl-margin-top-48rem: initial; --fl-margin-top-64rem: initial; margin-top: --fl-margin-top(); }'])
  // a keyword takes the property itself, and a container token is on another axis
  assert.deepEqual(rule(out, '.mt-auto'), ['.mt-auto { margin-top: auto; }'])
  assert.ok(rule(out, '.\\@md\\:mt-0').every((r) => !r.includes('initial')))
  // another property's tokens are not this rule's to clear
  assert.deepEqual(rule(out, '.p-xs'), ['.p-xs { --fl-padding-0: var(--fl--xs-0); --fl-padding-48rem: var(--fl--xs-48rem); padding: --fl-padding(); }'])
})

test('breakpoints written in another unit are still told apart, and cleared by their width', async () => {
  const out = await appendix(`:root { --u: 10px } @media (min-width: 768px) { :root { --u: 30px } }
    .mt-u { margin-top: var(--u) } @media (width >= 48rem) { .md\\:mt-2 { margin-top: 0.5rem } }`)
  assert.deepEqual(rule(out, '.md\\:mt-2')[0], '.md\\:mt-2 { --fl-margin-top-48rem: 0.5rem; --fl-margin-top-768px: initial; }')
})

test('every copy points at the declaration it copies', async () => {
  const css = utilities(`.h1 { font-size: var(--h1) }`)
  const root = postcss.parse(css, { from: '/app.css' })
  await postcss([autofluid()]).process(root, { from: '/app.css' })
  const missing = []
  root.walk((node) => { if (!node.source?.input.file) missing.push(node.type + ' ' + (node.selector || node.prop || node.params)) })
  assert.deepEqual(missing, [])
  let copy
  root.last.walkDecls('--fl--h1-64rem', (node) => { copy = node })
  assert.equal(copy.value, '140px')
  assert.equal(copy.source.start.line, css.split('\n').findIndex((line) => line.includes('--h1: 140px')) + 1)
})

test('a longhand that shares a side with a fluid shorthand is re-asserted, so the shorthand\'s twin does not override it', async () => {
  const out = await appendix(`
    .p-4 { padding: 1rem } .px-2 { padding-inline: 0.5rem } .pt-2 { padding-top: 0.5rem } .ps-2 { padding-inline-start: 0.5rem }
    .mt-2 { margin-top: 0.5rem } .gap-x-2 { column-gap: 0.5rem } .rounded-t-none { border-top-left-radius: 0; border-top-right-radius: 0 }
    @media (prefers-color-scheme: dark) { .dark\\:pt-4 { padding-top: 1rem } }
    @media (width >= 48rem) { .md\\:p-8 { padding: 2rem } .md\\:gap-8 { gap: 2rem } .md\\:rounded-xl { border-radius: 0.75rem } .md\\:pb-4 { padding-bottom: 1rem } }`)
  // Tailwind sorts these after `p-4`, and the twin of `p-4` comes after all of Tailwind
  assert.deepEqual(rule(out, '.px-2'), ['.px-2 { padding-inline: 0.5rem; }'])
  assert.deepEqual(rule(out, '.pt-2'), ['.pt-2 { padding-top: 0.5rem; }'])
  assert.deepEqual(rule(out, '.ps-2'), ['.ps-2 { padding-inline-start: 0.5rem; }'])
  assert.deepEqual(rule(out, '.gap-x-2'), ['.gap-x-2 { column-gap: 0.5rem; }'])
  assert.deepEqual(rule(out, '.rounded-t-none'), ['.rounded-t-none { border-top-left-radius: 0; border-top-right-radius: 0; }'])
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{ \.dark\\:pt-4 \{ padding-top: 1rem; \}; \}/)
  // another family is nobody's business
  assert.deepEqual(rule(out, '.mt-2'), [])
})
