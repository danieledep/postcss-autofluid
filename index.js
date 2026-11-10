/**
 * postcss-fluidify-breakpoints
 *
 * Runs after Tailwind. For every responsive utility it finds in the output —
 *
 *   @media (width >= 48rem) { .md\:mt-8 { margin-top: calc(var(--spacing) * 8) } }
 *
 * — it appends a twin that publishes the value as a breakpoint-tagged token and
 * hands the property to one shared CSS function:
 *
 *   .md\:mt-8 { --fl-margin-top-48rem: calc(var(--spacing) * 8) }
 *   @media (width >= 48rem) { .md\:mt-8 { margin-top: --fl_x1y2z-margin-top() } }
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
 *
 *   lib/options.js       defaults, opt-in groups, validation
 *   lib/values.js        what a value is: length, ratio, angle or fixed
 *   lib/context.js       where a declaration sits: rule, at-rules, breakpoint
 *   lib/interpolator.js  the shared @function
 */

const { NAME, normalize } = require('./lib/options.js')
const {
  ZERO, NUMBER_PROPS, RATIO_PROPS, PERCENT, ANGLE_PROPS, ANGLE_UNITS,
  components, themeOf, interpolable, numeric, ratio,
} = require('./lib/values.js')
const { UTILITY, MIN_WIDTH, BASE, contextOf } = require('./lib/context.js')
const { interpolator, signature } = require('./lib/interpolator.js')

function fluidify(options) {
  const { prefix, minWidth, containerMinWidth, fluidable, units, layers } = normalize(options)

  // `--tw-scale-x` names its tokens `--fl-tw-scale-x-*`.
  const slug = (name) => name.replace(/^-+/, '')
  const token = (prop, key) => `--${prefix}-${slug(prop)}-${key}`
  // A fixed value at a breakpoint publishes this instead of a value token.
  const stop = (prop, key) => `--${prefix}-${slug(prop)}-${key}-stop`
  // Set under a container query that sets a value for the property: the
  // container decides, as Tailwind's later-sorted `@` variants do.
  const inContainer = (prop) => `--${prefix}-${slug(prop)}-cq`

  return {
    postcssPlugin: NAME,

    OnceExit(root, { AtRule, Rule, Declaration, result }) {
      // Which layers to read. The default is `@layer utilities`, where
      // Tailwind v4 puts every generated utility and every `@utility` block.
      // 'auto' reads that layer when the stylesheet has one and everything
      // otherwise, which is what unlayered Tailwind v3 output needs. Null
      // reads every rule.
      let scope = layers
      if (layers === 'auto') {
        let layered = false
        root.walkAtRules('layer', (at) => {
          if (at.nodes && at.params.trim() === 'utilities') layered = true
        })
        scope = layered ? new Set(['utilities']) : null
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
      const channelOf = (prop, value, vars) => {
        if (RATIO_PROPS.has(prop)) return numeric(value, vars) || interpolable(value, vars, PERCENT) ? prop : null
        if (ANGLE_PROPS.has(prop)) return interpolable(value, vars, ANGLE_UNITS) ? prop : null
        if (interpolable(value, vars, units)) return prop
        return NUMBER_PROPS.has(prop) && numeric(value, vars) ? `${prop}-num` : null
      }

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
          ? [{ prop, value, source, vars, channel: null }]
          : split.map(([name, part]) => ({ prop: name, value: part, source, vars, channel: channelOf(name, part, vars) }))

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
        const unread = (scoped) => {
          let count = 0
          let first = null
          root.walkAtRules('media', (atRule) => {
            if (!MIN_WIDTH.test(atRule.params)) return
            atRule.walkDecls((node) => {
              if (!fluidable.has(node.prop) || (scoped && !inScope(node))) return
              const split = components(node.prop, node.value.trim())
              if (split?.some(([name, part]) => fluidable.has(name) && channelOf(name, part, varsOf(node.parent)))) {
                count++
                first ??= node
              }
            })
          })
          return { count, first }
        }
        const { count: responsive, first } = unread(true)
        // None of the named layers is in the stylesheet, yet it has responsive
        // values: almost always unlayered Tailwind v3 output under the default.
        let listed = false
        if (scope) root.walkAtRules('layer', (at) => { if (at.nodes && scope.has(at.params.trim())) listed = true })
        const outside = scope && !listed && !responsive ? unread(false) : { count: 0 }
        if (outside.count) {
          result.warn(
            `Found ${outside.count} responsive declaration(s) for fluid properties, but none inside ` +
              `@layer ${[...scope].join(', ')}, the only layer(s) this plugin reads, and the stylesheet ` +
              'has no such layer. Tailwind v3 output is unlayered: pass `layers: null` to read every rule.',
            { node: outside.first },
          )
        } else if (responsive) {
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

      const decl = (prop, value, source) => new Declaration({ prop, value, source })

      // ── The shared interpolator, named after its signature ────────────────
      const { keys, stops, params, body } = interpolator({ bps, cbps, stopKeys, minWidth, containerMinWidth, AtRule, decl })
      const shared = new AtRule({ name: 'function', params: `--${prefix}(${params.join(', ')})`, nodes: body })
      const fn = `--${prefix}_${signature(shared.toString())}`
      shared.params = `${fn}(${params.join(', ')})`
      const wrapper = (channel) => `${fn}-${slug(channel)}`

      // ── One thin wrapper per token family, reading the element's tokens ───
      const wrappers = [...channels.keys()].map((channel) =>
        new AtRule({
          name: 'function',
          params: `${wrapper(channel)}()`,
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
        params: `(top: --${prefix}())`,
        nodes: [shared, ...wrappers, ...registrations],
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
        node.type === 'rule' && node.every((child) => child.prop?.startsWith(`--${prefix}-`))
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
        for (const { prop, value, channel, source, vars } of decls) {
          const own = channelsOf.get(prop)
          if (!own) continue
          if (width !== BASE) {
            for (const other of own) if (other !== channel) tokens.push(decl(stop(other, width.key), '1', source))
          }
          if (own.includes(channel)) {
            const published = RATIO_PROPS.has(prop)
              ? ratio(value, vars)
              : channel === prop && ZERO.test(value)
                ? ANGLE_PROPS.has(prop) ? '0deg' : '0px'
                : value
            tokens.push(decl(token(channel, width.key), published, source))
            if (width.axis === 'cq') values.push(decl(inContainer(channel), '1', source))
            values.push(decl(prop, `${wrapper(channel)}()`, source))
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

fluidify.postcss = true

module.exports = fluidify
