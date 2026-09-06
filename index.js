/**
 * postcss-fluid-variants
 *
 * Runs after Tailwind. For every responsive utility it finds in the output —
 *
 *   @media (width >= 48rem) { .md\:mt-8 { margin-top: calc(var(--spacing) * 8) } }
 *
 * — it appends an unconditional twin that publishes the value as a
 * breakpoint-tagged token and hands the property to one shared CSS function:
 *
 *   .md\:mt-8 { --fl-margin-top-48rem: calc(var(--spacing) * 8); margin-top: --fl-margin-top() }
 *
 * The browser's cascade then assembles whichever tokens co-occur on an element.
 * Two or more tokens for a property interpolate between their breakpoints; a
 * single token collapses to itself, which is exactly plain Tailwind behaviour.
 * No markup changes, no new syntax.
 *
 * Runtime: Chromium 140+ (`@function`, `if()`, typed calc arithmetic).
 * Everything is wrapped in `@supports`, so other browsers get Tailwind as-is.
 */

const DEFAULT_PROPERTIES = [
  ...expand('margin', 'padding', 'inset'),
  ...expand('margin', 'padding').flatMap((p) => [`${p}-inline`, `${p}-block`]),
  'inset-inline', 'inset-block',
  'gap', 'row-gap', 'column-gap',
  'font-size', 'line-height', 'letter-spacing', 'text-indent',
  'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height',
  'border-radius',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
]

function expand(...shorthands) {
  return shorthands.flatMap((s) =>
    s === 'inset'
      ? ['inset', 'top', 'right', 'bottom', 'left']
      : [s, `${s}-top`, `${s}-right`, `${s}-bottom`, `${s}-left`],
  )
}

/** A single class selector: no combinators, no pseudo, colons only if escaped. */
const SINGLE_CLASS = /^\.(?:\\.|[^\s\\:>+~,[\].#*])+$/

/** Tailwind v4 (`width >= 48rem`) and v3 (`min-width: 48rem`) breakpoint queries. */
const MIN_WIDTH = /^\(\s*(?:min-width\s*:|width\s*>=)\s*([\d.]+)(rem|em|px)\s*\)$/

/** Values that cannot be interpolated. */
const KEYWORD = /^(?:auto|none|normal|inherit|initial|unset|revert(?:-layer)?|(?:fit|min|max)-content)$/

const UNIT_PX = { px: 1, rem: 16, em: 16 }

const BASE = { key: '0', raw: null, px: 0 }

/**
 * Where does this rule sit in Tailwind's output?
 * Returns BASE for an unconditional utility, a width descriptor for a
 * `min-width` variant, or null for anything else (hover, dark, container…).
 */
function breakpointOf(rule) {
  let parent = rule.parent
  let width = BASE

  if (parent?.type === 'atrule' && parent.name === 'media') {
    const match = MIN_WIDTH.exec(parent.params)
    if (!match) return null
    const [, number, unit] = match
    const raw = number + unit
    width = { key: raw.replace('.', '_'), raw, px: Number(number) * UNIT_PX[unit] }
    parent = parent.parent
  }

  while (parent?.type === 'atrule' && parent.name === 'layer') parent = parent.parent
  return parent?.type === 'root' ? width : null
}

/** Nest `var()` fallbacks: [a, b] + tail → var(--a, var(--b, tail)) */
const chain = (names, tail) =>
  names.reduceRight((inner, name) => `var(${name}, ${inner})`, tail)

/** First-match lookup: if(style(--a): 1; style(--b): 2; else: tail) */
const lookup = (pairs, tail) =>
  pairs.length
    ? `if(${pairs.map(([name, value]) => `style(${name}): ${value}`).join('; ')}; else: ${tail})`
    : tail

export default function fluidVariants(options = {}) {
  const {
    prefix = 'fl',
    minWidth = '20rem',
    layer = 'utilities',
    properties = DEFAULT_PROPERTIES,
  } = options

  const fluidable = new Set(properties)
  const fn = `--${prefix}`
  const token = (prop, key) => `--${prefix}-${prop}-${key}`
  const param = (key) => `--v${key}`

  return {
    postcssPlugin: 'postcss-fluid-variants',

    OnceExit(root, { AtRule, Rule, Declaration }) {
      const widths = new Map()
      const props = new Set()
      const found = []

      root.walkRules((rule) => {
        if (!SINGLE_CLASS.test(rule.selector)) return
        const width = breakpointOf(rule)
        if (!width) return

        const decls = rule.nodes.filter(
          (node) =>
            node.type === 'decl' &&
            fluidable.has(node.prop) &&
            !KEYWORD.test(node.value.trim()),
        )
        if (!decls.length) return

        if (width !== BASE) widths.set(width.key, width)
        for (const { prop } of decls) props.add(prop)
        found.push({ selector: rule.selector, key: width.key, decls })
      })

      if (!found.length) return

      const bps = [...widths.values()].sort((a, b) => a.px - b.px)
      const keys = [BASE.key, ...bps.map((b) => b.key)]

      const decl = (prop, value) => new Declaration({ prop, value })

      // ── The shared interpolator ────────────────────────────────────────────
      // One `@media` band per breakpoint. In each band, `--lo` is the nearest
      // token at or below the band, `--hi` the nearest above; the matching
      // widths come from `if(style())`. Later bands override earlier locals.
      const interpolator = new AtRule({
        name: 'function',
        params: `${fn}(${keys.map(param).join(', ')})`,
      })

      for (let i = 0; i <= bps.length; i++) {
        const below = bps.slice(0, i).reverse()
        const above = bps.slice(i)

        const band = [
          decl('--lo', chain(below.map((b) => param(b.key)), `var(${param(BASE.key)})`)),
          decl('--lo-w', lookup(below.map((b) => [param(b.key), b.raw]), minWidth)),
          decl('--hi', chain(above.map((b) => param(b.key)), 'var(--lo)')),
          decl('--hi-w', lookup(above.map((b) => [param(b.key), b.raw]), '99999px')),
        ]

        if (i === 0) interpolator.append(band)
        else interpolator.append(new AtRule({ name: 'media', params: `(width >= ${bps[i - 1].raw})`, nodes: band }))
      }

      interpolator.append(
        decl(
          'result',
          'clamp(' +
            'min(var(--lo), var(--hi)), ' +
            'calc(var(--lo) + (var(--hi) - var(--lo)) * ((100vw - var(--lo-w)) / (var(--hi-w) - var(--lo-w)))), ' +
            'max(var(--lo), var(--hi)))',
        ),
      )

      // ── One thin wrapper per property, reading the element's tokens ───────
      const wrappers = [...props].map((prop) =>
        new AtRule({
          name: 'function',
          params: `${fn}-${prop}()`,
          nodes: [decl('result', `${fn}(${keys.map((k) => `var(${token(prop, k)})`).join(', ')})`)],
        }),
      )

      // ── The unconditional twins ───────────────────────────────────────────
      const twins = found.map(({ selector, key, decls }) =>
        new Rule({
          selector,
          nodes: decls.flatMap(({ prop, value }) => [
            decl(token(prop, key), value),
            decl(prop, `${fn}-${prop}()`),
          ]),
        }),
      )

      const supports = new AtRule({
        name: 'supports',
        params: `(top: ${fn}())`,
        nodes: [interpolator, ...wrappers, ...twins],
      })

      root.append(layer ? new AtRule({ name: 'layer', params: layer, nodes: [supports] }) : supports)
    },
  }
}

fluidVariants.postcss = true
