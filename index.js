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
  ...['margin', 'padding', 'scroll-margin', 'scroll-padding', 'inset'].flatMap(logical),
  'gap', 'row-gap', 'column-gap',
  'font-size', 'line-height', 'letter-spacing',
  'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height',
  'flex-basis',
  'border-radius',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-start-start-radius', 'border-start-end-radius',
  'border-end-start-radius', 'border-end-end-radius',
]

/** The logical forms of a box shorthand: its two axes and their four ends. */
function logical(shorthand) {
  const axes = [`${shorthand}-inline`, `${shorthand}-block`]
  return [...axes, ...axes.flatMap((axis) => [`${axis}-start`, `${axis}-end`])]
}

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

/** One class name, escapes allowed (`.\32 xl\:mt-11`). */
const CLASS = String.raw`\.(?:\\[0-9a-f]{1,6} ?|\\.|[^\s\\:>+~,[\].#*()])+`

/**
 * A rule with the specificity of one class, or of none: a single class
 * selector, or the zero-specificity `:where(.cls > :not(:last-child))` that
 * `space-x-*` and `space-y-*` put on an element's children, optionally
 * followed by `:where(…)`, which is how Tailwind wraps zero-specificity
 * variants such as class-based `dark:`. Anything more specific keeps beating
 * the twins on its own and is left alone.
 */
const UTILITY = new RegExp(
  String.raw`^(?:${CLASS}|:where\(${CLASS}\s*>\s*:not\(:last-child\)\))(?::where\((?:[^()]|\([^()]*\))*\))*$`,
  'i',
)

/** Tailwind v4 (`width >= 48rem`) and v3 (`min-width: 48rem`) breakpoint queries. */
const MIN_WIDTH = /^\(\s*(?:min-width\s*:|width\s*>=)\s*([\d.]+)(rem|em|px)\s*\)$/

/**
 * Lengths this large are not sizes but stand-ins for infinity. Tailwind's
 * `rounded-full` is `calc(infinity * 1px)`, which its optimizer folds into
 * `2147483647px`; interpolating from `4px` towards that is already fully round
 * a few pixels above the base. No real length reaches a million units.
 */
const HUGE = 1e6

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

/**
 * Does the value have a `/` outside any parentheses? At the top level a slash
 * is a separator, never division: `border-radius: 4px/8px` is horizontal over
 * vertical radii. Inside `calc()` the same text would divide two lengths into
 * a number, so such a value must never become a token.
 */
function slashed(value) {
  let depth = 0
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === '/' && depth === 0) return true
  }
  return false
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
  // `margin-inline: 1px 2px` is its start, then its end
  ...Object.fromEntries(
    ['margin', 'padding', 'scroll-margin', 'scroll-padding', 'inset']
      .flatMap((p) => [`${p}-inline`, `${p}-block`])
      .map((axis) => [axis, { 2: [`${axis}-start`, `${axis}-end`] }]),
  ),
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
 * (`line-height: 1.5`), relative units, a top-level `/` (`4px/8px`), lengths
 * standing in for infinity and anything unresolvable are not; they keep their
 * literal value and stop the interpolation at their breakpoint.
 */
function interpolable(value, theme, units) {
  if (KEYWORD.test(value)) return false
  const resolved = resolve(value, theme)
  if (resolved == null || slashed(resolved)) return false
  if (ZERO.test(resolved)) return true // a bare zero is a length
  let lengths = 0
  const rest = resolved
    .replace(MATH, '(')
    .replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?([a-z%]*)/gi, (number, unit) => {
      if (!unit) return ' '
      if (units.has(unit.toLowerCase()) && Math.abs(parseFloat(number)) < HUGE) { lengths++; return ' ' }
      return '\0'
    })
  return lengths > 0 && /^[\s()+\-*/,]*$/.test(rest)
}

/**
 * Properties whose unitless numbers interpolate too, on a token family of
 * their own (`--fl-line-height-num-*`). Tailwind's `text-*` utilities set
 * `line-height` to a ratio, so `text-sm md:text-lg` would otherwise step at
 * `md` while the font size glides. A number never meets a length: each kind
 * is a wall for the other, exactly like a keyword.
 */
const NUMBER_PROPS = new Set(['line-height'])

/** Is this value plain arithmetic over unitless numbers, once resolved? */
function numeric(value, theme) {
  if (KEYWORD.test(value)) return false
  const resolved = resolve(value, theme)
  if (resolved == null || slashed(resolved)) return false
  let numbers = 0
  const rest = resolved
    .replace(MATH, '(')
    .replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?([a-z%]*)/gi, (number, unit) => {
      if (unit || Math.abs(parseFloat(number)) >= HUGE) return '\0'
      numbers++
      return ' '
    })
  return numbers > 0 && /^[\s()+\-*/,]*$/.test(rest)
}

