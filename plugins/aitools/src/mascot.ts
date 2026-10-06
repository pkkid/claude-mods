/**
 * Clawd, the Claude Code mascot, drawn at the start of the bar on surfaces that draw SVG (the desktop Code tab).
 *
 * A 28 x 12 pixel grid, of which the 24 x 10 his poses use is shown, at 2 screen pixels per grid pixel (48 x 20 px).
 * Every pose is one SVG animated with SMIL; a change of pose draws the new pose's SVG with a short intro first (walking
 * over, sitting down, waking up), then its loop. Clawd is drawn on a 24-wide frame shifted right by CX, so he stands
 * centered; a posture's `x` steps him aside.
 */

import type { MascotPose, MascotState } from '../types'
import type { Row } from './checklist'

/**
 * The part of the grid shown: no pose draws in its first 3 columns or last one, and the top rows held nothing but
 * effects above his head (moved down beside him).
 */
const LEFT = 3
const TOP = 2
const W = 24
const H = 10
const CX = 2

/** CSS pixels the mascot takes in the bar. */
export const MASCOT_WIDTH = W * 2
export const MASCOT_HEIGHT = H * 2

export const O = '#D77757' // Claude orange
export const D = '#141413' // eyes
const BEZEL = '#3B3B39'
const DECK = '#9A9893'
const DECK_EDGE = '#5C5C58'
const DISPLAY = '#22384F'
const PAGE = '#F6F0E4'
const PAGE_EDGE = '#CFC4AF'
const INK = '#B3A68E'
const INK_DARK = '#6E6352'
export const ZZZ = '#8E96B8'
const SPARK = '#F2C14E'
const RED = '#E0524C'
const SWEAT = '#7CC4E8'

type Eyes = 'open' | 'half' | 'closed' | 'squint' | 'happy' | 'wide'
type Arms = 'side' | 'typeA' | 'typeB' | 'scratchA' | 'scratchB' | 'up' | 'rest' | 'waveA' | 'waveB' | 'hold'

/**
 * One frame of Clawd: body offset (y up is negative), step aside (x), legs (false while sitting, A or B mid-stride),
 * eyes (with a look offset) and arms.
 */
type Posture = { y?: number; x?: number; legs?: boolean | 'A' | 'B'; eyes: Eyes; look?: number; lookY?: number; arms: Arms }

