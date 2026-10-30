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
  ...expand('margin', 'padding', 'inset', 'scroll-margin', 'scroll-padding'),
  ...expand('margin', 'padding', 'scroll-margin', 'scroll-padding').flatMap((p) => [`${p}-inline`, `${p}-block`]),
  'inset-inline', 'inset-block',
  'gap', 'row-gap', 'column-gap',
  'font-size', 'line-height', 'letter-spacing',
  'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height',
  'flex-basis',
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
 * Units that interpolate by default: lengths that do not depend on the
 * containing block or the viewport. `%`, `vw`, `cqw` and friends are left out
 * on purpose: the interpolation runs over the viewport, so a curve between
 * `16rem` and `50%` would bend with the parent's width, not with the screen.
 * They are valid in `calc()` and can be opted in with the `units` option.
 */
const LENGTH_UNITS = ['px', 'rem', 'em', 'ch', 'ex', 'lh', 'rlh', 'cap', 'ic', 'rch', 'rex', 'rcap', 'ric', 'pt', 'pc', 'in', 'cm', 'mm', 'q']

/**
 * A bare zero. As a property value it is a length, but inside `calc()` it is a
 * <number>, so `calc(0 + (0px - 0) * …)` is invalid. Tailwind's optimizer turns
 * `calc(var(--spacing) * 0)` into exactly this (`top-0`, `m-0`, `inset-0`), so
 * a zero token is published as `0px`.
 */
const ZERO = /^\s*[+-]?(?:0+\.?0*|\.0+)\s*$/

/** Functions that keep a value a plain length when every argument is one. */
const MATH = /\b(?:calc|min|max|clamp)\(/gi

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

/** Split on top-level whitespace. `calc(1px * 2)` stays one value. */
function parts(value) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0 && (i === value.length || ch === ' ' || ch === '\t')) {
      if (i > start) out.push(value.slice(start, i))
      start = i + 1
    }
  }
  return out
}

/** The longhands a box shorthand sets: 2 values are axes, 3 and 4 are sides. */
function edges(prop) {
  const sides = ['top', 'right', 'bottom', 'left']
  // `inset` shortens to the bare sides; the others prefix theirs.
  const side = prop === 'inset' ? sides : sides.map((s) => `${prop}-${s}`)
  const inline = `${prop}-inline`
  return { 2: [`${prop}-block`, inline], 3: [side[0], inline, side[2]], 4: side }
}

/**
 * The longhands each shorthand's multi-value forms set. `border-radius` is
 * absent on purpose: its values map to corners, and the elliptical `/` form
 * does not split into longhands at all.
 */
const SHORTHANDS = {
  padding: edges('padding'),
  margin: edges('margin'),
  inset: edges('inset'),
  gap: { 2: ['row-gap', 'column-gap'] },
}

/**
 * The declaration as the interpolator can use it: one property, one value. A
 * shorthand list becomes its longhands, so each component interpolates on its
 * own. Null when the value is a list with no known decomposition.
 */
function components(prop, value) {
  const values = parts(value)
  if (values.length < 2) return [[prop, value]]
  const longhands = SHORTHANDS[prop]?.[values.length]
  return longhands ? longhands.map((name, i) => [name, values[i]]) : null
}

/** `:root`, `:host` and `html`, alone or in a list: where Tailwind and authors put theme variables. */
const ROOT = /^(?::root|:host|html)(?:\s*,\s*(?::root|:host|html))*$/

/**
 * Custom properties declared on the root, first definition wins. Tailwind v4
 * emits every theme variable a utility uses into `@layer theme` this way, so
 * `var(--spacing)` or `var(--text-xl)` can be resolved at build time.
 */
function themeOf(root) {
  const theme = new Map()
  root.walkRules((rule) => {
    if (!ROOT.test(rule.selector.trim())) return
    rule.each((node) => {
      if (node.type === 'decl' && node.prop.startsWith('--') && !theme.has(node.prop)) theme.set(node.prop, node.value.trim())
    })
  })
  return theme
}

/** Index of the `)` closing the `(` at `open`, or -1. */
function closing(value, open) {
  let depth = 0
  for (let i = open; i < value.length; i++) {
    if (value[i] === '(') depth++
    else if (value[i] === ')' && --depth === 0) return i
  }
  return -1
}