const UNIT_PX = { px: 1, rem: 16, em: 16 }

const BASE = { key: '0', raw: null, px: 0, axis: null }

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

  // The widest breakpoint is the token's. Every other min-width query in the
  // chain is implied by it, so it is no condition either: `md:` on an
  // `@utility` that holds its own `@variant md` (or `@variant sm`) nests one
  // breakpoint inside another, and the inner value must be published as
  // unconditionally as the outer one, or the band below cannot see it.
  //
  // Unnamed container queries (`@md:`) are breakpoints on a second axis, the
  // container's width, keyed `c28rem`. A chain that mixes both axes
  // (`@lg:md:`) keeps the viewport breakpoint and treats the container
  // query as a condition, which is what it was before containers interpolated.
  const widest = (name, axis) => {
    let width = BASE
    const found = new Set()
    for (const atRule of ancestors) {
      const match = atRule.name === name && MIN_WIDTH.exec(atRule.params)
      if (!match) continue
      found.add(atRule)
      const [, number, unit] = match
      const px = Number(number) * UNIT_PX[unit]
      if (px <= width.px) continue
      const raw = number + unit
      width = { key: (axis === 'cq' ? 'c' : '') + raw.replace('.', '_'), raw, px, axis }
    }
    return { width, found }
  }
  let { width, found: breakpoints } = widest('media', 'vw')
  if (width === BASE) ({ width, found: breakpoints } = widest('container', 'cq'))

  return { rule, ancestors, width, conditions: ancestors.filter((atRule) => !breakpoints.has(atRule)) }
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
    containerMinWidth = minWidth,
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
  // Set under a container query that sets a value for the property: the
  // container decides, as Tailwind's later-sorted `@` variants do.
  const inContainer = (prop) => `--${prefix}-${prop}-cq`
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

      // A rule's own custom properties are known for its declarations:
      // `space-y-*` multiplies by `--tw-space-y-reverse`, which the same rule
      // sets to 0 (`space-y-reverse` flips it to 1 at runtime, still a number).
      const scopes = new WeakMap()
      const varsOf = (rule) => {
        if (!scopes.has(rule)) {
          let local = null
          rule.each((n) => {
            if (n.type === 'decl' && n.prop.startsWith('--')) (local ??= new Map(theme)).set(n.prop, n.value.trim())
          })
          scopes.set(rule, local ?? theme)
        }
        return scopes.get(rule)
      }

      // Which token family a value joins: the property's own for lengths,
      // `<prop>-num` for unitless numbers where those are valid, none (fixed)
      // for everything else.
      const channelOf = (prop, value, vars) =>
        interpolable(value, vars, lengthUnits)
          ? prop
          : NUMBER_PROPS.has(prop) && numeric(value, vars)
            ? `${prop}-num`
            : null

      // Declarations that share a selector and an at-rule chain become one
      // twin. `walkDecls` is document order and a Map keeps insertion order,
      // so twins stay in their originals' relative order.
      const found = []
      const groups = new Map()
      root.walkDecls((node) => {
        if (!fluidable.has(node.prop) || node.important) return
        const context = contextOf(node)
        if (!context || !inScope(node)) return

        // Tailwind's optimizer merges neighbours with identical bodies into a
        // list (`.h1, .md\:h0 { … }`). A list is its selectors one after the
        // other, so each lone class in it is read as a rule of its own.
        const { rule, ancestors } = context
        const chainPath = ancestors.map((at) => `\n@${at.name} ${at.params}`).join('')
        const { prop, value, source } = node
        const vars = varsOf(node.parent)
        // A list the interpolator cannot take is kept as written, not tokenised.
        const split = components(prop, value.trim())
        const kept = !split || split.some(([name]) => !fluidable.has(name))
          ? [{ prop, value, source, channel: null }]
          : split.map(([name, part]) => ({ prop: name, value: part, source, channel: channelOf(name, part, vars) }))

        for (const selector of rule.selectors) {
          if (!UTILITY.test(selector)) continue
          const path = selector + chainPath
          let group = groups.get(path)
          if (!group) {
            group = { ...context, selector, source: rule.source, decls: [] }
            groups.set(path, group)
            found.push(group)
          }
          group.decls.push(...kept)
        }
      })

      // A token family with no responsive value anywhere in the build has
      // nothing to interpolate towards, so it needs no twins at all.
      const channels = new Map()
      for (const { width, decls } of found) {
        if (width === BASE) continue
        for (const { prop, channel } of decls) if (channel) channels.set(channel, prop)
      }
      const channelsOf = new Map()
      for (const [channel, prop] of channels) channelsOf.set(prop, [...(channelsOf.get(prop) ?? []), channel])

      if (!channels.size) {
        // Nothing matched. If the stylesheet plainly carries responsive values
        // for fluid properties, its shape is one this walk does not read — say
        // so, rather than emitting nothing and looking like a browser-support
        // gap that @supports quietly handled.
        let responsive = 0
        let first = null
        root.walkAtRules('media', (atRule) => {
          if (!MIN_WIDTH.test(atRule.params)) return
          atRule.walkDecls((node) => {
            if (!fluidable.has(node.prop) || !inScope(node)) return
            const split = components(node.prop, node.value.trim())
            if (split?.some(([name, part]) => fluidable.has(name) && channelOf(name, part, varsOf(node.parent)))) {
              responsive++
              first ??= node
            }
          })
        })
        if (responsive) {
          result.warn(
            `Found ${responsive} responsive declaration(s) for fluid properties but could not read ` +
              'any of them, so nothing was made fluid. This usually means the stylesheet is shaped ' +
              'in a way this plugin does not understand yet.',
            { node: first },
          )
        }
        return
      }

      // A fixed value at a breakpoint (`md:w-full`, `md:mt-auto`) is a wall:
      // the band below must hold its own value up to that breakpoint instead
      // of bending towards a token further up. It publishes a stop token,
      // which the interpolator checks before the value token at that width.
      // A value of the other kind (a ratio where lengths interpolate, or the
      // reverse) is a wall for that family in the same way. A fixed base
      // value needs none — nothing interpolates below the base.
      const widths = new Map()
      const stopKeys = new Set()
      const published = new Set()
      for (const { width, decls } of found) {
        for (const { prop, channel } of decls) {
          for (const own of channelsOf.get(prop) ?? []) {
            if (own === channel) {
              published.add(token(own, width.key))
              if (width.axis === 'cq') published.add(inContainer(own))
            } else {
              if (width === BASE) continue
              stopKeys.add(width.key)
              published.add(stop(own, width.key))
            }
            if (width !== BASE) widths.set(width.key, width)
          }
        }
      }

      const sorted = (axis) => [...widths.values()].filter((b) => b.axis === axis).sort((a, b) => a.px - b.px)
      const bps = sorted('vw')
      const cbps = sorted('cq')
      const keys = [BASE.key, ...bps.map((b) => b.key), ...cbps.map((b) => b.key)]
      const stops = [...bps, ...cbps].filter((b) => stopKeys.has(b.key)).map((b) => b.key)

      const decl = (prop, value, source) => new Declaration({ prop, value, source })

      // ── The shared interpolator ────────────────────────────────────────────
      // One band per breakpoint. In each band, `--lo` is the nearest token at
      // or below the band, `--hi` the nearest above; the matching widths come
      // from `if(style())`. Later bands override earlier locals. Viewport
      // bands are `@media`; container bands are `@container` and use their
      // own locals (`--clo`, `--chi`, …).
      const bandsFor = (list, v, floor, query) => {
        const nodes = []
        for (let i = 0; i <= list.length; i++) {
          const below = list.slice(0, i).reverse()
          const above = list.slice(i)

          // Above the band, take the nearest breakpoint that says anything. A
          // stop there means hold: `--hi` becomes `--lo` and the value is flat.
          const walled = above.some((b) => stopKeys.has(b.key))
          const hiPairs = (value) =>
            above.flatMap((b) => [
              ...(stopKeys.has(b.key) ? [[stopParam(b.key), value(b, true)]] : []),
              [param(b.key), value(b, false)],
            ])

          const band = [
            decl(v.lo, chain(below.map((b) => param(b.key)), `var(${param(BASE.key)})`)),
            decl(v.loW, lookup(below.map((b) => [param(b.key), b.raw]), floor)),
            decl(
              v.hi,
              walled
                ? lookup(hiPairs((b, isStop) => (isStop ? `var(${v.lo})` : `var(${param(b.key)})`)), `var(${v.lo})`)
                : chain(above.map((b) => param(b.key)), `var(${v.lo})`),
            ),
            decl(v.hiW, lookup(hiPairs((b) => b.raw), '99999px')),
          ]

          if (i === 0) nodes.push(...band)
          else nodes.push(new AtRule({ name: query, params: `(width >= ${list[i - 1].raw})`, nodes: band }))
        }
        return nodes
      }

      const formula = ({ lo, hi, loW, hiW }, unit) =>
        'clamp(' +
          `min(var(${lo}), var(${hi})), ` +
          `calc(var(${lo}) + (var(${hi}) - var(${lo})) * ((100${unit} - var(${loW})) / (var(${hiW}) - var(${loW})))), ` +
          `max(var(${lo}), var(${hi})))`

      const vw = { lo: '--lo', hi: '--hi', loW: '--lo-w', hiW: '--hi-w' }
      const cq = { lo: '--clo', hi: '--chi', loW: '--clo-w', hiW: '--chi-w' }

      const interpolator = new AtRule({
        name: 'function',
        params: `${fn}(${[...keys.map(param), ...stops.map(stopParam), ...(cbps.length ? ['--cq'] : [])].join(', ')})`,
      })
      interpolator.append(bandsFor(bps, vw, minWidth, 'media'))

      let resultValue = formula(vw, 'vw')
      if (cbps.length) {
        // Outside any container (`100cqw` then falls back to the viewport, and
        // no container query matches) the base holds, as in Tailwind. Inside
        // one, `(width >= 0px)` always matches and the real bands take over.
        interpolator.append([
          decl(cq.lo, `var(${param(BASE.key)})`),
          decl(cq.loW, containerMinWidth),
          decl(cq.hi, `var(${cq.lo})`),
          decl(cq.hiW, '99999px'),
          new AtRule({ name: 'container', params: '(width >= 0px)', nodes: bandsFor(cbps, cq, containerMinWidth, 'container') }),
        ])
        // Which axis an element follows: the container wherever one of its
        // container queries matches (`--cq`), as Tailwind sorts `@` variants
        // after breakpoints; else the viewport if it has viewport tokens for
        // the property; else the container if it has container tokens. With
        // both kinds, the value is right at every breakpoint but steps at the
        // container one instead of bending towards it.
        const any = (list) =>
          list
            .flatMap((b) => [param(b.key), ...(stopKeys.has(b.key) ? [stopParam(b.key)] : [])])
            .map((name) => `style(${name})`)
            .join(' or ')
        const container = formula(cq, 'cqw')
        const viewport = formula(vw, 'vw')
        resultValue =
          `if(style(--cq): ${container}; ` +
          (bps.length ? `${any(bps)}: ${viewport}; ` : '') +
          `${any(cbps)}: ${container}; else: ${viewport})`
      }
      interpolator.append(decl('result', resultValue))

      // ── One thin wrapper per token family, reading the element's tokens ───
      const wrappers = [...channels.keys()].map((channel) =>
        new AtRule({
          name: 'function',
          params: `${fn}-${channel}()`,
          nodes: [
            decl(
              'result',
              `${fn}(${[
                ...keys.map((k) => `var(${token(channel, k)})`),
                ...stops.map((k) => `var(${stop(channel, k)})`),
                ...(cbps.length ? [`var(${inContainer(channel)})`] : []),
              ].join(', ')})`,
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
      // The exception is a token-only rule that publishes one of the same
      // tokens for the same selector: the new rule has to land after it, or
      // the earlier value would win (a nested `@variant` under a condition).
      const isTokenOnly = (node) =>
        node.type === 'rule' && node.every((child) => child.prop?.startsWith('--'))
      const competes = (node, rule) =>
        rule && node.selector === rule.selector && node.some((d) => rule.some((n) => n.prop === d.prop))

      const groupFor = (ancestors, rule) => {
        let parent = supports
        for (const { name, params } of ancestors) {
          let last = parent.last
          while (last && isTokenOnly(last) && !competes(last, rule)) last = last.prev()
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
        for (const { prop, value, channel, source } of decls) {
          const own = channelsOf.get(prop)
          if (!own) continue
          if (width !== BASE) {
            for (const other of own) if (other !== channel) tokens.push(decl(stop(other, width.key), '1', source))
          }
          if (own.includes(channel)) {
            const published = channel === prop && ZERO.test(value) ? '0px' : value
            tokens.push(decl(token(channel, width.key), published, source))
            if (width.axis === 'cq') values.push(decl(inContainer(channel), '1', source))
            values.push(decl(prop, `${fn}-${channel}()`, source))
          } else {
            values.push(decl(prop, value, source))
          }
        }

        if (tokens.length && width !== BASE) {
          const published = new Rule({ selector, nodes: tokens, source })
          groupFor(conditions, published).append(published)
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