export const rect = (x: number, y: number, w: number, h: number, c: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${extra}/>`
const dots = (pts: [number, number][], c: string) => pts.map(([x, y]) => rect(x, y, 1, 1, c)).join('')

function arms(a: Arms, ay: number): string {
  switch (a) {
    case 'side':
      return rect(5, ay, 2, 1, O) + rect(17, ay, 2, 1, O)
    // Typing: the right arm reaches down to the keyboard beside him, tapping.
    case 'typeA':
      return rect(5, ay, 2, 1, O) + dots([[17, ay], [18, ay + 1], [19, ay + 2]], O)
    case 'typeB':
      return rect(5, ay, 2, 1, O) + dots([[17, ay], [18, ay + 1], [19, ay + 1]], O)
    case 'scratchA':
      return rect(5, ay, 2, 1, O) + dots([[17, ay], [18, ay - 1], [18, ay - 2], [17, ay - 3]], O)
    case 'scratchB':
      return rect(5, ay, 2, 1, O) + dots([[17, ay], [18, ay - 1], [18, ay - 2], [17, ay - 3], [16, ay - 3]], O)
    case 'up':
      return dots([[6, ay - 1], [5, ay - 2], [5, ay - 3], [17, ay - 1], [18, ay - 2], [18, ay - 3]], O)
    case 'rest':
      return rect(6, ay + 2, 1, 1, O) + rect(17, ay + 2, 1, 1, O)
    case 'waveA':
      return rect(5, ay, 2, 1, O) + dots([[17, ay - 1], [18, ay - 2], [19, ay - 3]], O)
    case 'waveB':
      return rect(5, ay, 2, 1, O) + dots([[17, ay - 1], [18, ay - 2], [18, ay - 3], [17, ay - 3]], O)
    // Holding a sheet up beside him with the right arm.
    case 'hold':
      return rect(5, ay, 2, 1, O) + dots([[17, ay], [18, ay - 1]], O)
  }
}

function eyes(p: Posture, ey: number): string {
  const dx = p.look ?? 0
  const dy = p.lookY ?? 0
  switch (p.eyes) {
    case 'open':
      return rect(9 + dx, ey + dy, 1, 2, D) + rect(14 + dx, ey + dy, 1, 2, D)
    case 'half':
      return rect(9 + dx, ey + 1 + dy, 1, 1, D) + rect(14 + dx, ey + 1 + dy, 1, 1, D)
    case 'closed':
      return rect(8, ey + 1, 2, 1, D) + rect(14, ey + 1, 2, 1, D)
    case 'squint':
      return rect(10, ey, 1, 2, D) + rect(14, ey + 1, 2, 1, D)
    case 'happy':
      return dots([[8, ey + 1], [9, ey], [10, ey + 1], [13, ey + 1], [14, ey], [15, ey + 1]], D)
    case 'wide':
      return rect(9, ey, 2, 2, D) + rect(13, ey, 2, 2, D)
  }
}

/** Clawd in one posture: body 10 x 5, arms on the middle row, eyes 1 x 2, four legs 2 tall. */
export function figure(p: Posture): string {
  const y = p.y ?? 0
  let s = rect(7, 5 + y, 10, 5, O)
  if (p.legs !== false) {
    // Mid-stride, one pair of legs is lifted a pixel.
    s += [8, 10, 13, 15].map((x, i) => rect(x, 10 + y, 1, p.legs === (i % 2 === 0 ? 'A' : 'B') ? 1 : 2, O)).join('')
  }
  s += arms(p.arms, 7 + y) + eyes(p, 6 + y)

  return `<g transform="translate(${CX + (p.x ?? 0)} 0)">${s}</g>`
}

// ---- props: things around Clawd, each with its own loop starting at `t` ms ----

const ms = (n: number) => `${Math.round(n)}ms`

/**
 * Lines that type themselves out on a display, one after another, then clear: each row grows a pixel at a time.
 * `rows` are [x, y, width, color]; one cycle lasts `cycle` ms from `t`.
 */
function typedLines(rows: [number, number, number, string][], t: number, cycle: number): string {
  return rows
    .map(([x, y, w, c], i) => {
      const start = i * 0.17
      const values: string[] = []
      const times: string[] = []
      if (start > 0) {
        values.push('0')
        times.push('0')
      }
      for (let n = 1; n <= w; n++) {
        values.push(String(n))
        times.push((start + (n - 1) * 0.05).toFixed(3))
      }
      values.push('0')
      times.push('0.92')
      return `<rect x="${x}" y="${y}" width="0" height="1" fill="${c}"><animate attributeName="width" values="${values.join(';')}" keyTimes="${times.join(';')}" calcMode="discrete" dur="${ms(cycle)}" begin="${ms(t)}" repeatCount="indefinite"/></rect>`
    })
    .join('')
}

/** An open laptop beside him, seen from the side: keyboard deck on the ground, screen leaning back, code typing out. */
function laptop(t: number): string {
  const deck = rect(16, 10, 9, 1, DECK) + rect(16, 11, 9, 1, DECK_EDGE)
  const bezel = rect(22, 3, 5, 3, BEZEL) + rect(21, 6, 5, 4, BEZEL)
  const display = rect(23, 4, 3, 2, DISPLAY) + rect(22, 6, 3, 3, DISPLAY)
  const code = typedLines(
    [
      [23, 4, 3, '#7FB685'],
      [23, 5, 2, '#6CA0DC'],
      [22, 6, 3, '#E8B04B'],
      [22, 7, 2, '#D77757'],
      [22, 8, 3, '#7FB685'],
    ],
    t,
    2400,
  )

  return deck + bezel + display + code
}

/** A sheet of paper held up beside him, a folded corner, the line he is reading darkening as his eyes move down. */
function paper(t: number): string {
  // A 5 x 9 sheet, its top-right corner folded over, a darker edge for its thickness, three lines of text.
  const sheet =
    rect(18, 2, 4, 1, PAGE) + rect(18, 3, 5, 8, PAGE) + rect(22, 3, 1, 1, PAGE_EDGE) + rect(23, 3, 1, 8, PAGE_EDGE) + rect(19, 11, 5, 0, PAGE_EDGE)
  const lines = [4, 6, 8].map((y, i) => rect(19, y, i === 2 ? 2 : 3, 1, INK)).join('')
  const reading = `<rect x="19" y="4" width="3" height="1" fill="${INK_DARK}"><animate attributeName="y" values="4;6;8" calcMode="discrete" dur="2.4s" begin="${ms(t)}" repeatCount="indefinite"/><animate attributeName="width" values="3;3;2" calcMode="discrete" dur="2.4s" begin="${ms(t)}" repeatCount="indefinite"/></rect>`
  // Every other read-through the sheet lifts a pixel, as if he turned to the next page.
  return `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0" keyTimes="0;0.94;0.98" calcMode="discrete" dur="4.8s" begin="${ms(t)}" repeatCount="indefinite"/>${sheet}${lines}${reading}</g>`
}

