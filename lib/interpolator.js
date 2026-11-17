/**
 * The shared `@function` that does the math. One band per breakpoint: in each
 * band, `--lo` is the nearest token at or below the band and `--hi` the
 * nearest above; the matching widths come from `if(style())`. Later bands
 * override earlier locals. Viewport bands are `@media`; container bands are
 * `@container` and use their own locals (`--clo`, `--chi`, …).
 */

const { BASE } = require('./context.js')

/** Nest `var()` fallbacks: [a, b] + tail → var(--a, var(--b, tail)) */
const chain = (names, tail) => names.reduceRight((inner, name) => `var(${name}, ${inner})`, tail)

/** First-match lookup: if(style(--a): 1; style(--b): 2; else: tail) */
const lookup = (pairs, tail) =>
  pairs.length ? `if(${pairs.map(([name, value]) => `style(${name}): ${value}`).join('; ')}; else: ${tail})` : tail

const param = (key) => `--v${key}`
const stopParam = (key) => `--s${key}`

const formula = ({ lo, hi, loW, hiW }, unit) =>
  'clamp(' +
  `min(var(${lo}), var(${hi})), ` +
  `calc(var(${lo}) + (var(${hi}) - var(${lo})) * ((100${unit} - var(${loW})) / (var(${hiW}) - var(${loW})))), ` +
  `max(var(${lo}), var(${hi})))`

const VW = { lo: '--lo', hi: '--hi', loW: '--lo-w', hiW: '--hi-w' }
const CQ = { lo: '--clo', hi: '--chi', loW: '--clo-w', hiW: '--chi-w' }

/**
 * Build the interpolator for these breakpoints.
 * `bps` and `cbps` are the viewport and container breakpoints, sorted;
 * `stopKeys` the breakpoints where some value is a wall. Returns the
 * parameter list and the body; the caller names the function.
 */
function interpolator({ bps, cbps, stopKeys, minWidth, containerMinWidth, AtRule, decl }) {
  const keys = [BASE.key, ...bps.map((b) => b.key), ...cbps.map((b) => b.key)]
  const stops = [...bps, ...cbps].filter((b) => stopKeys.has(b.key)).map((b) => b.key)
  const params = [...keys.map(param), ...stops.map(stopParam), ...(cbps.length ? ['--cq'] : [])]

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

  const body = bandsFor(bps, VW, minWidth, 'media')

  let result = formula(VW, 'vw')
  if (cbps.length) {
    // Outside any container (`100cqw` then falls back to the viewport, and
    // no container query matches) the base holds, as in Tailwind. Inside
    // one, `(width >= 0px)` always matches and the real bands take over.
    body.push(
      decl(CQ.lo, `var(${param(BASE.key)})`),
      decl(CQ.loW, containerMinWidth),
      decl(CQ.hi, `var(${CQ.lo})`),
      decl(CQ.hiW, '99999px'),
      new AtRule({ name: 'container', params: '(width >= 0px)', nodes: bandsFor(cbps, CQ, containerMinWidth, 'container') }),
    )
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
    const container = formula(CQ, 'cqw')
    const viewport = formula(VW, 'vw')
    result =
      `if(style(--cq): ${container}; ` +
      (bps.length ? `${any(bps)}: ${viewport}; ` : '') +
      `${any(cbps)}: ${container}; else: ${viewport})`
  }
  body.push(decl('result', result))

  return { keys, stops, params, body }
}

/**
 * A short, stable name for the text of a stylesheet's functions. Custom
 * functions are global to the page, and each stylesheet builds its own from
 * the breakpoints and tokens it happens to use, so two stylesheets on one
 * page would otherwise define `--fl()` twice with different parameters and
 * the last one would answer for both. Same text, same name; different,
 * different.
 */
function signature(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(-5)
}

module.exports = { interpolator, signature }
