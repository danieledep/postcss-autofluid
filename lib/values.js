/**
 * What a declaration's value is: a length, a ratio, an angle, or something
 * fixed that must be kept as written. Everything here is pure string work on
 * values, with variables resolved through the stylesheet's root theme.
 */

/**
 * Lengths that measure the same thing at every viewport width: absolute and
 * font-relative units. These interpolate by default.
 */
const LENGTH_UNITS = ['px', 'rem', 'em', 'ch', 'ex', 'lh', 'rlh', 'cap', 'ic', 'rch', 'rex', 'rcap', 'ric', 'pt', 'pc', 'in', 'cm', 'mm', 'q']

/**
 * Lengths relative to something other than the font: the parent, the
 * viewport, the container. They mix with the others in `calc()`, but a value
 * written with them is usually a layout state (`w-full md:w-1/2`,
 * `-translate-x-full lg:translate-x-0`) rather than a size, so they only
 * interpolate when opted in (`include`). Otherwise they are fixed: a wall.
 */
const PERCENT_UNITS = ['%']
const VIEWPORT_UNITS = ['', 's', 'l', 'd'].flatMap((p) => ['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax'].map((u) => p + u))
const CONTAINER_UNITS = ['cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax']

/**
 * A bare zero. As a property value it is a length, but inside `calc()` it is a
 * <number>, so `calc(0 + (0px - 0) * …)` is invalid. Tailwind's optimizer turns
 * `calc(var(--spacing) * 0)` into exactly this (`top-0`, `m-0`, `inset-0`), so
 * a zero token is published as `0px`.
 */
const ZERO = /^\s*[+-]?(?:0+\.?0*|\.0+)\s*$/