/** Props drawn on Clawd's own 24-wide frame, shifted to stand where he stands. */
const centered = (svg: string) => `<g transform="translate(${CX} 0)">${svg}</g>`

const QUESTION: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 2], [1, 4]]

function question(t: number): string {
  return centered(`<g><animateTransform attributeName="transform" type="translate" values="0 0;0 1" calcMode="discrete" dur="1s" begin="${ms(t)}" repeatCount="indefinite"/>${dots(
    QUESTION.map(([x, y]) => [20 + x, 2 + y]),
    O,
  )}</g>`)
}

const Z: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1], [1, 2], [0, 3], [1, 3], [2, 3], [3, 3]]

export function zzz(t: number): string {
  return centered([0, 1, 2]
    .map(i => {
      const begin = ms(t + i * 900)
      return `<g opacity="0"><animateTransform attributeName="transform" type="translate" values="17 6;17 5;18 5;18 4;19 3;19 3;20 2" calcMode="discrete" dur="2.7s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0.9;0.9;0.8;0.6;0.4;0" calcMode="discrete" dur="2.7s" begin="${begin}" repeatCount="indefinite"/>${dots(Z, ZZZ)}</g>`
    })
    .join(''))
}

function sparkles(t: number): string {
  const plus = (x: number, y: number) => dots([[x, y - 1], [x - 1, y], [x, y], [x + 1, y], [x, y + 1]], SPARK)
  const spots: [number, number, number][] = [
    [3, 4, 0],
    [21, 4, 250],
    [20, 8, 500],
    [2, 8, 750],
  ]
  return centered(spots
    .map(
      ([x, y, d]) =>
        `<g opacity="0"><animate attributeName="opacity" values="0;1;0" calcMode="discrete" keyTimes="0;0.15;0.5" dur="1s" begin="${ms(t + d)}" repeatCount="indefinite"/>${plus(x, y)}</g>`,
    )
    .join(''))
}

function alarm(t: number): string {
  const bang = `<g><animate attributeName="opacity" values="1;0.3" calcMode="discrete" dur="0.5s" begin="${ms(t)}" repeatCount="indefinite"/>${rect(20, 2, 1, 3, RED)}${rect(20, 6, 1, 1, RED)}</g>`
  const drop = `<rect x="15" y="3" width="1" height="2" fill="${SWEAT}" opacity="0"><animate attributeName="y" values="3;3;4;4" calcMode="discrete" dur="1.2s" begin="${ms(t)}" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;1;0" calcMode="discrete" dur="1.2s" begin="${ms(t)}" repeatCount="indefinite"/></rect>`

  return centered(bang + drop)
}

// ---- poses ----

type Frames = [Posture, number][]

type Pose = {
  id: MascotPose
  /** What the drawing says, for a reader that cannot see it. */
  alt: string
  rest: Posture
  loop: Frames
  breathe?: { k: number; dur: number }
  props?: (t: number) => string
  /** How the props come and go in a transition: the laptop slides up, the rest fade. */
  propMove?: 'slide' | 'fade'
}

export const standing = (p: Partial<Posture> = {}): Posture => ({ eyes: 'open', arms: 'side', ...p })
export const sitting = (p: Partial<Posture> = {}): Posture => ({ y: 2, legs: false, eyes: 'closed', arms: 'rest', ...p })

