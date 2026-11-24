/**
 * End-to-end check in a real browser: Tailwind → plugin → Chromium, asserting
 * computed styles at several viewport widths against plain Tailwind.
 *
 * Needs `playwright` (with Chromium 139+) and `@tailwindcss/postcss`, neither
 * of which is a dependency of this package. The test skips itself when they
 * are not installed (unless BROWSER_TEST is set, as on CI, where a missing tool fails the run):
 *
 *   npm i -D playwright @tailwindcss/postcss tailwindcss && npx playwright install chromium
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import autofluid from '../index.js'

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
  'w-12 md:w-1/2', 'w-[20vw] md:w-[50vw]', 'h-12 md:h-1/2', 'h-12 md:h-[50vh]', 'relative top-4 md:top-1/2',
  'border-2 md:border-8', 'border-x-2 md:border-x-8', 'divide-x-2 md:divide-x-8', 'outline-2 md:outline-8', 'outline-offset-2 md:outline-offset-8',
  'translate-x-4 md:translate-x-12', 'h-10 -translate-y-2 md:translate-y-1/2', 'scale-100 md:scale-150', 'scale-x-50 md:scale-x-150',
  'scale-[1.2] md:scale-[1.6]', 'rotate-0 md:rotate-90', '-rotate-12 md:rotate-45', 'opacity-20 md:opacity-100', 'opacity-[.2] md:opacity-80',
  'font-light md:font-black', 'font-[350] md:font-[650]',
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
    <div id="u1" class="w-12 md:w-1/2"></div>
    <div id="u2" class="w-[20vw] md:w-[50vw]"></div>
    <div id="u4" class="h-12 md:h-[50vh]"></div>
  </div>
  <div style="height: 400px">
    <div id="u3" class="h-12 md:h-1/2"></div>
    <div id="u5" class="relative top-4 md:top-1/2"></div>
  </div>
  <div id="b1" class="border-2 md:border-8"></div>
  <div id="b2" class="border-x-2 md:border-x-8"></div>
  <div class="flex divide-x-2 md:divide-x-8"><p id="dv">a</p><p>b</p></div>
  <div id="o1" class="outline-2 md:outline-8"></div>
  <div id="o2" class="outline-offset-2 md:outline-offset-8"></div>
  <div id="t1" class="translate-x-4 md:translate-x-12"></div>
  <div id="t2" class="h-10 -translate-y-2 md:translate-y-1/2"></div>
  <div id="k1" class="scale-100 md:scale-150"></div>
  <div id="k2" class="scale-x-50 md:scale-x-150"></div>
  <div id="k3" class="scale-[1.2] md:scale-[1.6]"></div>
  <div id="q1" class="rotate-0 md:rotate-90"></div>
  <div id="q2" class="-rotate-12 md:rotate-45"></div>
  <div id="op1" class="opacity-20 md:opacity-100"></div>
  <div id="op2" class="opacity-[.2] md:opacity-80"></div>
  <p id="fw1" class="font-light md:font-black"></p>
  <p id="fw2" class="font-[350] md:font-[650]"></p>
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

const PROP = { c: 'paddingLeft', i: 'fontSize', w1: 'width', w2: 'width', u1: 'width', u2: 'width', u3: 'height', u4: 'height', u5: 'top', b1: 'borderTopWidth', b2: 'borderLeftWidth', dv: 'borderRightWidth', o1: 'outlineWidth', o2: 'outlineOffset', t1: 'translate', t2: 'ty', k1: 'scale', k2: 'scale', k3: 'scale', q1: 'rotate', q2: 'rotate', op1: 'opacity', op2: 'opacity', fw1: 'fontWeight', fw2: 'fontWeight', l1: 'lineHeight', z1: 'top', n0: 'fontSize', n0l: 'lineHeight', n2: 'fontSize', n3: 'fontSize', r1: 'borderTopLeftRadius', r2: 'borderTopLeftRadius', r3: 'borderTopLeftRadius', r4: 'borderTopLeftRadius', s1: 'marginLeft', lh: 'lineHeight', lh2: 'lineHeight', sp: 'marginBottom', spl: 'marginBottom' }

const read = (PROP) =>
  Object.fromEntries(
    [...document.querySelectorAll('[id]')].map((el) => {
      const cs = getComputedStyle(el)
      // A percentage stays in the computed translate, so read where it lands.
      // offsetTop is rounded to whole pixels, so the difference is too.
      if (PROP[el.id] === 'ty') return [el.id, `${Math.round(el.getBoundingClientRect().top - el.offsetTop)}px`]
      return [el.id, cs[PROP[el.id] ?? 'marginTop']]
    }),
  )

for (const optimize of [false, true]) test(`computed styles match Tailwind at breakpoints and interpolate between them (${optimize ? 'optimized' : 'dev'} output)`, { skip: !(playwright && tailwind) && !process.env.BROWSER_TEST && 'playwright or @tailwindcss/postcss not installed' }, async () => {
  const source = `@import "tailwindcss"; @source inline("${classes.join(' ')}"); ${utilities}`
  // Production builds run Tailwind's optimizer, which rewrites values (calc(var(--spacing) * 0) → 0).
  const plain = (await postcss([tailwind.default({ optimize })]).process(source, { from: 'app.css' })).css
  // Every opt-in group on, so each kind of value is checked against Chromium.
  const fluid = (await postcss([autofluid({ include: 'all' })]).process(plain, { from: undefined })).css
  // The defaults: type and spacing only.
  const defaults = (await postcss([autofluid()]).process(plain, { from: undefined })).css

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
    const md = ['a', 'b', 'child', 'c', 'd', 'e', 'h', 'w1', 'u1', 'u2', 'u3', 'u4', 'u5', 'b1', 'b2', 'dv', 'o1', 'o2', 't1', 't2', 'k1', 'k2', 'k3', 'q1', 'q2', 'op1', 'op2', 'm1', 'l1', 'n0', 'n0l', 'n3', 'r1', 'r2', 'r3', 'r4', 's1', 'lh', 'lh2', 'sp', 'spl', 'cq3']
    const pick = (all) => Object.fromEntries(md.map((id) => [id, all[id]]))
    assert.deepEqual(pick(await at(768, fluid)), pick(await at(768, plain)), 'at 768px')

    // Between breakpoints it interpolates: 24px at 320px → 32px at 768px.
    const mid = await at(544, fluid)
    assert.equal(mid.a, '28px')
    assert.equal(mid.e, '20px') // max-md:mt-2 is the base token below md: 8px → 32px
    assert.equal(mid.f, '40px') // dark: base is a single token, so it stays put
    assert.equal(mid.child, '16px') // tokens do not inherit

    // A non-length at a breakpoint is a wall: below it nothing bends towards
    // the breakpoint above.
    for (const width of [544, 767, 900, 1100]) {
      const fl = await at(width, fluid)
      const pl = await at(width, plain)
      for (const id of ['m1', 'l1']) assert.equal(fl[id], pl[id], `${id} at ${width}px`)
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
    assert.equal(mid.w2, '628px') // w-full 1000px at 320 → md:w-64 256px at 768
    assert.equal((await at(896, fluid)).w2, '320px') // 256px at 768 → 384px at 1024
    assert.equal((await at(896, fluid)).w1, '692px') // md:w-full 1000px at 768 → 384px at 1024
    assert.equal(mid.u1, '274px') // 3rem → 50% of 1000px
    assert.ok(Math.abs(parseFloat(mid.u2) - 190.4) < 0.1, `u2 ${mid.u2}`) // 20vw → 50vw: 35vw at 544px
    assert.ok(Math.abs(parseFloat(mid.u4) - 124) < 0.1, `u4 ${mid.u4}`)
    // A percentage height interpolates where its parent has a height.
    assert.equal(mid.u3, '124px') // 48px → 50% of 400px
    assert.equal(mid.u5, '108px') // 16px → 50% of 400px
    // Border and outline widths, translate, scale, rotate and opacity: all halfway.
    for (const id of ['b1', 'b2', 'dv', 'o1', 'o2']) assert.equal(mid[id], '5px', id) // 2px → 8px
    assert.equal(mid.t1, '32px') // 16px → 48px, through --tw-translate-x
    assert.equal(mid.t2, '6px') // -8px → 50% of 40px
    assert.equal(mid.k1, '1.25') // 100% → 150%, through --tw-scale-x and -y
    assert.equal(mid.k2, '1') // scale-x 50% → 150%; y stays 1
    assert.equal(mid.k3, '1.4') // a bare scale: 1.2 → 1.6
    assert.equal(mid.q1, '45deg')
    assert.equal(mid.q2, '16.5deg') // -12deg → 45deg
    assert.equal(mid.op1, '0.6') // 20% → 100%
    assert.equal(mid.op2, '0.5') // .2 → 80%: a number and a percentage meet
    assert.equal(mid.fw1, '600') // 300 → 900, through Tailwind's theme variables
    assert.equal(mid.fw2, '500')

    // With the defaults, everything outside type and spacing steps exactly
    // like Tailwind at every width, while lengths still interpolate.
    const optIn = ['w1', 'u1', 'u2', 'u3', 'u4', 'u5', 'b1', 'b2', 'dv', 'o1', 'o2', 't1', 't2', 'k1', 'k2', 'k3', 'q1', 'q2', 'op1', 'op2', 'fw1', 'fw2']
    for (const width of [320, 544, 767, 768, 900, 1100, 1536]) {
      const fl = await at(width, defaults)
      const pl = await at(width, plain)
      for (const id of optIn) assert.equal(fl[id], pl[id], `${id} at ${width}px with the defaults`)
    }
    const dmid = await at(544, defaults)
    assert.equal(dmid.a, '28px')
    assert.equal(dmid.r1, '10px')
    // w-full is a wall below md; from md the two lengths still curve: 256px → 384px
    assert.equal((await at(544, defaults)).w2, (await at(544, plain)).w2)
    assert.equal((await at(900, defaults)).w2, '322px')
  } finally {
    await browser.close()
  }
})

/**
 * Root variables redefined per breakpoint, the way a design-token export
 * writes them: the base in `@theme`, each breakpoint as a `@variant` on
 * `:root`. Utilities that read them interpolate; everything else that reads
 * them, and every way Tailwind lets another class or scope override them,
 * must still land where plain Tailwind does.
 */
