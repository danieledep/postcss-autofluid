/**
 * The plugin's options: defaults, the opt-in groups, and validation. A wrong
 * option throws when the plugin is created, so a typo fails the build loudly
 * instead of quietly producing CSS that only misbehaves in Chromium.
 */

const { LENGTH_UNITS, PERCENT_UNITS, VIEWPORT_UNITS, CONTAINER_UNITS } = require('./values.js')

const NAME = 'postcss-fluidify-breakpoints'

function expand(...shorthands) {
  return shorthands.flatMap((s) =>
    s === 'inset'
      ? ['inset', 'top', 'right', 'bottom', 'left']
      : [s, `${s}-top`, `${s}-right`, `${s}-bottom`, `${s}-left`],
  )
}

/** The logical forms of a box shorthand: its two axes and their four ends. */
function logical(shorthand) {
  const axes = [`${shorthand}-inline`, `${shorthand}-block`]
  return [...axes, ...axes.flatMap((axis) => [`${axis}-start`, `${axis}-end`])]
}

/**
 * Type and spacing: the properties whose responsive values are almost always
 * a scale (`text-2xl md:text-4xl`, `mt-6 lg:mt-12`) and never a switch.
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

/**
 * Opt-in groups. Each one is a kind of responsive value that is as often a
 * switch between two states as a scale: an off-canvas drawer
 * (`-translate-x-full lg:translate-x-0`), show on desktop
 * (`opacity-0 md:opacity-100`), stack then columns (`w-full md:w-1/2`), a
 * border that appears (`border-0 md:border`). Interpolating those shows
 * in-between states plain Tailwind never does, so they step unless listed.
 */
const GROUPS = {
  percentages: { units: PERCENT_UNITS },
  'viewport-units': { units: VIEWPORT_UNITS },
  'container-units': { units: CONTAINER_UNITS },
  borders: {
    properties: [
      'border-width', ...expand('border').map((p) => `${p}-width`).slice(1),
      ...logical('border').map((p) => `${p}-width`),
      'outline-width', 'outline-offset',
    ],
  },
  transforms: {
    // Tailwind 4 and 3 set translate and scale through these, one axis each,
    // and compose them in `translate` / `scale` / `transform` at runtime.
    properties: [
      '--tw-translate-x', '--tw-translate-y', '--tw-translate-z',
      '--tw-scale-x', '--tw-scale-y', '--tw-scale-z',
      '--tw-rotate', // Tailwind 3; 4 writes `rotate` directly
      'scale', 'rotate',
    ],
  },
  opacity: { properties: ['opacity'] },
}

const KNOWN = ['prefix', 'minWidth', 'containerMinWidth', 'properties', 'exclude', 'include', 'layers']

const fail = (message) => {
  throw new Error(`${NAME}: ${message}`)
}

const describe = (value) => (typeof value === 'string' ? `'${value}'` : JSON.stringify(value) ?? String(value))

/** A list of names: one string, or an array of non-empty strings. */
function names(option, value) {
  const list = typeof value === 'string' ? [value] : value
  if (!Array.isArray(list) || !list.every((item) => typeof item === 'string' && item.trim())) {
    fail(`\`${option}\` must be a string or an array of strings, got ${describe(value)}.`)
  }
  return list.map((item) => item.trim())
}

/** A width the interpolation starts from. A bare number is pixels. */
function width(option, value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return `${value}px`
  if (typeof value === 'string' && /^\s*(?:\d+\.?\d*|\.\d+)(?:px|rem|em)\s*$/.test(value)) return value.trim()
  if (typeof value === 'string' && /^\s*0\s*$/.test(value)) return '0px'
  return fail(`\`${option}\` must be a length in px, rem or em (such as '20rem'), or a number of pixels, got ${describe(value)}.`)
}

/**
 * Check the options and fill in the defaults.
 * Returns the prefix, the two widths, the set of fluid properties, the set of
 * units that interpolate as lengths, and the layers to read (a Set, 'auto',
 * or null for every rule).
 */
function normalize(options) {
  if (options == null || options === true) options = {}
  if (typeof options !== 'object' || Array.isArray(options)) fail(`options must be an object, got ${describe(options)}.`)

  for (const key of Object.keys(options)) {
    if (KNOWN.includes(key) || options[key] === undefined) continue
    if (key === 'units') {
      fail(
        '`units` was removed. Lengths in px, rem, em and other font-relative units interpolate by default; ' +
          "opt in to the others with `include: ['percentages', 'viewport-units', 'container-units']`.",
      )
    }
    fail(`unknown option \`${key}\`. Known options: ${KNOWN.join(', ')}.`)
  }

  const { prefix = 'fl', properties, exclude = [], include = [], layers = ['utilities'] } = options

  if (typeof prefix !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(prefix)) {
    fail(`\`prefix\` must be letters, digits and dashes, starting with a letter (such as 'fl'), got ${describe(prefix)}.`)
  }

  const minWidth = width('minWidth', options.minWidth ?? '20rem')
  const containerMinWidth = options.containerMinWidth == null ? minWidth : width('containerMinWidth', options.containerMinWidth)

  const groups = names('include', include)
  const valid = [...Object.keys(GROUPS), 'all']
  for (const group of groups) {
    if (!valid.includes(group)) fail(`unknown group ${describe(group)} in \`include\`. Groups: ${valid.join(', ')}.`)
  }
  const enabled = groups.includes('all') ? Object.keys(GROUPS) : groups

  const fluidable = new Set(properties === undefined ? DEFAULT_PROPERTIES : names('properties', properties))
  const units = new Set(LENGTH_UNITS)
  for (const group of enabled) {
    for (const prop of GROUPS[group].properties ?? []) fluidable.add(prop)
    for (const unit of GROUPS[group].units ?? []) units.add(unit)
  }
  // `exclude` names properties exactly: leaving out `padding` keeps
  // `padding-top` fluid.
  for (const prop of names('exclude', exclude)) fluidable.delete(prop)

  let scope
  if (layers === null || layers === false) scope = null
  else if (layers === 'auto') scope = 'auto'
  else scope = new Set(names('layers', layers))

  return { prefix, minWidth, containerMinWidth, fluidable, units, layers: scope }
}

module.exports = { NAME, DEFAULT_PROPERTIES, GROUPS, normalize }