const repeat = (frames: Frames, n: number): Frames => Array.from({ length: n }, () => frames).flat()

const POSES: Pose[] = [
  {
    id: 'idle',
    alt: 'Clawd standing',
    rest: standing(),
    loop: [
      [standing(), 2600],
      [standing({ eyes: 'half' }), 110],
      [standing(), 1500],
      [standing({ look: 1 }), 900],
      [standing(), 700],
      [standing({ look: -1 }), 900],
      [standing(), 1200],
      [standing({ eyes: 'half' }), 110],
    ],
    breathe: { k: 0.94, dur: 3400 },
  },
  {
    id: 'working',
    alt: 'Clawd typing on a laptop',
    rest: standing({ x: -4, arms: 'typeA', look: 1 }),
    loop: [
      ...repeat([[standing({ x: -4, arms: 'typeA', look: 1 }), 150], [standing({ x: -4, arms: 'typeB', look: 1 }), 150]], 5),
      [standing({ x: -4, arms: 'side', look: 1 }), 450],
      [standing({ x: -4, arms: 'side', look: 1, eyes: 'half' }), 100],
      ...repeat([[standing({ x: -4, arms: 'typeA', look: 1 }), 150], [standing({ x: -4, arms: 'typeB', look: 1 }), 150]], 4),
    ],
    breathe: { k: 0.97, dur: 1600 },
    props: laptop,
    propMove: 'slide',
  },
  {
    id: 'puzzled',
    alt: 'Clawd looking puzzled',
    rest: standing({ eyes: 'squint', arms: 'scratchA' }),
    loop: [
      ...repeat([[standing({ eyes: 'squint', arms: 'scratchA' }), 200], [standing({ eyes: 'squint', arms: 'scratchB' }), 200]], 3),
      [standing({ eyes: 'squint', arms: 'side' }), 1400],
      [standing({ eyes: 'open', look: 1, arms: 'side' }), 900],
      [standing({ eyes: 'squint', arms: 'side' }), 600],
    ],
    breathe: { k: 0.95, dur: 3000 },
    props: question,
    propMove: 'fade',
  },
  {
    id: 'sleeping',
    alt: 'Clawd asleep',
    rest: sitting(),
    loop: [[sitting(), 1000]],
    breathe: { k: 0.9, dur: 4200 },
    props: zzz,
    propMove: 'fade',
  },
  {
    id: 'celebrate',
    alt: 'Clawd celebrating',
    rest: standing({ eyes: 'happy', arms: 'up' }),
    loop: [
      [standing({ eyes: 'happy', arms: 'side' }), 220],
      [standing({ eyes: 'happy', arms: 'up', y: -1 }), 100],
      [standing({ eyes: 'happy', arms: 'up', y: -2 }), 220],
      [standing({ eyes: 'happy', arms: 'up', y: -1 }), 100],
      [standing({ eyes: 'happy', arms: 'side' }), 360],
    ],
    props: sparkles,
    propMove: 'fade',
  },
  {
    id: 'reading',
    alt: 'Clawd reading a sheet of paper',
    rest: standing({ x: -3, arms: 'hold', look: 1 }),
    loop: [
      [standing({ x: -3, arms: 'hold', look: 1 }), 1500],
      [standing({ x: -3, arms: 'hold', look: 1, eyes: 'half' }), 100],
      [standing({ x: -3, arms: 'hold', look: 1, lookY: 1 }), 800],
    ],
    breathe: { k: 0.96, dur: 2600 },
    props: paper,
    propMove: 'fade',
  },
  {
    id: 'error',
    alt: 'Clawd startled',
    rest: standing({ eyes: 'wide', arms: 'up' }),
    loop: [
      ...repeat([[standing({ eyes: 'wide', arms: 'up', x: -1 }), 70], [standing({ eyes: 'wide', arms: 'up', x: 1 }), 70]], 3),
      [standing({ eyes: 'wide', arms: 'side' }), 1500],
    ],
    props: alarm,
    propMove: 'fade',
  },
  {
    id: 'wave',
    alt: 'Clawd waving',
    rest: standing({ eyes: 'happy', arms: 'waveA' }),
    loop: [
      ...repeat([[standing({ eyes: 'happy', arms: 'waveA' }), 220], [standing({ eyes: 'happy', arms: 'waveB' }), 220]], 3),
      [standing({ eyes: 'happy', arms: 'side' }), 700],
    ],
    breathe: { k: 0.95, dur: 3000 },
  },
]

