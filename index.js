/**
 * postcss-fluid-variants
 *
 * Runs after Tailwind. For every responsive utility it finds in the output —
 *
 *   @media (width >= 48rem) { .md\:mt-8 { margin-top: calc(var(--spacing) * 8) } }
 *
 * — it appends a twin that publishes the value as a breakpoint-tagged token and
 * hands the property to one shared CSS function:
 *
 *   .md\:mt-8 { --fl-margin-top-48rem: calc(var(--spacing) * 8) }
 *   @media (width >= 48rem) { .md\:mt-8 { margin-top: --fl-margin-top() } }
 *
 * The browser's cascade then assembles whichever tokens co-occur on an element.
 * Two or more tokens for a property interpolate between their breakpoints; a
 * single token collapses to itself, which is exactly plain Tailwind behaviour.
 * No markup changes, no new syntax.
 *
 * A twin mirrors its original exactly — same selector, same at-rule ancestors
 * (layers included), same order — so it wins precisely where the original would
 * have won. The only difference is that the token is published without the
 * breakpoint media, so the band below can already interpolate towards it.
 *
 * Runtime: Chromium 139+ (`@function`, `if()`, typed calc arithmetic).
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

/**
 * A rule with the specificity of one class: a single class selector (escapes
 * allowed, e.g. `.\32 xl\:mt-11`) optionally followed by `:where(…)`, which is
 * how Tailwind wraps zero-specificity variants such as class-based `dark:`.
 * Anything more specific keeps beating the twins on its own and is left alone.
 */
