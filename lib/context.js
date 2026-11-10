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

/** Tailwind v4 (`width >= 48rem`) and v3 (`min-width: 48rem`) breakpoint queries. */
const MIN_WIDTH = /^\(\s*(?:min-width\s*:|width\s*>=)\s*([\d.]+)(rem|em|px)\s*\)$/

/** Breakpoints are ordered in pixels; media queries resolve `em` against the initial 16px. */
const UNIT_PX = { px: 1, rem: 16, em: 16 }

/** The unprefixed value: no breakpoint. */
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

module.exports = { UTILITY, MIN_WIDTH, BASE, contextOf }