/**
 * Replace every `var()` with what it stands for: a theme value when the
 * variable is on the root, else its fallback. Null when a variable is neither,
 * since nothing can be said about a value only known at runtime.
 */
function resolve(value, theme, seen = new Set()) {
  let out = ''
  let i = 0
  for (let at = value.indexOf('var(', i); at !== -1; at = value.indexOf('var(', i)) {
    const end = closing(value, at + 3)
    if (end === -1) return null
    const inner = value.slice(at + 4, end)
    let comma = -1
    for (let j = 0, depth = 0; j < inner.length; j++) {
      if (inner[j] === '(') depth++
      else if (inner[j] === ')') depth--
      else if (inner[j] === ',' && depth === 0) { comma = j; break }
    }
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma === -1 ? null : inner.slice(comma + 1).trim()
    let sub = null
    if (theme.has(name) && !seen.has(name)) sub = resolve(theme.get(name), theme, new Set(seen).add(name))
    else if (fallback) sub = resolve(fallback, theme, seen)
    if (sub == null) return null
    out += value.slice(i, at) + sub
    i = end + 1
  }
  return out + value.slice(i)
}

/**
 * Can this value take part in the interpolation? Only when, once its variables
 * are resolved, it is arithmetic over lengths in the allowed units: at least
 * one length, any number of plain multipliers, nothing else. Keywords, ratios
 * (`line-height: 1.5`), relative units and anything unresolvable are not; they
 * keep their literal value and stop the interpolation at their breakpoint.
 */
