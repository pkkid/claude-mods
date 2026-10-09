/**
 * The Worktrees pane's picture on surfaces that draw SVG (the desktop Code tab): Clawd beside a tree. He snips a
 * stray branch off it with shears while the project has worktrees, sweeps up with a broom while some are being
 * removed, and naps under it, all in grey, when there are none but the main checkout.
 *
 * The totem's grid (24 x 26 pixels at 2.5 screen pixels each, 60 x 65 px): Clawd is the bar's mascot moved down DROP
 * rows to stand on the bottom one, the tree to his right.
 */

import { O, ZZZ, figure, rect, sitting, standing, zzz } from './mascot'

const LEFT = 3
const W = 24
const H = 26
const SCALE = 2.5
/** How far Clawd's frame moves down to stand on the bottom row. */
const DROP = 14

const BARK = '#8B5A3C'
const BARK_DARK = '#6B4429'
const LEAF = '#7FB685'
const LEAF_DARK = '#5E9466'
const STEEL = '#9A9893'
const GRIP = '#E0524C'
const STRAW = '#E8B04B'
const STRAW_DARK = '#C9922F'
const DUST = '#85837d'

/** Asleep, Clawd, his Zzz and the tree turn these quiet greys, so an idle pane stays calm. */
const ASLEEP = '#5C5C58'
const ASLEEP_BARK = '#4A4A47'
const ASLEEP_LEAF = '#6E6E6A'

/** CSS pixels the picture takes in the pane. */
export const PRUNER_WIDTH = W * SCALE
export const PRUNER_HEIGHT = H * SCALE

/** What Clawd is doing: snipping while there are worktrees, sweeping while some are removed, napping with none. */
export type PrunerMode = 'pruning' | 'sweeping' | 'napping'

const ms = (n: number) => `${Math.round(n)}ms`
const dots = (pts: [number, number][], c: string) => pts.map(([x, y]) => rect(x, y, 1, 1, c)).join('')
const down = (s: string) => `<g transform="translate(0 ${DROP})">${s}</g>`

/** The frames in turn, each shown for its ms, over and over. */
function cycle(frames: [string, number][]): string {
  const total = frames.reduce((n, [, d]) => n + d, 0)
  let at = 0

  return frames
    .map(([content, d]) => {
      const a = at / total
      const b = (at + d) / total
      at += d
      const values: string[] = []
      const times: string[] = []
      if (a > 0) {
        values.push('hidden')
        times.push('0')
      }
      values.push('visible')
      times.push(a.toFixed(4))
      if (b < 0.99999) {
        values.push('hidden')
        times.push(b.toFixed(4))
      }
      return `<g visibility="hidden"><animate attributeName="visibility" values="${values.join(';')}" keyTimes="${times.join(';')}" calcMode="discrete" dur="${ms(total)}" repeatCount="indefinite"/>${content}</g>`
    })
    .join('')
}

/** Clawd holding something up in his right hand, looking at it, blinking now and then. */
const holding = (x: number) =>
  cycle([
    [down(figure(standing({ x, arms: 'hold', look: 1 }))), 3260],
    [down(figure(standing({ x, arms: 'hold', look: 1, eyes: 'half' }))), 140],
  ])

/** Snipping a stray branch off the tree; a leaf drifts down on each snip. */
function pruning(): string {
  const trunk = rect(24, 11, 2, 15, BARK) + rect(25, 11, 1, 15, BARK_DARK)
  const canopy =
    rect(20, 4, 8, 6, LEAF) +
    rect(21, 3, 6, 1, LEAF) +
    rect(19, 6, 1, 3, LEAF) +
    rect(21, 10, 6, 2, LEAF) +
    dots([[22, 5], [25, 7], [21, 8], [26, 4], [23, 10]], LEAF_DARK)
  const stray = dots([[23, 17], [22, 17], [21, 16]], BARK) + rect(20, 15, 2, 1, LEAF)
  const grip = dots([[17, 20], [17, 21], [18, 21]], GRIP)
  const open = grip + dots([[18, 19], [19, 18], [20, 17], [21, 16], [19, 20], [20, 20], [21, 19], [22, 18]], STEEL)
  const shut = grip + dots([[18, 20], [19, 19], [20, 18], [21, 17], [22, 16]], STEEL)
  const snip = 1650
  const shears = cycle([[open, 500], [shut, 250], [open, snip - 750]])
  const leaf =
    `<rect x="20" y="15" width="1" height="1" fill="${LEAF}" opacity="0">` +
    `<animate attributeName="y" values="15;15;17;19;21;23;24" calcMode="discrete" dur="${ms(snip)}" repeatCount="indefinite"/>` +
    `<animate attributeName="x" values="20;20;21;20;21;20;21" calcMode="discrete" dur="${ms(snip)}" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0;1;1;1;1;1;0.5" calcMode="discrete" dur="${ms(snip)}" repeatCount="indefinite"/></rect>`

  return holding(-4) + trunk + canopy + stray + shears + leaf
}

