const MIN = 60_000
const WINDOW = 60 * MIN
const MIN_SPAN = 10 * MIN

export type Sample = { t: number; pct: number }

export type BurnState = { resetsAt: string | null; samples: Sample[] }

export const EMPTY_BURN: BurnState = { resetsAt: null, samples: [] }

export function addSample(s: BurnState, t: number, pct: number, resetsAt?: string): BurnState {
  const window = resetsAt ?? null
  const samples = window === s.resetsAt ? s.samples : []
  if (samples.at(-1)?.pct === pct) {
    return { resetsAt: window, samples }
  }

  return { resetsAt: window, samples: [...samples, { t, pct }].filter(x => x.t >= t - WINDOW) }
}

/** When the 5-hour window hits 100% at the recent pace, or null when that is not before the reset. */
export function project(s: BurnState, now: number): number | null {
  const samples = s.samples.filter(x => x.t >= now - WINDOW)
  const first = samples[0]
  const last = samples.at(-1)
  if (!first || !last || samples.length < 2 || last.t - first.t < MIN_SPAN) {
    return null
  }

  const meanT = samples.reduce((sum, x) => sum + x.t, 0) / samples.length
  const meanP = samples.reduce((sum, x) => sum + x.pct, 0) / samples.length
  const covariance = samples.reduce((sum, x) => sum + (x.t - meanT) * (x.pct - meanP), 0)
  const variance = samples.reduce((sum, x) => sum + (x.t - meanT) ** 2, 0)
  const slope = covariance / variance
  if (!(slope > 0)) {
    return null
  }

  const eta = Math.round(now + (100 - last.pct) / slope)
  if (s.resetsAt && eta >= Date.parse(s.resetsAt)) {
    return null
  }

  return eta
}