function interpolable(value, theme, units) {
  if (KEYWORD.test(value)) return false
  const resolved = resolve(value, theme)
  if (resolved == null) return false
  if (ZERO.test(resolved)) return true // a bare zero is a length
  let lengths = 0
  const rest = resolved
    .replace(MATH, '(')
    .replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?([a-z%]*)/gi, (_, unit) => {
      if (!unit) return ' '
      if (units.has(unit.toLowerCase())) { lengths++; return ' ' }
      return '\0'
    })
  return lengths > 0 && /^[\s()+\-*/,]*$/.test(rest)
}

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
    layers = 'auto',
    units = LENGTH_UNITS,
  } = options

  const fluidable = new Set(properties)
  const lengthUnits = new Set(units.map((u) => u.toLowerCase()))
  const fn = `--${prefix}`
  const token = (prop, key) => `--${prefix}-${prop}-${key}`
  // A fixed value at a breakpoint publishes this instead of a value token.
  const stop = (prop, key) => `--${prefix}-${prop}-${key}-stop`
  const param = (key) => `--v${key}`
  const stopParam = (key) => `--s${key}`

  return {
    postcssPlugin: 'postcss-fluid-variants',

    OnceExit(root, { AtRule, Rule, Declaration, result }) {
      // Which layers to read. 'auto' reads only `@layer utilities` when the
      // stylesheet has one — Tailwind v4 puts every generated utility and
      // every `@utility` block there — and everything otherwise, which is
      // what unlayered Tailwind v3 output needs. Null reads every rule.
      let scope = null
      if (layers === 'auto') {
        let layered = false
        root.walkAtRules('layer', (at) => {
          if (at.nodes && at.params.trim() === 'utilities') layered = true
        })
        if (layered) scope = new Set(['utilities'])
      } else if (layers) {
        scope = new Set(layers)
      }

      const inScope = (node) => {
        if (!scope) return true
        for (let p = node.parent; p && p.type !== 'root'; p = p.parent) {
          if (p.type === 'atrule' && p.name === 'layer' && scope.has(p.params.trim())) return true
        }
        return false
      }

      const theme = themeOf(root)
      const isFixed = (value) => !interpolable(value, theme, lengthUnits)

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
        if (!inScope(node)) return
        const path = rule.selector + ancestors.map((at) => `\n@${at.name} ${at.params}`).join('')
        let group = groups.get(path)
        if (!group) {
          group = { selector: rule.selector, source: rule.source, ...context, decls: [] }
          groups.set(path, group)
          found.push(group)
        }
        const { prop, value, source } = node
        // A list the interpolator cannot take is kept as written, not tokenised.
        const split = components(prop, value.trim())
        if (!split || split.some(([name]) => !fluidable.has(name))) {
          group.decls.push({ prop, value, source, fixed: true })
          return
        }
        for (const [name, part] of split) {
          group.decls.push({ prop: name, value: part, source, fixed: isFixed(part) })
        }
      })

      // A property with no responsive value anywhere in the build has nothing
      // to interpolate towards, so it needs no twins at all.
      const props = new Set()
      for (const { width, decls } of found) {
        if (width === BASE) continue
        for (const { prop, fixed } of decls) if (!fixed) props.add(prop)
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
            if (!fluidable.has(node.prop) || !inScope(node)) return
            const split = components(node.prop, node.value.trim())
            if (split?.some(([name, part]) => fluidable.has(name) && !isFixed(part))) responsive++
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

      // A fixed value at a breakpoint (`md:w-full`, `md:mt-auto`) is a wall:
      // the band below must hold its own value up to that breakpoint instead
      // of bending towards a token further up. It publishes a stop token,
      // which the interpolator checks before the value token at that width.
      // A fixed base value needs none — nothing interpolates below the base.
      const widths = new Map()
      const stopKeys = new Set()
      const published = new Set()
      for (const { width, decls } of found) {
        for (const { prop, fixed } of decls) {
          if (!props.has(prop)) continue
          if (fixed) {
            if (width === BASE) continue
            stopKeys.add(width.key)
            published.add(stop(prop, width.key))
          } else {
            published.add(token(prop, width.key))
          }
          if (width !== BASE) widths.set(width.key, width)
        }
      }

      const bps = [...widths.values()].sort((a, b) => a.px - b.px)
      const keys = [BASE.key, ...bps.map((b) => b.key)]
      const stops = bps.filter((b) => stopKeys.has(b.key)).map((b) => b.key)

      const decl = (prop, value, source) => new Declaration({ prop, value, source })

      // ── The shared interpolator ────────────────────────────────────────────
      // One `@media` band per breakpoint. In each band, `--lo` is the nearest
      // token at or below the band, `--hi` the nearest above; the matching
      // widths come from `if(style())`. Later bands override earlier locals.
      const interpolator = new AtRule({
        name: 'function',
        params: `${fn}(${[...keys.map(param), ...stops.map(stopParam)].join(', ')})`,
      })

      for (let i = 0; i <= bps.length; i++) {
        const below = bps.slice(0, i).reverse()
        const above = bps.slice(i)

        // Above the band, take the nearest breakpoint that says anything. A
        // stop there means hold: `--hi` becomes `--lo` and the value is flat.
        const walled = above.some((b) => stopKeys.has(b.key))
        const hiPairs = (value) =>
          above.flatMap((b) => [
            ...(stopKeys.has(b.key) ? [[stopParam(b.key), value(b, true)]] : []),
            [param(b.key), value(b, false)],
          ])

        const band = [
          decl('--lo', chain(below.map((b) => param(b.key)), `var(${param(BASE.key)})`)),
          decl('--lo-w', lookup(below.map((b) => [param(b.key), b.raw]), minWidth)),
          decl(
            '--hi',
            walled
              ? lookup(hiPairs((b, isStop) => (isStop ? 'var(--lo)' : `var(${param(b.key)})`)), 'var(--lo)')
              : chain(above.map((b) => param(b.key)), 'var(--lo)'),
          ),
          decl('--hi-w', lookup(hiPairs((b) => b.raw), '99999px')),
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
          nodes: [
            decl(
              'result',
              `${fn}(${[...keys.map((k) => `var(${token(prop, k)})`), ...stops.map((k) => `var(${stop(prop, k)})`)].join(', ')})`,
            ),
          ],
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
        for (const { prop, value, fixed, source } of decls) {
          if (!props.has(prop)) continue
          if (fixed) {
            if (width !== BASE) tokens.push(decl(stop(prop, width.key), '1', source))
            values.push(decl(prop, value, source))
          } else {
            tokens.push(decl(token(prop, width.key), ZERO.test(value) ? '0px' : value, source))
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