/** The broom's handle, top to bottom, before it is moved `dx` along. */
const HANDLE: [number, number][] = [[16, 13], [16, 14], [17, 15], [17, 16], [18, 17], [18, 18], [19, 19], [19, 20], [20, 21], [20, 22]]

/** Sweeping with a broom, stepping along, dust puffing off to the right. */
function sweeping(): string {
  const broom = (dx: number) =>
    dots(HANDLE.map(([x, y]): [number, number] => [x + dx, y]), BARK) +
    rect(19 + dx, 23, 4, 1, STRAW) +
    rect(19 + dx, 24, 5, 2, STRAW) +
    dots([[20 + dx, 25], [22 + dx, 25]], STRAW_DARK)
  const puff = (x: number, y: number, begin: number) =>
    `<g opacity="0"><animate attributeName="opacity" values="0;0.9;0.5;0" calcMode="discrete" dur="1000ms" begin="${ms(begin)}" repeatCount="indefinite"/>${dots([[x, y], [x + 1, y - 1], [x + 1, y], [x + 2, y], [x + 1, y + 1]], DUST)}</g>`
  const sweep = cycle([
    [down(figure(standing({ x: -3, look: 1, legs: 'A', arms: 'hold' }))) + broom(0), 250],
    [down(figure(standing({ x: -3, look: 1, legs: 'B', arms: 'side' }))) + broom(1), 250],
  ])

  return sweep + puff(23, 23, 250) + puff(25, 20, 500)
}

/** Asleep under the tree, he and it in grey. */
function napping(): string {
  const trunk = rect(24, 9, 2, 17, ASLEEP_BARK)
  const canopy =
    rect(19, 1, 9, 7, ASLEEP_LEAF) +
    rect(20, 0, 7, 1, ASLEEP_LEAF) +
    rect(18, 3, 1, 4, ASLEEP_LEAF) +
    rect(20, 8, 7, 1, ASLEEP_LEAF) +
    dots([[20, 2], [24, 4], [26, 2], [21, 6], [25, 7]], ASLEEP)
  const asleep = (figure(sitting({ x: -3 })) + `<g transform="translate(-4 0)">${zzz(0)}</g>`)
    .replaceAll(O, ASLEEP)
    .replaceAll(ZZZ, ASLEEP)

  return trunk + canopy + down(asleep)
}

const DRAW: Record<PrunerMode, () => string> = { pruning, sweeping, napping }

const ALT: Record<PrunerMode, string> = {
  pruning: 'Clawd pruning a tree',
  sweeping: 'Clawd sweeping up',
  napping: 'Clawd asleep under a tree',
}

/** What the picture says, for a reader that cannot see it. */
export function prunerAlt(mode: PrunerMode): string {
  return ALT[mode]
}

/** Each drawing built once: the pane redraws on every refresh, and the same source keeps the animation playing. */
const drawn = new Map<PrunerMode, string>()

export function prunerSvg(mode: PrunerMode): string {
  let source = drawn.get(mode)
  if (source === undefined) {
    source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LEFT} 0 ${W} ${H}" width="${PRUNER_WIDTH}" height="${PRUNER_HEIGHT}" shape-rendering="crispEdges">${DRAW[mode]()}</svg>`
    drawn.set(mode, source)
  }

  return source
}