/** Functions that keep a value a plain length when every argument is one. */
const MATH = /\b(?:calc|min|max|clamp)\(/gi

/** A number with an optional unit, as it appears inside a value. */
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?([a-z%]*)/gi

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
  'border-width': {
    2: ['border-block-width', 'border-inline-width'],
    3: ['border-top-width', 'border-inline-width', 'border-bottom-width'],
    4: ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  },
  ...Object.fromEntries(['inline', 'block'].map((axis) => [`border-${axis}-width`, { 2: [`border-${axis}-start-width`, `border-${axis}-end-width`] }])),
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

const SIDES = ['top', 'right', 'bottom', 'left']
const AXES = { inline: ['left', 'right'], block: ['top', 'bottom'] }
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
const BOX = /^(margin|padding|scroll-margin|scroll-padding|inset|border)(?:-(top|right|bottom|left|inline|block)(?:-(?:start|end))?)?(-width)?$/
const RADIUS = /^border-(?:(top|bottom|start|end)-(left|right|start|end)-)?radius$/

/**
 * What a property sets, as names two properties share when one overrides the
 * other: `padding` and `padding-top` both set `padding top`. A logical side
 * can be either end of its axis and a logical corner any corner, so they
 * count as all of them.
 */
function footprint(prop) {
  if (SIDES.includes(prop)) return [`inset ${prop}`]
  if (prop === 'gap') return ['gap row', 'gap column']
  let match
  if ((match = /^(row|column)-gap$/.exec(prop))) return [`gap ${match[1]}`]
  if ((match = RADIUS.exec(prop))) {
    const corner = `${match[1]}-${match[2]}`
    return (CORNERS.includes(corner) ? [corner] : CORNERS).map((c) => `radius ${c}`)
  }
  if ((match = BOX.exec(prop)) && (match[1] !== 'border' || match[3])) {
    const sides = match[2] ? AXES[match[2]] ?? [match[2]] : SIDES
    return sides.map((side) => `${match[1]}${match[3] ?? ''} ${side}`)
  }
  return [prop]
}

/** `:root`, `:host` and `html`, alone or in a list: where Tailwind and authors put theme variables. */
const ROOT = /^(?::root|:host|html)(?:\s*,\s*(?::root|:host|html))*$/

/**
 * Custom properties declared on the root, first definition wins. Tailwind v4
 * emits every theme variable a utility uses into `@layer theme` this way, so
 * `var(--spacing)` or `var(--text-xl)` can be resolved at build time. A theme
 * that redefines a variable elsewhere (`.dark { --spacing: … }`) is classified
 * by its root value; tokens still carry the `var()`, so the element's own
 * value is what renders.
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
 * Is the value, once its variables are resolved, plain arithmetic over
 * numbers that `accept` takes (given each number's unit, '' for none), with
 * at least one of them? Keywords, a top-level `/` (`4px/8px`), units `accept`
 * refuses, numbers standing in for infinity and anything unresolvable are not.
 */
function arithmetic(value, theme, accept) {
  if (KEYWORD.test(value)) return false
  const resolved = resolve(value, theme)
  if (resolved == null || slashed(resolved)) return false
  let counted = 0
  const rest = resolved
    .replace(MATH, '(')
    .replace(NUMBER, (number, unit) => {
      const verdict = accept(unit.toLowerCase())
      if (verdict === false || (verdict === true && Math.abs(parseFloat(number)) >= HUGE)) return '\0'
      if (verdict === true) counted++
      return ' '
    })
  return counted > 0 && /^[\s()+\-*/,]*$/.test(rest)
}

/**
 * Can this value take part in the interpolation as one of `units`? Only when
 * it is arithmetic over those units with at least one of them and any number
 * of plain multipliers. A bare zero always can: it is a length, or an angle.
 */
function interpolable(value, theme, units) {
  if (!KEYWORD.test(value) && ZERO.test(resolve(value, theme) ?? '')) return true
  // A unit `units` has counts; a plain multiplier is allowed; anything else fails.
  return arithmetic(value, theme, (unit) => (units.has(unit) ? true : unit ? false : null))
}

/** Is this value plain arithmetic over unitless numbers, once resolved? */
function numeric(value, theme) {
  return arithmetic(value, theme, (unit) => !unit)
}

/**
 * Properties whose unitless numbers interpolate too, on a token family of
 * their own (`--fl-line-height-num-*`). Tailwind's `text-*` utilities set
 * `line-height` to a ratio, so `text-sm md:text-lg` would otherwise step at
 * `md` while the font size glides. A number never meets a length: each kind
 * is a wall for the other, exactly like a keyword.
 */
const NUMBER_PROPS = new Set(['line-height'])

/**
 * Properties whose value is a ratio: a number, or a percentage of one.
 * Tailwind writes `opacity: 50%` and `--tw-scale-x: 150%`, and its optimizer
 * rewrites the first to `.5`, so both forms share one token family and a
 * percentage is published as the number it stands for. A length never
 * applies here, so a bare zero stays a number.
 */
const RATIO_PROPS = new Set(['opacity', 'scale', '--tw-scale-x', '--tw-scale-y', '--tw-scale-z'])
const PERCENT = new Set(['%'])

/** Properties that take an angle. Their bare zero is published as `0deg`. */
const ANGLE_PROPS = new Set(['rotate', '--tw-rotate'])
const ANGLE_UNITS = new Set(['deg', 'grad', 'rad', 'turn'])

/** A ratio token: each percentage in the value as the number it stands for. */
function ratio(value, theme) {
  const resolved = value.includes('%') || !value.includes('var(') ? value : resolve(value, theme)
  return resolved.replace(/([+-]?(?:\d+\.?\d*|\.\d+))%/g, (_, n) => String(+(parseFloat(n) / 100).toFixed(8)))
}

module.exports = {
  LENGTH_UNITS, PERCENT_UNITS, VIEWPORT_UNITS, CONTAINER_UNITS,
  ZERO, KEYWORD, NUMBER_PROPS, RATIO_PROPS, PERCENT, ANGLE_PROPS, ANGLE_UNITS,
  ROOT, parts, slashed, components, footprint, themeOf, closing, resolve, interpolable, numeric, ratio,
}