const POSE = Object.fromEntries(POSES.map(p => [p.id, p])) as Record<MascotPose, Pose>

// ---- assembling a pose, with or without a transition into it ----

/** The frames played between two poses before the target's own loop starts. */
function introFrames(from: Pose, to: Pose): Frames {
  const frames: Frames = []
  if (from.id === 'sleeping') {
    // Jolts awake and hops up.
    frames.push([sitting(), 150], [sitting({ eyes: 'wide' }), 260], [standing({ eyes: 'wide', arms: 'up', y: -1 }), 180], [standing(), 160])
  } else {
    frames.push([{ ...from.rest }, 140])
  }
  // Walks over to the laptop or paper, or back to the middle, one pixel a step.
  const fromX = from.id === 'sleeping' ? 0 : (from.rest.x ?? 0)
  const toX = to.rest.x ?? 0
  const dir = Math.sign(toX - fromX)
  for (let x = fromX + dir, i = 0; dir !== 0 && x !== toX + dir; x += dir, i++) {
    frames.push([standing({ x, look: dir, legs: i % 2 === 0 ? 'A' : 'B' }), 110])
  }
  if (to.id === 'sleeping') {
    // Eyes droop and close, then he sits down.
    frames.push([standing({ eyes: 'half' }), 450], [standing({ eyes: 'closed' }), 450], [sitting({ y: 1 }), 250])
  } else {
    frames.push([{ ...to.rest, eyes: 'half', y: 0 }, 90])
  }
  // The laptop needs time to slide in or out.
  const needs = from.propMove === 'slide' || to.propMove === 'slide' ? 450 : 0
  const total = frames.reduce((n, [, d]) => n + d, 0)
  if (total < needs) frames.push([{ ...to.rest }, needs - total])

  return frames
}

/** A frame shown once, from `start` for `dur` ms. */
const once = (p: Posture, start: number, dur: number) =>
  `<g visibility="hidden"><set attributeName="visibility" to="visible" begin="${ms(start)}" dur="${ms(dur)}"/>${figure(p)}</g>`

/** The loop's frames, each visible for its share of the cycle, starting at `t`. */
function loopFrames(frames: Frames, t: number): string {
  if (frames.length === 1) {
    return `<g visibility="hidden"><set attributeName="visibility" to="visible" begin="${ms(t)}"/>${figure(frames[0]![0])}</g>`
  }
  const cycle = frames.reduce((n, [, d]) => n + d, 0)
  let at = 0

  return frames
    .map(([p, d]) => {
      const a = at / cycle
      const b = (at + d) / cycle
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
      return `<g visibility="hidden"><animate attributeName="visibility" values="${values.join(';')}" keyTimes="${times.join(';')}" calcMode="discrete" dur="${ms(cycle)}" begin="${ms(t)}" repeatCount="indefinite"/>${figure(p)}</g>`
    })
    .join('')
}

/** Breathing: a smooth squash toward the feet, starting at `t`. */
function breathing(content: string, pose: Pose, t: number): string {
  if (!pose.breathe) return content
  const base = 10 + (pose.rest.y ?? 0)
  const k = pose.breathe.k
  const spline = '0.45 0 0.55 1;0.45 0 0.55 1'

  return `<g transform="translate(0 ${base})"><g><animateTransform attributeName="transform" type="scale" values="1 1;1 ${k};1 1" keyTimes="0;0.5;1" calcMode="spline" keySplines="${spline}" dur="${ms(pose.breathe.dur)}" begin="${ms(t)}" repeatCount="indefinite"/><g transform="translate(0 -${base})">${content}</g></g></g>`
}