const UTILITY = /^\.(?:\\[0-9a-f]{1,6} ?|\\.|[^\s\\:>+~,[\].#*()])+(?::where\((?:[^()]|\([^()]*\))*\))*$/i

/** Tailwind v4 (`width >= 48rem`) and v3 (`min-width: 48rem`) breakpoint queries. */
const MIN_WIDTH = /^\(\s*(?:min-width\s*:|width\s*>=)\s*([\d.]+)(rem|em|px)\s*\)$/

/** Values that cannot be interpolated. */
const KEYWORD = /^(?:auto|none|normal|inherit|initial|unset|revert(?:-layer)?|(?:fit|min|max)-content)$/

const UNIT_PX = { px: 1, rem: 16, em: 16 }

const BASE = { key: '0', raw: null, px: 0 }

/**
 * Where does this declaration sit in Tailwind's output?
 * Returns its rule, the at-rule ancestors (outermost first), the breakpoint
 * among them — BASE when there is none — and the ancestors the token keeps.
 *
 * The walk starts at the declaration because a breakpoint can sit on either
 * side of the rule. Tailwind flattens `@media { .sel { … } }` only when its
 * optimizer runs; unoptimized it nests the query inside the rule instead.
 * Both shapes carry the same facts, and walking up from the declaration
 * collects them either way.
 *
 * Null when there is no rule, or when a second one appears: two rules mean
 * `&`-nesting (`hover:`, `group-*`, `after:`), whose flattened selector is not
 * a lone class and is rejected on the flat path too.
 */
function contextOf(decl) {
  const ancestors = []
  let rule = null
  for (let parent = decl.parent; parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'rule') {
      if (rule) return null
      rule = parent
    } else if (parent.type === 'atrule') {
      ancestors.unshift(parent)
    } else {
      return null
    }
  }
  if (!rule) return null

  let width = BASE
  let breakpoint = null
  for (const atRule of ancestors) {
    const match = atRule.name === 'media' && MIN_WIDTH.exec(atRule.params)
    if (!match) continue
    const [, number, unit] = match
    const px = Number(number) * UNIT_PX[unit]
    if (px <= width.px) continue
    const raw = number + unit
    width = { key: raw.replace('.', '_'), raw, px }
    breakpoint = atRule
  }

  return { rule, ancestors, width, conditions: ancestors.filter((atRule) => atRule !== breakpoint) }
}

/** Nest `var()` fallbacks: [a, b] + tail → var(--a, var(--b, tail)) */
const chain = (names, tail) =>
  names.reduceRight((inner, name) => `var(${name}, ${inner})`, tail)

/** First-match lookup: if(style(--a): 1; style(--b): 2; else: tail) */
const lookup = (pairs, tail) =>
  pairs.length
    ? `if(${pairs.map(([name, value]) => `style(${name}): ${value}`).join('; ')}; else: ${tail})`
    : tail

function fluidVariants(options = {}) {
  const {
    prefix = 'fl',
    minWidth = '20rem',
    properties = DEFAULT_PROPERTIES,
  } = options

  const fluidable = new Set(properties)
  const fn = `--${prefix}`
  const token = (prop, key) => `--${prefix}-${prop}-${key}`
  const param = (key) => `--v${key}`

  return {
    postcssPlugin: 'postcss-fluid-variants',

    OnceExit(root, { AtRule, Rule, Declaration, result }) {
      // Declarations that share a selector and an at-rule chain become one
      // twin. `walkDecls` is document order and a Map keeps insertion order,
      // so twins stay in their originals' relative order.
      const found = []
      const groups = new Map()
      root.walkDecls((node) => {
        if (!fluidable.has(node.prop) || node.important) return
        const context = contextOf(node)
        if (!context || !UTILITY.test(context.rule.selector)) return

        const { rule, ancestors } = context
        const path = rule.selector + ancestors.map((at) => `\n@${at.name} ${at.params}`).join('')
        let group = groups.get(path)
        if (!group) {
          group = { selector: rule.selector, source: rule.source, ...context, decls: [] }
          groups.set(path, group)
          found.push(group)
        }
        const { prop, value, source } = node
        group.decls.push({ prop, value, source, keyword: KEYWORD.test(value.trim()) })
      })

      // A property with no responsive value anywhere in the build has nothing
      // to interpolate towards, so it needs no twins at all.
      const props = new Set()
      for (const { width, decls } of found) {
        if (width === BASE) continue
        for (const { prop, keyword } of decls) if (!keyword) props.add(prop)
      }
      if (!props.size) {
        // Nothing matched. If the stylesheet plainly carries responsive values
        // for fluid properties, its shape is one this walk does not read — say
        // so, rather than emitting nothing and looking like a browser-support
        // gap that @supports quietly handled.
        let responsive = 0
        root.walkAtRules('media', (atRule) => {
          if (!MIN_WIDTH.test(atRule.params)) return
          atRule.walkDecls((node) => {
            if (fluidable.has(node.prop) && !KEYWORD.test(node.value.trim())) responsive++
          })
        })
        if (responsive) {
          result.warn(
            `Found ${responsive} responsive declaration(s) for fluid properties but could not read ` +
              'any of them, so nothing was made fluid. This usually means the stylesheet is shaped ' +
              'in a way this plugin does not understand yet.',
            { plugin: 'postcss-fluid-variants' },
          )
        }
        return
      }

      const widths = new Map()
      const published = new Set()
      for (const { width, decls } of found) {
        for (const { prop, keyword } of decls) {
          if (keyword || !props.has(prop)) continue
          if (width !== BASE) widths.set(width.key, width)
          published.add(token(prop, width.key))
        }
      }

      const bps = [...widths.values()].sort((a, b) => a.px - b.px)
      const keys = [BASE.key, ...bps.map((b) => b.key)]

      const decl = (prop, value, source) => new Declaration({ prop, value, source })

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

      // Tokens must not inherit, or a parent's breakpoint value would leak into
      // every child that has a fluid twin of its own.
      const registrations = [...published].map(
        (name) =>
          new AtRule({
            name: 'property',
            params: name,
            nodes: [decl('syntax', '"*"'), decl('inherits', 'false')],
          }),
      )

      const supports = new AtRule({
        name: 'supports',
        params: `(top: ${fn}())`,
        nodes: [interpolator, ...wrappers, ...registrations],
      })

      // ── The twins, in the same at-rule context as their originals ─────────
      // Identical ancestor chains share one nested group, so the output stays
      // as compact as Tailwind's own. First-seen order follows source order.
      // A group is reused only while it is still the most recent thing at its
      // level: a twin that jumped backwards past a rule setting real
      // properties would lose a cascade race its original would have won.
      // Token-only rules publish custom properties and nothing else, so they
      // are inert and do not close a group.
      const isTokenOnly = (node) =>
        node.type === 'rule' && node.every((child) => child.prop?.startsWith('--'))

      const groupFor = (ancestors) => {
        let parent = supports
        for (const { name, params } of ancestors) {
          let last = parent.last
          while (last && isTokenOnly(last)) last = last.prev()
          if (last?.type === 'atrule' && last.name === name && last.params === params) {
            parent = last
          } else {
            const group = new AtRule({ name, params, nodes: [] })
            parent.append(group)
            parent = group
          }
        }
        return parent
      }

      for (const { selector, source, width, ancestors, conditions, decls } of found) {
        const tokens = []
        const values = []
        for (const { prop, value, keyword, source } of decls) {
          if (!props.has(prop)) continue
          if (keyword) {
            values.push(decl(prop, value, source))
          } else {
            tokens.push(decl(token(prop, width.key), value, source))
            values.push(decl(prop, `${fn}-${prop}()`, source))
          }
        }

        if (tokens.length && width !== BASE) {
          groupFor(conditions).append(new Rule({ selector, nodes: tokens, source }))
          groupFor(ancestors).append(new Rule({ selector, nodes: values, source }))
        } else if (tokens.length || values.length) {
          groupFor(ancestors).append(new Rule({ selector, nodes: [...tokens, ...values], source }))
        }
      }

      // Everything generated points at a real location, for source maps and
      // for bundlers that flag sourceless nodes (Vite does).
      const origin = found[0].source
      supports.source = origin
      supports.walk((node) => { node.source ??= origin })

      root.append(supports)
    },
  }
}

fluidVariants.postcss = true

module.exports = fluidVariants