const tokens = `
  @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
  @theme static {
    --spacing: 1px;
    --layout-columns: 4; --layout-section-padding: 48px;
    --spacing-none: 0; --spacing-xs: 12px; --spacing-sm: 16px; --spacing-md: 24px;
    --typography-h1: 64px; --typography-body: 18px;
    --input-padding-x: var(--spacing-xs); --input-padding-2x: calc(var(--input-padding-x) * 2);
    --switch: 16px; --leading: 1.5; --tight: 1; --shrink: 16px; --fade: 0.2; --turn: 0deg; --header: 0; --px-unit: 10px;
  }
  @layer theme {
    :root {
      @variant md {
        --layout-columns: 8; --layout-section-padding: 72px; --spacing-xs: 16px; --spacing-sm: 24px; --spacing-md: 32px;
        --typography-h1: 96px; --typography-body: 20px;
        --switch: auto; --leading: 24px; --tight: 2; --shrink: 0; --fade: 1; --turn: 90deg;
      }
      @variant lg { --layout-columns: 12; --layout-section-padding: 96px; --typography-h1: 140px; }
    }
    @media (min-width: 768px) { :root { --px-unit: 30px; } }
    [data-theme=alt] { --typography-h1: 50px; }
    .has-header { --header: 64px; }
  }
  @utility h1 { font-size: var(--typography-h1); line-height: 1.1; }
  @layer components {
    .section { --spacing-xs: 5px; }
    .compact { --spacing-xs: 4px; --typography-h1: 30px; @variant xl { --spacing-xs: 6px; } @variant sm { --typography-h1: 40px; } }
  }
`