/** Props coming in (over the intro) or going out, by slide or fade. */
function moveProps(content: string, move: 'slide' | 'fade', dir: 'in' | 'out', dur: number): string {
  const d = ms(dur)
  if (move === 'slide') {
    const steps = dir === 'in' ? '0 5;0 4;0 3;0 2;0 1;0 0' : '0 0;0 1;0 2;0 3;0 4;0 6'
    const vis = dir === 'out' ? `<set attributeName="visibility" to="hidden" begin="${d}"/>` : ''
    return `<g transform="translate(0 ${dir === 'in' ? 5 : 0})"><animateTransform attributeName="transform" type="translate" values="${steps}" calcMode="discrete" dur="${d}" fill="freeze"/>${vis}${content}</g>`
  }

  return `<g opacity="${dir === 'in' ? 0 : 1}"><animate attributeName="opacity" values="${dir === 'in' ? '0;0.5;1' : '1;0.5;0'}" calcMode="discrete" dur="${d}" fill="freeze"/>${content}</g>`
}

function svg(content: string, size = 1): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LEFT} ${TOP} ${W} ${H}" width="${W * size}" height="${H * size}" shape-rendering="crispEdges">${content}</svg>`
}

/** How long the intro into `to` from `from` plays, in ms; 0 with no pose before. */
export function introMs(to: MascotPose, from: MascotPose | null): number {
  return from === null || from === to ? 0 : introFrames(POSE[from], POSE[to]).reduce((n, [, d]) => n + d, 0)
}

export function mascotAlt(pose: MascotPose): string {
  return POSE[pose].alt
}

/**
 * The pose's SVG, playing the transition from `from` first. `seq` goes in a comment so each change of pose is a new
 * source: the surface then starts the animation over rather than reusing a drawing it already has.
 */
export function mascotSvg(to: MascotPose, from: MascotPose | null, seq: number): string {
  return render(POSE[to], from === null ? undefined : POSE[from]).replace('</svg>', `<!--${seq}--></svg>`)
}

/** A pose's SVG; given `from`, it first plays the transition out of that pose. */
function render(to: Pose, from?: Pose): string {
  if (!from || from.id === to.id) {
    return svg(breathing(loopFrames(to.loop, 0), to, 0) + (to.props?.(0) ?? ''))
  }
  const intro = introFrames(from, to)
  const t = intro.reduce((n, [, d]) => n + d, 0)
  let at = 0
  const introSvg = intro
    .map(([p, d]) => {
      const s = once(p, at, d)
      at += d
      return s
    })
    .join('')
  const out = from.props ? moveProps(from.props(0), from.propMove ?? 'fade', 'out', t) : ''
  const into = to.props ? moveProps(to.props(t), to.propMove ?? 'fade', 'in', t) : ''

  return svg(introSvg + breathing(loopFrames(to.loop, t), to, t) + out + into)
}

/** Before anything happens in a session: standing, no pose changed yet. */
export const MASCOT_START: MascotState = { pose: 'idle', rest: 'idle', from: null, change: 0, seq: 0, since: 0 }

/** The drawing for the bar: the pose's SVG (with its transition while one plays) and what it says. */
export function mascotDrawing(m: MascotState): { source: string; alt: string } {
  return { source: mascotSvg(m.pose, m.from, m.seq), alt: mascotAlt(m.pose) }
}

/** Poses that play for a moment, then give way to the pose underneath (MascotState.rest), in ms. */
export const ONE_SHOT_MS: Partial<Record<MascotPose, number>> = { celebrate: 2600, error: 2400, wave: 2600 }

/** How long Clawd stands idle before he sits down and falls asleep. */
export const SLEEP_AFTER_MS = 5 * 60_000

/** Tools that read rather than change things: Clawd reads a sheet of paper while one runs. */
export const READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'NotebookRead'])

/** Whether a reply ends by asking the person something: its last words, past closing marks, end in a question mark. */
export function endsWithQuestion(text: string): boolean {
  return /\?[\s*_`"')\]]*$/.test(text)
}

/**
 * Whether the conversation, as the mod finds it on load, ends with a reply that asks something: the last assistant
 * text with no prompt of the person's after it.
 */
export function isQuestionOpenIn(rows: readonly Row[]): boolean {
  for (const row of [...rows].reverse()) {
    if (row.role === 'assistant' && row.text.trim()) {
      return endsWithQuestion(row.text)
    }
    if (row.role === 'user' && row.text.trim() && !row.toolResults?.length) {
      return false
    }
  }

  return false
}
