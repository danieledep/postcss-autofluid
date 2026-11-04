/**
 * End-to-end check in a real browser: Tailwind → plugin → Chromium, asserting
 * computed styles at several viewport widths against plain Tailwind.
 *
 * Needs `playwright` (with Chromium 139+) and `@tailwindcss/postcss`, neither
 * of which is a dependency of this package. The test skips itself when they
 * are not installed:
 *
 *   npm i -D playwright @tailwindcss/postcss tailwindcss && npx playwright install chromium
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import fluidVariants from '../index.js'

const optional = async (name) => import(name).catch(() => null)
const playwright = await optional('playwright')
const tailwind = await optional('@tailwindcss/postcss')

// CHROMIUM_PATH points at any Chromium 139+ binary when Playwright's own
// download is unavailable (sandboxed CI, offline mirrors).
const launch = () =>
  playwright.chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
  )

const classes = [
  'mt-6 md:mt-8', 'md:mt-8', 'md:px-12 p-4', 'mt-6 md:mt-auto', 'mt-6 max-md:mt-2 md:mt-8',
  'mt-6 dark:mt-10', 'mt-6 xl:mt-10 2xl:mt-11', 'mt-6 md:max-lg:mt-8', 'mt-4', 'text-base xl:text-xl',
  'w-64 md:w-full lg:w-96', 'w-full md:w-64 lg:w-96', 'mt-6 md:mt-auto lg:mt-12', 'leading-6 md:leading-none',
  'relative absolute top-0 left-0 md:top-4 mt-0',
  'h1 md:h0', 'h1 md:h2', 'h1 md:h3',
  'rounded-sm md:rounded-2xl', 'rounded-[4px/8px] md:rounded-[16px/32px]', 'rounded-[4px_/_8px]', 'rounded-sm md:rounded-full',
  'ms-4 md:ms-8', 'text-4xl md:text-6xl', 'leading-6 text-sm md:text-xl', 'space-y-4 md:space-y-8',
  '@container', 'mt-4 @md:mt-8', 'mt-4 md:mt-8 @md:mt-12',
]

// Custom utilities with variants of their own: `md:h0` nests md inside md.
const utilities = `
  @utility h0 { font-size: 64px; line-height: 72px; @variant md { font-size: 88px; line-height: 96px; } }
  @utility h1 { font-size: 48px; line-height: 56px; @variant md { font-size: 64px; line-height: 72px; } }
  @utility h2 { font-size: 40px; @variant lg { font-size: 56px; } }
  @utility h3 { font-size: 30px; @variant max-lg { font-size: 20px; } }
`

const html = `
  <div id="a" class="mt-6 md:mt-8"></div>
  <div id="b" class="md:mt-8"><p id="child" class="mt-4"></p></div>
  <div id="c" class="p-4 md:px-12"></div>
  <div id="d" class="mt-6 md:mt-auto"></div>
  <div id="e" class="mt-6 max-md:mt-2 md:mt-8"></div>
  <div id="f" class="mt-6 dark:mt-10"></div>
  <div id="g" class="mt-6 xl:mt-10 2xl:mt-11"></div>
  <div id="h" class="mt-6 md:max-lg:mt-8"></div>
  <div id="i" class="text-base xl:text-xl"><p id="child2" class="mt-4"></p></div>
  <div style="width: 1000px">
    <div id="w1" class="w-64 md:w-full lg:w-96"></div>
    <div id="w2" class="w-full md:w-64 lg:w-96"></div>
  </div>
  <div id="m1" class="mt-6 md:mt-auto lg:mt-12"></div>
  <p id="l1" class="leading-6 md:leading-none"></p>
  <div class="relative" style="padding: 40px"><span id="z1" class="absolute top-0 left-0"></span></div>
  <div id="z2" class="mt-0"></div>
  <p id="n0" class="h1 md:h0"></p>
  <p id="n0l" class="h1 md:h0"></p>
  <p id="n2" class="h1 md:h2"></p>
  <p id="n3" class="h1 md:h3"></p>
  <div id="r1" class="rounded-sm md:rounded-2xl"></div>
  <div id="r2" class="rounded-[4px/8px] md:rounded-[16px/32px]"></div>
  <div id="r3" class="rounded-[4px_/_8px]"></div>
  <div id="r4" class="rounded-sm md:rounded-full"></div>
  <div id="s1" class="ms-4 md:ms-8"></div>
  <p id="lh" class="text-4xl md:text-6xl">x</p>
  <p id="lh2" class="leading-6 text-sm md:text-xl">x</p>
  <div class="space-y-4 md:space-y-8"><p id="sp">a</p><p id="spl">b</p></div>
  <div class="@container" style="width: 50%">
    <div id="cq1" class="mt-4 @md:mt-8"></div>
    <div id="cq2" class="mt-4 md:mt-8 @md:mt-12"></div>
  </div>
  <div id="cq3" class="mt-4 @md:mt-8"></div>
`

const PROP = { c: 'paddingLeft', i: 'fontSize', w1: 'width', w2: 'width', l1: 'lineHeight', z1: 'top', n0: 'fontSize', n0l: 'lineHeight', n2: 'fontSize', n3: 'fontSize', r1: 'borderTopLeftRadius', r2: 'borderTopLeftRadius', r3: 'borderTopLeftRadius', r4: 'borderTopLeftRadius', s1: 'marginLeft', lh: 'lineHeight', lh2: 'lineHeight', sp: 'marginBottom', spl: 'marginBottom' }

const read = (PROP) =>
  Object.fromEntries(
    [...document.querySelectorAll('[id]')].map((el) => {
      const cs = getComputedStyle(el)
      return [el.id, cs[PROP[el.id] ?? 'marginTop']]
    }),
  )

for (const optimize of [false, true]) test(`computed styles match Tailwind at breakpoints and interpolate between them (${optimize ? 'optimized' : 'dev'} output)`, { skip: !(playwright && tailwind) && 'playwright or @tailwindcss/postcss not installed' }, async () => {
  const source = `@import "tailwindcss"; @source inline("${classes.join(' ')}"); ${utilities}`
  // Production builds run Tailwind's optimizer, which rewrites values (calc(var(--spacing) * 0) → 0).
  const plain = (await postcss([tailwind.default({ optimize })]).process(source, { from: 'app.css' })).css
  const fluid = (await postcss([fluidVariants()]).process(plain, { from: undefined })).css

  const browser = await launch()
  try {
    const page = await browser.newPage({ colorScheme: 'dark' })
    const at = async (width, css) => {
      await page.setViewportSize({ width, height: 400 })
      await page.setContent(`<!doctype html><style>${css}</style>${html}`)
      return page.evaluate(read, PROP)
    }

    assert.ok(await page.evaluate(() => CSS.supports('top: --fl()')), 'Chromium must support @function')

    // At the ends of the range every element equals plain Tailwind; at md, the
    // elements whose tokens sit on md do (the others are mid-interpolation).
    for (const width of [320, 1536]) {
      assert.deepEqual(await at(width, fluid), await at(width, plain), `at ${width}px`)
    }
    const md = ['a', 'b', 'child', 'c', 'd', 'e', 'h', 'w1', 'm1', 'l1', 'n0', 'n0l', 'n3', 'r1', 'r2', 'r3', 'r4', 's1', 'lh', 'lh2', 'sp', 'spl', 'cq3']
    const pick = (all) => Object.fromEntries(md.map((id) => [id, all[id]]))
    assert.deepEqual(pick(await at(768, fluid)), pick(await at(768, plain)), 'at 768px')

    // Between breakpoints it interpolates: 24px at 320px → 32px at 768px.
    const mid = await at(544, fluid)
    assert.equal(mid.a, '28px')
    assert.equal(mid.e, '20px') // max-md:mt-2 is the base token below md: 8px → 32px
    assert.equal(mid.f, '40px') // dark: base is a single token, so it stays put
    assert.equal(mid.child, '16px') // tokens do not inherit

    // A non-length at a breakpoint is a wall: below it nothing bends towards
    // the breakpoint above, and percentages and ratios never interpolate.
    for (const width of [544, 767, 900, 1100]) {
      const fl = await at(width, fluid)
      const pl = await at(width, plain)
      for (const id of ['w1', 'm1', 'l1']) assert.equal(fl[id], pl[id], `${id} at ${width}px`)
      // Slash radii and rounded-full (2147483647px when optimized) never interpolate.
      for (const id of ['r2', 'r3', 'r4']) assert.equal(fl[id], pl[id], `${id} at ${width}px`)
    }
    assert.equal(mid.r1, '10px') // rounded-sm 4px at 320px → rounded-2xl 16px at 768px
    assert.equal(mid.s1, '24px') // logical margins interpolate too
    assert.equal(mid.sp, '24px') // space-y-4 → md:space-y-8 on the children
    // text-4xl → md:text-6xl: the ratio glides with the size, 40px → 60px
    assert.ok(parseFloat(mid.lh) > 40 && parseFloat(mid.lh) < 60, `line-height ${mid.lh}`)
    assert.equal(mid.lh2, '24px') // leading-6 still wins over the text-* ratio

    // Containers (half the viewport; preflight zeroes the body margin): 16px
    // below 20rem of container, 32px from @md (28rem = 448px, a 896px
    // viewport), halfway at 384px (768px). Outside a container, @md: never
    // applies, as in Tailwind.
    for (const width of [896, 1100]) {
      const fl = await at(width, fluid)
      const pl = await at(width, plain)
      for (const id of ['cq1', 'cq2', 'cq3']) assert.equal(fl[id], pl[id], `${id} at ${width}px`)
    }
    const cmid = await at(768, fluid)
    assert.equal(cmid.cq1, '24px')
    assert.equal(cmid.cq3, '16px')
    // A breakpoint nested in the same breakpoint: the inner value wins from md up.
    for (const width of [900, 1100]) {
      const fl = await at(width, fluid)
      const pl = await at(width, plain)
      for (const id of ['n0', 'n0l', 'n3']) assert.equal(fl[id], pl[id], `${id} at ${width}px`)
    }
    assert.equal((await at(1100, fluid)).n0, '88px')
    assert.equal(mid.w2, '1000px') // w-full below md stays 100%
    assert.equal((await at(896, fluid)).w2, '320px') // 256px at 768 → 384px at 1024
  } finally {
    await browser.close()
  }
})