// id: [classes, computed property]
const tokenCases = {
  h1: ['h1', 'fontSize'], body: ['text-(length:--typography-body)', 'fontSize'],
  pxs: ['p-xs', 'paddingTop'], neg: ['-mt-xs', 'marginTop'], gap: ['grid gap-md', 'rowGap'], w: ['w-(--layout-section-padding)', 'width'],
  alias: ['px-(--input-padding-x)', 'paddingLeft'], alias2: ['p-(--input-padding-2x)', 'paddingTop'],
  sum: ['mt-[calc(var(--spacing-xs)+var(--layout-section-padding))]', 'marginTop'], fallback: ['mt-[var(--unset,var(--spacing-xs))]', 'marginTop'],
  // another class takes over at a breakpoint: below, at or above one of the variable's
  smp0: ['p-xs sm:p-0', 'paddingTop'], mdmt0: ['mt-(--layout-section-padding) md:mt-0', 'marginTop'], xlmt0: ['mt-(--layout-section-padding) xl:mt-0', 'marginTop'],
  h1sm: ['h1 text-sm', 'fontSize'], h1md: ['h1 md:text-sm', 'fontSize'], h1lg: ['h1 lg:text-sm', 'fontSize'],
  mdp: ['p-4 md:p-(--layout-section-padding)', 'paddingTop'], lgp: ['p-0 lg:p-xs', 'paddingTop'],
  pxspt: ['p-xs pt-4', 'paddingTop'], mxsmb: ['m-xs mb-4', 'marginBottom'], pxspx: ['p-xs md:px-0', 'paddingLeft'], imp: ['p-xs p-4!', 'paddingTop'], p4: ['p-4', 'paddingTop'],
  darkp: ['p-xs dark:p-4', 'paddingTop'], maxmd: ['max-md:p-xs', 'paddingTop'],
  // zeros
  none: ['p-none md:p-xs', 'paddingTop'], tonone: ['p-xs md:p-none', 'paddingTop'], shrink: ['p-(--shrink)', 'paddingTop'], header: ['pt-(--header)', 'paddingTop'],
  // not a scale: these step exactly like Tailwind
  cols: ['grid grid-cols-(--layout-columns)', 'gridTemplateColumns'], switch: ['mt-(--switch)', 'marginTop'], leading: ['leading-(--leading)', 'lineHeight'],
  // numbers interpolate with numbers; opt-in groups follow their variables once opted in
  tight: ['leading-(--tight)', 'lineHeight'], tx: ['translate-x-(--spacing-sm)', 'translate'], fade: ['opacity-(--fade)', 'opacity'], turn: ['rotate-(--turn)', 'rotate'],
  self: ['p-xs [--spacing-xs:2px]', 'paddingTop'], px: ['mt-(--px-unit) md:mt-2', 'marginTop'], px2: ['mt-(--px-unit) lg:mt-2', 'marginTop'],
}

