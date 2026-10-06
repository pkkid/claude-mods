/**
 * The Subagents pane's picture on surfaces that draw SVG (the desktop Code tab): Clawd with a mini Clawd stacked on
 * his head for each subagent running, asleep when none is.
 *
 * A 24 x 26 pixel grid at 2.5 screen pixels per grid pixel (60 x 65 px), a little shorter than the pane's four option
 * rows.
 * Clawd is the bar's mascot moved down DROP rows to stand on the bottom one; each mini Clawd is a 9 x 3 body on four
 * 1-pixel legs, standing on the head of the one below.
 */

import { D, O, ZZZ, figure, rect, sitting, standing, zzz } from './mascot'

const LEFT = 3
const W = 24
const H = 26
const SCALE = 2.5
/** How far Clawd's frame moves down to stand on the bottom row. */
const DROP = 14
/** The top of Clawd's body, where the stack starts. */
const HEAD = 5 + DROP
/** The left edge of a mini Clawd's body, centered over Clawd's. */
const MINI_X = 9

/** Asleep, Clawd and his Zzz turn this quiet grey, so an idle pane stays calm. */
const ASLEEP = '#5C5C58'

/** CSS pixels the picture takes in the pane. */
export const TOTEM_WIDTH = W * SCALE
export const TOTEM_HEIGHT = H * SCALE
/** Mini Clawds the stack shows at most; with more running it stays full. */
export const TOTEM_MAX = 4

const ms = (n: number) => `${Math.round(n)}ms`

/** Shown for `share` of each `dur` ms cycle from `begin`, hidden the rest. */
const blinking = (content: string, share: number, dur: number, begin: number) =>
  `<g><animate attributeName="visibility" values="visible;hidden" keyTimes="0;${share.toFixed(3)}" calcMode="discrete" dur="${ms(dur)}" begin="${ms(begin)}" repeatCount="indefinite"/>${content}</g>`

/**
 * The `k`th mini Clawd up the stack: stepping in place, blinking now and then, and (above the first) swaying a pixel
 * either way, each a little out of step with the one below.
 */
function mini(k: number): string {
  const y = HEAD - 4 * (k + 1)
  const body = rect(MINI_X, y, 9, 3, O) + rect(MINI_X - 1, y + 1, 1, 1, O) + rect(MINI_X + 9, y + 1, 1, 1, O)
  const legs = (lifted: number) =>
    [1, 3, 5, 7].map((dx, i) => (i % 2 === lifted ? '' : rect(MINI_X + dx, y + 3, 1, 1, O))).join('')
  const step = 600
  const stepping = blinking(legs(0), 0.5, step, k * 150) + blinking(legs(1), 0.5, step, k * 150 + step / 2)
  const eyes = blinking(rect(MINI_X + 2, y + 1, 1, 1, D) + rect(MINI_X + 6, y + 1, 1, 1, D), 0.95, 3000 + k * 700, k * 400)
  const sway =
    k === 0
      ? ''
      : `<animateTransform attributeName="transform" type="translate" values="0 0;1 0;0 0;-1 0" calcMode="discrete" dur="1600ms" begin="${ms(k * 200)}" repeatCount="indefinite"/>`

  return `<g>${sway}${body}${stepping}${eyes}</g>`
}

/** Clawd at the bottom of the stack: asleep (in grey) with no subagent running, else standing and blinking. */
function base(running: number): string {
  if (running === 0) {
    const asleep = (figure(sitting()) + zzz(0)).replaceAll(O, ASLEEP).replaceAll(ZZZ, ASLEEP)
    return `<g transform="translate(0 ${DROP})">${asleep}</g>`
  }
  const awake = blinking(figure(standing()), 0.96, 3400, 0)
  const blink = `<g visibility="hidden"><animate attributeName="visibility" values="hidden;visible" keyTimes="0;0.96" calcMode="discrete" dur="3400ms" repeatCount="indefinite"/>${figure(standing({ eyes: 'half' }))}</g>`

  return `<g transform="translate(0 ${DROP})">${awake}${blink}</g>`
}

/** What the picture says, for a reader that cannot see it. */
export function totemAlt(running: number): string {
  return running === 0 ? 'Clawd asleep' : `Clawd with ${running} mini Clawd${running === 1 ? '' : 's'} stacked on his head`
}

/**
 * The picture for `running` subagents. The source only changes with what is drawn, so the pane's redraws while the
 * count holds keep the animation playing.
 */
export function totemSvg(running: number): string {
  const n = Math.min(TOTEM_MAX, Math.max(0, running))
  let source = drawn.get(n)
  if (source === undefined) {
    source = draw(n)
    drawn.set(n, source)
  }

  return source
}

/** Each drawing built once: there are only TOTEM_MAX + 1 of them, and the pane redraws each second while one runs. */
const drawn = new Map<number, string>()

function draw(n: number): string {
  const stack = Array.from({ length: n }, (_, k) => mini(k)).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LEFT} 0 ${W} ${H}" width="${TOTEM_WIDTH}" height="${TOTEM_HEIGHT}" shape-rendering="crispEdges">${base(n)}${stack}</svg>`
}
