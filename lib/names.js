/**
 * Short names for the properties the plugin makes fluid.
 *
 * A property's name is written into every token, every wrapper call, every
 * wrapper argument and every `@property`, so `margin-inline-start` costs
 * its length a few hundred times over. The names here are the ones Tailwind
 * gives the same properties (`mt`, `px`, `max-w`, `rounded-tl`), which keeps
 * a token readable next to the class that set it:
 *
 *   .mt-6 { --fl-mt-0: calc(var(--spacing) * 6); margin-top: --fl_k3x9a-mt() }
 *
 * Type is the exception: `text`, `leading` and `tracking` say less than the
 * CSS initials `fs`, `lh` and `ls`, and are longer.
 */

/** A box shorthand with its sides, axes and logical ends: `margin` → m, mt, mx, ms, mbs, … */
const box = (prop, name) => ({
  [prop]: name,
  [`${prop}-top`]: `${name}t`,
  [`${prop}-right`]: `${name}r`,
  [`${prop}-bottom`]: `${name}b`,
  [`${prop}-left`]: `${name}l`,
  [`${prop}-inline`]: `${name}x`,
  [`${prop}-block`]: `${name}y`,
  [`${prop}-inline-start`]: `${name}s`,
  [`${prop}-inline-end`]: `${name}e`,
  [`${prop}-block-start`]: `${name}bs`,
  [`${prop}-block-end`]: `${name}be`,
})

const SHORT = {
  ...box('margin', 'm'),
  ...box('padding', 'p'),
  ...box('scroll-margin', 'scroll-m'),
  ...box('scroll-padding', 'scroll-p'),
  'inset-inline': 'inset-x',
  'inset-block': 'inset-y',
  'inset-inline-start': 'inset-s',
  'inset-inline-end': 'inset-e',
  'inset-block-start': 'inset-bs',
  'inset-block-end': 'inset-be',
  'row-gap': 'gap-y',
  'column-gap': 'gap-x',
  'font-size': 'fs',
  'line-height': 'lh',
  'letter-spacing': 'ls',
  width: 'w',
  'min-width': 'min-w',
  'max-width': 'max-w',
  height: 'h',
  'min-height': 'min-h',
  'max-height': 'max-h',
  'flex-basis': 'basis',
  'border-radius': 'rounded',
  'border-top-left-radius': 'rounded-tl',
  'border-top-right-radius': 'rounded-tr',
  'border-bottom-right-radius': 'rounded-br',
  'border-bottom-left-radius': 'rounded-bl',
  'border-start-start-radius': 'rounded-ss',
  'border-start-end-radius': 'rounded-se',
  'border-end-start-radius': 'rounded-es',
  'border-end-end-radius': 'rounded-ee',
  'border-width': 'border',
  'border-top-width': 'border-t',
  'border-right-width': 'border-r',
  'border-bottom-width': 'border-b',
  'border-left-width': 'border-l',
  'border-inline-width': 'border-x',
  'border-block-width': 'border-y',
  'border-inline-start-width': 'border-s',
  'border-inline-end-width': 'border-e',
  'border-block-start-width': 'border-bs',
  'border-block-end-width': 'border-be',
  'outline-width': 'outline',
  // Tailwind's per-axis transform variables. `--tw-rotate` (Tailwind 3)
  // keeps its name, since `rotate` is a property of its own.
  '--tw-translate-x': 'translate-x',
  '--tw-translate-y': 'translate-y',
  '--tw-translate-z': 'translate-z',
  '--tw-scale-x': 'scale-x',
  '--tw-scale-y': 'scale-y',
  '--tw-scale-z': 'scale-z',
}

/** Everything else is named after itself, minus a custom property's dashes. */
const plain = (prop) => prop.replace(/^-+/, '')

/**
 * The namer for one set of fluid properties. A short name is given up when
 * a property in the set is itself called that (`properties: ['border']`
 * next to `border-width`), so two properties never share tokens.
 */
function namer(properties) {
  const taken = new Set([...properties].filter((prop) => !SHORT[prop]).map(plain))
  return (prop) => (SHORT[prop] && !taken.has(SHORT[prop]) ? SHORT[prop] : plain(prop))
}

module.exports = { SHORT, namer }
