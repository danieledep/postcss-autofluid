/**
 * Root variables that change at a breakpoint.
 *
 *   :root { --h1: 64px }
 *   @media (width >= 48rem) { :root { --h1: 96px } }
 *   .h1 { font-size: var(--h1) }
 *
 * `var(--h1)` only ever holds one of the two values, the one for the current
 * viewport, and an interpolation needs both. So each value is published
 * again under a name of its own, without its breakpoint:
 *
 *   :root { --fl--h1-0: 64px; --fl--h1-48rem: initial }
 *   :root { --fl--h1-48rem: 96px }
 *
 * and a utility that reads the variable gets one token per breakpoint, each
 * reading the matching copy. The variable itself is never touched, so what
 * reads it anywhere else steps exactly as before.
 *
 * A copy sits where its declaration sits (same selector, same layer, same
 * order), so the cascade settles the copies the way it settles the variable.
 * A declaration holds from its breakpoint up, until a later one says
 * otherwise: it sets the copy at its own breakpoint and clears the ones
 * above. `.section { --h1: 40px }` is 40px inside it and nothing at 48rem,
 * so a heading there stays 40px, as in Tailwind. A cleared copy makes the
 * token that reads it invalid, which is how a token says nothing.
 */

const { BASE, chainOf } = require('./context.js')
const { ROOT, closing } = require('./values.js')

/** `var(--name`, up to the name. Rewriting just that keeps fallbacks and nesting as written. */
const VAR = /var\(\s*(--(?:[\w-]|\\.|[^\0-\x7f])+)/g

const refs = (value) => Array.from(value.matchAll(VAR), (match) => match[1])

const ascending = (widths) => [...widths].sort((a, b) => a.px - b.px)

/**
 * Read the stylesheet's custom properties. `theme` is the root theme at the
 * base; `copy(name, key)` names a variable's copy at a breakpoint.
 */
function variablesOf(root, theme, copy) {
  const decls = []
  root.walkDecls((node) => {
    if (!node.prop.startsWith('--')) return
    const context = chainOf(node)
    if (!context) return
    const rules = context.chain.filter((parent) => parent.type === 'rule')
    decls.push({
      node,
      name: node.prop,
      // PostCSS keeps a custom property's value as written, trailing space and all
      value: node.value.trim(),
      ...context,
      // on the root, and nowhere more specific
      onRoot: rules.length === 1 && ROOT.test(rules[0].selector.trim()),
      // …under no condition but its breakpoint
      always: context.chain.every((parent) => parent.type === 'rule' || parent.name === 'layer'),
    })
  })

  // A variable is responsive when the root gives it a value at the base and
  // then either another one under a breakpoint, or one that reads a
  // responsive variable (`--input-gap: var(--spacing-xs)`). Its breakpoints
  // are those of every declaration it has, anywhere, and of what those read.
  // A variable the root never changes is left alone wherever else it is set:
  // Tailwind's own `--tw-*` variables live on utilities and must stay live.
  const based = new Set(decls.filter((d) => d.onRoot && d.width === BASE).map((d) => d.name))
  const breakpoints = new Map()
  for (let grew = true; grew; ) {
    grew = false
    for (const { name, value, width, onRoot } of decls) {
      const read = refs(value)
        .flatMap((other) => [...(breakpoints.get(other)?.values() ?? [])])
        .filter((at) => at.px > width.px)
      let own = breakpoints.get(name)
      if (!own) {
        if (!onRoot || !based.has(name) || (width === BASE && !read.length)) continue
        breakpoints.set(name, (own = new Map()))
      }
      for (const at of [BASE, width, ...read]) {
        if (own.has(at.key)) continue
        own.set(at.key, at)
        grew = true
      }
    }
  }

  const themes = new Map()
  const used = new Set()
  const responsive = (value) => new Set(refs(value).filter((name) => breakpoints.has(name)))

  // Variables with one value everywhere: declared once, on the root, under no condition.
  const count = new Map()
  for (const { name } of decls) count.set(name, (count.get(name) ?? 0) + 1)
  const constants = new Set(decls.filter((d) => d.onRoot && d.always && count.get(d.name) === 1).map((d) => d.name))

  return {
    /** Does every variable the value reads have the same value on every element? */
    constant(value) {
      return refs(value).every((name) => constants.has(name))
    },

    /**
     * The widths a value says something at, read from `from`: `from` itself,
     * then each breakpoint above it where a variable in the value changes.
     * Empty when the value reads no responsive variable.
     */
    widthsOf(value, from) {
      const above = new Map()
      let responsive = false
      for (const name of refs(value)) {
        for (const at of breakpoints.get(name)?.values() ?? []) {
          responsive = true
          if (at.px > from.px) above.set(at.key, at)
        }
      }
      return responsive ? [from, ...ascending(above.values())] : []
    },

    /**
     * The root theme as it stands at a breakpoint, for classifying a value
     * there: each responsive variable holds its last unconditional root value
     * at or below it.
     */
    themeAt(width) {
      if (!themes.has(width.key)) {
        const at = new Map(theme)
        for (const { name, value, width: own, onRoot, always } of decls) {
          if (onRoot && always && own.px <= width.px && breakpoints.has(name)) at.set(name, value)
        }
        themes.set(width.key, at)
      }
      return themes.get(width.key)
    },

    /**
     * The value as it reads at a breakpoint: each responsive variable
     * replaced by its copy there.
     *
     * A value that reads one variable, at one of its breakpoints, reads that
     * copy alone, and is invalid wherever the copy is cleared: nothing is
     * said there. Otherwise each variable falls back through its copies
     * below, down to the base, so the value always stands: it reads a
     * variable between two of its breakpoints, or several variables that
     * need not change together.
     */
    at(value, width) {
      const alone = responsive(value).size === 1
      const edits = []
      for (const match of value.matchAll(VAR)) {
        const [text, name] = match
        const end = closing(value, match.index + 3)
        if (!breakpoints.has(name) || end === -1) continue
        used.add(name)
        const below = ascending(breakpoints.get(name).values()).filter((at) => at.px <= width.px).reverse()
        const copies = (alone && below[0].key === width.key ? below.slice(0, 1) : below).map((at) => copy(name, at.key))
        edits.push([match.index + text.length - name.length, name.length, copies.join(', var(')])
        edits.push([end, 0, ')'.repeat(copies.length - 1)])
      }
      // From the end, so the positions before each edit still hold.
      for (const [index, length, text] of edits.sort((a, b) => b[0] - a[0])) {
        value = value.slice(0, index) + text + value.slice(index + length)
      }
      return value
    },

    /**
     * The declarations to copy, in document order, each with the copies it
     * sets: its value at its own breakpoint and at each one above where a
     * variable it reads changes, and null (cleared) at the rest above. Only
     * variables some token reads are copied, and the variables those read in
     * turn.
     */
    copies() {
      // A Set visits what is added while it is walked, so this closes over aliases.
      for (const name of used) {
        for (const other of decls) {
          if (other.name === name) for (const read of responsive(other.value)) used.add(read)
        }
      }
      return decls
        .filter(({ name }) => used.has(name))
        .map(({ node, name, value, chain, width }) => {
          const says = new Set(this.widthsOf(value, width).map((at) => at.key)).add(width.key)
          return {
            node,
            chain,
            copies: ascending(breakpoints.get(name).values())
              .filter((at) => at.px >= width.px)
              .map((at) => [copy(name, at.key), says.has(at.key) ? this.at(value, at) : null]),
          }
        })
    },
  }
}

module.exports = { variablesOf }
