import type { LimitWindow, Snapshot } from '../types'

const WINDOW_ALERT = 90
const CONTEXT_ALERT = 80
const KEEP_FIRED = 10

export type AlertState = { fired: string[]; isContextArmed: boolean }

export const EMPTY_ALERTS: AlertState = { fired: [], isContextArmed: true }

export function checkAlerts(s: AlertState, snap: Snapshot): { state: AlertState; alerts: string[] } {
  const alerts: string[] = []
  const fired = [...s.fired]
  const windows: [string, string, LimitWindow | undefined][] = [
    ['five_hour', '5-hour limit', snap.fiveHour],
    ['seven_day', 'Weekly limit', snap.weekly],
  ]
  for (const [kind, label, window] of windows) {
    const key = `${kind}@${window?.resetsAt ?? ''}`
    if (window && window.percentUsed >= WINDOW_ALERT && !fired.includes(key)) {
      alerts.push(`${label} at ${Math.round(window.percentUsed)}%`)
      fired.push(key)
    }
  }

  let isContextArmed = s.isContextArmed
  const percent = snap.context?.percent
  if (percent !== undefined) {
    if (percent >= CONTEXT_ALERT && isContextArmed) {
      alerts.push(`Context ${Math.round(percent)}% full: consider Handoff`)
      isContextArmed = false
    } else if (percent < CONTEXT_ALERT) {
      isContextArmed = true
    }
  }

  return { state: { fired: fired.slice(-KEEP_FIRED), isContextArmed }, alerts }
}
