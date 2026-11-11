/**
 * Where a declaration sits in Tailwind's output: which rule, which at-rules,
 * and which of those is its breakpoint.
 */

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

/**
 * `sr-only` and `not-sr-only`, under any variant or prefix. They hide an
 * element and bring it back: `width: 1px`, `margin: -1px`, `padding: 0` are
 * one state of a switch, not a point on a scale, and `w-24 lg:sr-only` must
 * stay 6rem up to lg. Their values are fixed, like a keyword.
 */
const SWITCH = /sr-only(?::where\(.*)?$/

/** Tailwind v4 (`width >= 48rem`) and v3 (`min-width: 48rem`) breakpoint queries. */
const MIN_WIDTH = /^\(\s*(?:min-width\s*:|width\s*>=)\s*([\d.]+)(rem|em|px)\s*\)$/

/** Breakpoints are ordered in pixels; media queries resolve `em` against the initial 16px. */
const UNIT_PX = { px: 1, rem: 16, em: 16 }

/** The unprefixed value: no breakpoint. */
const BASE = { key: '0', raw: null, px: 0, axis: null }

/** The breakpoint an at-rule is on an axis (`vw` or `cq`), or null when it is something else. */
function breakpointOf(atRule, axis) {
  const match = atRule.name === (axis === 'cq' ? 'container' : 'media') && MIN_WIDTH.exec(atRule.params)
  if (!match) return null
  const [, number, unit] = match
  const raw = number + unit
  return { key: (axis === 'cq' ? 'c' : '') + raw.replace('.', '_'), raw, px: Number(number) * UNIT_PX[unit], axis }
}

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
  const widest = (axis) => {
    let width = BASE
    const found = new Set()
    for (const atRule of ancestors) {
      const breakpoint = breakpointOf(atRule, axis)
      if (!breakpoint) continue
      found.add(atRule)
      if (breakpoint.px > width.px) width = breakpoint
    }
    return { width, found }
  }
  let { width, found: breakpoints } = widest('vw')
  if (width === BASE) ({ width, found: breakpoints } = widest('cq'))

  return { rule, ancestors, width, conditions: ancestors.filter((atRule) => !breakpoints.has(atRule)) }
}

/** At-rules that only say when or where their rules apply, so a copy of a rule can sit in a copy of them. */
const WRAPPERS = new Set(['media', 'supports', 'layer', 'container', 'scope', 'starting-style'])

/**
 * Where a custom property is declared: everything around it, outermost first,
 * with the viewport breakpoints taken out, and the widest of those — BASE
 * when there is none. Rules are kept as nested as they are, since a copy has
 * to match the same elements whatever the selectors say.
 *
 * Null outside a style rule, and inside anything that is not a plain wrapper
 * (`@keyframes`, `@function`, `@property`): a copy there would redefine it.
 */
function chainOf(decl) {
  const chain = []
  let width = BASE
  let styled = false
  for (let parent = decl.parent; parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'rule') styled = true
    else if (parent.type !== 'atrule' || !WRAPPERS.has(parent.name)) return null
    const breakpoint = parent.type === 'atrule' && breakpointOf(parent, 'vw')
    if (!breakpoint) chain.unshift(parent)
    else if (breakpoint.px > width.px) width = breakpoint
  }
  return styled ? { chain, width } : null
}

module.exports = { UTILITY, SWITCH, MIN_WIDTH, BASE, contextOf, chainOf }