const tokenHtml = `
  ${Object.entries(tokenCases).map(([id, [cls]]) => `<div id="${id}" class="${cls}">x</div>`).join('\n  ')}
  <div class="section"><p id="scoped" class="p-xs">x</p><p id="scopedalias" class="px-(--input-padding-x)">x</p><p id="scopedlg" class="p-0 lg:p-xs">x</p></div>
  <div class="[--spacing-xs:2px]"><p id="arbitrary" class="p-xs">x</p></div>
  <div class="compact"><p id="compact" class="p-xs">x</p><p id="compacth1" class="h1">x</p></div>
  <div data-theme="alt"><p id="themed" class="h1">x</p></div>
  <div data-theme="dark"><div class="dark:[--spacing-xs:3px]"><p id="dark" class="p-xs">x</p></div><p id="darkp2" class="p-xs dark:p-4">x</p></div>
  <div class="dark:[--spacing-xs:3px]"><p id="light" class="p-xs">x</p></div>
  <div class="has-header"><p id="header2" class="pt-(--header)">x</p><p id="header3" class="pt-(--header) md:pt-4">x</p></div>
  <div class="space-y-xs"><p id="space">a</p><p>b</p></div>
  <div class="@container" style="width: 50%"><p id="cq" class="p-0 @md:p-xs">x</p></div>
`
const TOKEN_PROP = {
  ...Object.fromEntries(Object.entries(tokenCases).map(([id, [, prop]]) => [id, prop])),
  scopedalias: 'paddingLeft', compacth1: 'fontSize', themed: 'fontSize', space: 'marginBottom',
}
const tokenClasses = [...new Set([...tokenHtml.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)))]

