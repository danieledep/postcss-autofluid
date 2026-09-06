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

const classes = [
  'mt-6 md:mt-8', 'md:mt-8', 'md:px-12 p-4', 'mt-6 md:mt-auto', 'mt-6 max-md:mt-2 md:mt-8',
  'mt-6 dark:mt-10', 'mt-6 xl:mt-10 2xl:mt-11', 'mt-6 md:max-lg:mt-8', 'mt-4', 'text-base xl:text-xl',
]

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
`

const read = () =>
  Object.fromEntries(
    [...document.querySelectorAll('[id]')].map((el) => {
      const cs = getComputedStyle(el)
      return [el.id, el.id === 'c' ? cs.paddingLeft : el.id === 'i' ? cs.fontSize : cs.marginTop]
    }),
  )

test('computed styles match Tailwind at breakpoints and interpolate between them', { skip: !(playwright && tailwind) && 'playwright or @tailwindcss/postcss not installed' }, async () => {
  const source = `@import "tailwindcss"; @source inline("${classes.join(' ')}");`
  const plain = (await postcss([tailwind.default()]).process(source, { from: 'app.css' })).css
  const fluid = (await postcss([fluidVariants()]).process(plain, { from: undefined })).css

  const browser = await playwright.chromium.launch()
  try {
    const page = await browser.newPage({ colorScheme: 'dark' })
    const at = async (width, css) => {
      await page.setViewportSize({ width, height: 400 })
      await page.setContent(`<!doctype html><style>${css}</style>${html}`)
      return page.evaluate(read)
    }

    assert.ok(await page.evaluate(() => CSS.supports('top: --fl()')), 'Chromium must support @function')

    // At the ends of the range every element equals plain Tailwind; at md, the
    // elements whose tokens sit on md do (the others are mid-interpolation).
    for (const width of [320, 1536]) {
      assert.deepEqual(await at(width, fluid), await at(width, plain), `at ${width}px`)
    }
    const md = ['a', 'b', 'child', 'c', 'd', 'e', 'h']
    const pick = (all) => Object.fromEntries(md.map((id) => [id, all[id]]))
    assert.deepEqual(pick(await at(768, fluid)), pick(await at(768, plain)), 'at 768px')

    // Between breakpoints it interpolates: 24px at 320px → 32px at 768px.
    const mid = await at(544, fluid)
    assert.equal(mid.a, '28px')
    assert.equal(mid.e, '20px') // max-md:mt-2 is the base token below md: 8px → 32px
    assert.equal(mid.f, '40px') // dark: base is a single token, so it stays put
    assert.equal(mid.child, '16px') // tokens do not inherit
  } finally {
    await browser.close()
  }
})