for (const optimize of [false, true]) test(`utilities that read responsive root variables interpolate, and nothing else changes (${optimize ? 'optimized' : 'dev'} output)`, { skip: !(playwright && tailwind) && !process.env.BROWSER_TEST && 'playwright or @tailwindcss/postcss not installed' }, async () => {
  const source = `@import "tailwindcss" source(none); @source inline("${tokenClasses.join(' ')}"); ${tokens}`
  const plain = (await postcss([tailwind.default({ optimize })]).process(source, { from: 'app.css' })).css
  const fluid = (await postcss([autofluid()]).process(plain, { from: undefined })).css
  const all = (await postcss([autofluid({ include: 'all' })]).process(plain, { from: undefined })).css

  const browser = await launch()
  try {
    const page = await browser.newPage()
    const at = async (width, css) => {
      await page.setViewportSize({ width, height: 400 })
      await page.setContent(`<!doctype html><style>${css}</style>${tokenHtml}`)
      return page.evaluate((PROP) => Object.fromEntries([...document.querySelectorAll('[id]')].map((el) => [el.id, getComputedStyle(el)[PROP[el.id] ?? 'paddingTop']])), TOKEN_PROP)
    }
    const ids = Object.keys(await at(320, plain))
    const except = (...skip) => ids.filter((id) => !skip.includes(id))

    // At the base and above the last breakpoint, everything is plain Tailwind.
    for (const width of [320, 1536]) assert.deepEqual(await at(width, fluid), await at(width, plain), `at ${width}px`)

    // At each breakpoint, so is every element that says something there. The
    // others are on their way to a breakpoint further up.
    const between = { 640: except('h1', 'body', 'pxs', 'neg', 'gap', 'w', 'alias', 'alias2', 'sum', 'fallback', 'mdmt0', 'xlmt0', 'h1md', 'h1lg', 'mdp', 'lgp', 'pxspx', 'darkp', 'maxmd', 'none', 'tonone', 'shrink', 'tight', 'px', 'px2', 'scopedalias', 'scopedlg', 'compact', 'light', 'header3', 'space'), 768: except('lgp', 'scopedlg', 'compact', 'cq'), 1024: except('compact'), 1280: ids }
    for (const [width, said] of Object.entries(between)) {
      const fl = await at(+width, fluid)
      const pl = await at(+width, plain)
      for (const id of said) assert.equal(fl[id], pl[id], `${id} at ${width}px`)
    }

    // What steps in Tailwind steps here, at every width: a property that is
    // not fluid, a variable that changes kind, an override in any scope, a
    // class that wins the property outright.
    const stepped = ['cols', 'switch', 'leading', 'tx', 'fade', 'turn', 'self', 'h1sm', 'pxspt', 'mxsmb', 'imp', 'p4', 'header', 'header2', 'scoped', 'arbitrary', 'themed', 'dark', 'darkp2']
    for (const width of [400, 544, 700, 767, 900, 1100, 1300]) {
      const fl = await at(width, fluid)
      const pl = await at(width, plain)
      for (const id of stepped) assert.equal(fl[id], pl[id], `${id} at ${width}px`)
    }

    // Halfway to md (20rem → 48rem), each reader is halfway between the variable's two values.
    const mid = await at(544, fluid)
    assert.equal(mid.h1, '80px') // 64px → 96px
    assert.equal(mid.body, '19px') // 18px → 20px
    assert.equal(mid.pxs, '14px') // 12px → 16px
    assert.equal(mid.neg, '-14px') // calc(var(--spacing-xs) * -1)
    assert.equal(mid.gap, '28px') // 24px → 32px
    assert.equal(mid.w, '60px') // 48px → 72px
    assert.equal(mid.alias, '14px') // --input-padding-x: var(--spacing-xs)
    assert.equal(mid.alias2, '28px') // an alias of the alias, doubled
    assert.equal(mid.sum, '74px') // two variables: 60px → 88px
    assert.equal(mid.fallback, '14px') // var(--unset, var(--spacing-xs))
    assert.equal(mid.space, '14px') // space-y-xs, on the children
    assert.equal(mid.tight, `${1.5 * 16}px`) // a number: 1 → 2 times the 16px font size
    assert.equal(mid.none, '8px') // --spacing-none: 0 → 16px
    assert.equal(mid.tonone, '6px') // 12px → 0
    assert.equal(mid.shrink, '8px') // a variable that is 0 at md: 16px → 0
    assert.equal(mid.mdmt0, '24px') // 48px → md:mt-0
    assert.equal(mid.mdp, '38px') // p-4 → the variable's md value, 72px
    assert.equal(mid.px, '6px') // 10px → md:mt-2 (2px here), though the variable's query is in px
    assert.equal(mid.scopedalias, '14px') // the alias was computed on the root, as in Tailwind
    assert.equal(mid.light, '14px') // dark:[--spacing-xs:3px] outside dark
    assert.equal(mid.header3, '34px') // a variable the root never changes stays live: 64px → md:pt-4 (4px here)

    // Between md and lg only what changes at lg moves.
    const upper = await at(896, fluid)
    assert.equal(upper.h1, '118px') // 96px → 140px
    assert.equal(upper.w, '84px') // 72px → 96px
    assert.equal(upper.mdp, '84px') // md:p-(--layout-section-padding) follows it up
    assert.equal(upper.sum, '100px') // 88px → 112px
    assert.equal(upper.pxs, '16px') // --spacing-xs has nothing above md
    assert.equal(upper.h1lg, '55px') // 96px → lg:text-sm 14px

    // A class that takes over below the variable's breakpoint keeps it from
    // there up: `p-xs sm:p-0` is 0 from sm, not on its way back to 16px.
    for (const width of [640, 700, 768, 900, 1024]) assert.equal((await at(width, fluid)).smp0, '0px', `smp0 at ${width}px`)
    assert.equal((await at(480, fluid)).smp0, '6px') // 12px → 0 at sm
    // …and one that takes over above it lets the variable run until then.
    const xl = await at(1152, fluid)
    assert.equal(xl.xlmt0, '48px') // 96px at lg → xl:mt-0
    assert.equal(xl.scopedlg, '5px') // lg:p-xs inside .section, which says nothing at md: its base value
    assert.ok(Math.abs(parseFloat(xl.compact) - 5.733) < 0.01, `compact ${xl.compact}`) // .compact sets it at xl only: 4px → 6px from the base, straight through md

    // A breakpoint that only one scope uses is that scope's alone: inside
    // .compact the heading steps up at sm, elsewhere it runs straight to md.
    const sm = await at(480, fluid)
    assert.equal(sm.compacth1, '35px') // 30px → 40px at sm
    assert.ok(Math.abs(parseFloat(sm.h1) - 75.43) < 0.01, `h1 ${sm.h1}`) // 64px → 96px at md
    assert.equal((await at(900, fluid)).compacth1, '40px')

    // Opted in, the other groups follow their variables too.
    const opted = await at(544, all)
    assert.equal(opted.tx, '20px') // 16px → 24px, through --tw-translate-x
    assert.equal(opted.fade, '0.6') // 0.2 → 1
    assert.equal(opted.turn, '45deg') // 0deg → 90deg
    for (const width of [320, 768, 1024, 1536]) {
      const fl = await at(width, all)
      const pl = await at(width, plain)
      for (const id of ['tx', 'fade', 'turn', 'h1', 'pxs', 'cols']) assert.equal(fl[id], pl[id], `${id} at ${width}px with every group`)
    }
  } finally {
    await browser.close()
  }
})

// `sr-only` hides an element and `not-sr-only` brings it back. Its 1px box
// and -1px margin are a state, not a size to bend towards.
const hiddenCases = {
  w: ['w-24 lg:sr-only', 'width'], p: ['p-4 lg:sr-only', 'paddingTop'], m: ['m-4 lg:sr-only', 'marginTop'], h: ['h-10 lg:sr-only', 'height'],
  px: ['px-4 lg:sr-only', 'paddingLeft'], back: ['sr-only lg:not-sr-only lg:p-4', 'paddingTop'], backm: ['sr-only lg:not-sr-only', 'marginTop'],
  grow: ['sr-only md:w-40', 'width'], only: ['sr-only', 'width'], dark: ['w-24 dark:lg:sr-only', 'width'],
  // the scale below the switch still runs, and holds from md until the switch
  scale: ['p-4 md:p-8 lg:sr-only', 'paddingTop'],
}
const hiddenHtml = Object.entries(hiddenCases).map(([id, [cls]]) => `<div id="${id}" class="${cls}">x</div>`).join('')
const hiddenClasses = [...new Set(Object.values(hiddenCases).flatMap(([cls]) => cls.split(' ')))]

for (const optimize of [false, true]) test(`sr-only is a switch and steps like Tailwind (${optimize ? 'optimized' : 'dev'} output)`, { skip: !(playwright && tailwind) && !process.env.BROWSER_TEST && 'playwright or @tailwindcss/postcss not installed' }, async () => {
  const source = `@import "tailwindcss" source(none); @source inline("${hiddenClasses.join(' ')}"); @custom-variant dark (&:where(.dark, .dark *));`
  const plain = (await postcss([tailwind.default({ optimize })]).process(source, { from: 'app.css' })).css
  const builds = {
    defaults: (await postcss([autofluid()]).process(plain, { from: undefined })).css,
    all: (await postcss([autofluid({ include: 'all' })]).process(plain, { from: undefined })).css,
  }

  const browser = await launch()
  try {
    const page = await browser.newPage()
    const at = async (width, css) => {
      await page.setViewportSize({ width, height: 400 })
      await page.setContent(`<!doctype html><style>${css}</style><body class="dark">${hiddenHtml}</body>`)
      return page.evaluate((cases) => Object.fromEntries(Object.entries(cases).map(([id, [, prop]]) => [id, getComputedStyle(document.getElementById(id))[prop]])), hiddenCases)
    }
    for (const [name, fluid] of Object.entries(builds)) {
      for (const width of [320, 500, 700, 767, 768, 900, 1000, 1023, 1024, 1300]) {
        const fl = await at(width, fluid)
        const pl = await at(width, plain)
        for (const id of Object.keys(hiddenCases)) {
          if (id !== 'scale' || width >= 768) assert.equal(fl[id], pl[id], `${id} at ${width}px (${name})`)
        }
      }
      assert.equal((await at(544, fluid)).scale, '24px', name) // 16px → 32px at md, as without the switch
    }
  } finally {
    await browser.close()
  }
})
