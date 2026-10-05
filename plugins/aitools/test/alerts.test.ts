import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_ALERTS, checkAlerts } from '../src/alerts'
import type { AlertState } from '../src/alerts'
import type { Snapshot } from '../types'

function run(snaps: Snapshot[]): string[][] {
  let state: AlertState = EMPTY_ALERTS
  return snaps.map(snap => {
    const r = checkAlerts(state, snap)
    state = r.state
    return r.alerts
  })
}

describe('checkAlerts', () => {
  test('window alert fires once per window', () => {
    const at92 = { fiveHour: { percentUsed: 92, resetsAt: 'A' } }
    expect(run([at92, at92])).toEqual([['5-hour limit at 92%'], []])
  })

  test('window alert fires again after a reset', () => {
    const a = { fiveHour: { percentUsed: 92, resetsAt: 'A' } }
    const b = { fiveHour: { percentUsed: 92, resetsAt: 'B' } }
    expect(run([a, b])).toEqual([['5-hour limit at 92%'], ['5-hour limit at 92%']])
  })

  test('weekly alert under 90 stays quiet', () => {
    expect(run([{ weekly: { percentUsed: 89.9, resetsAt: 'W' } }])).toEqual([[]])
  })

  test('weekly alert at 91', () => {
    expect(run([{ weekly: { percentUsed: 90.6, resetsAt: 'W' } }])).toEqual([['Weekly limit at 91%']])
  })

  test('context alert re-arms below 80', () => {
    const ctx = (percent: number): Snapshot => ({ context: { window: 1, percent } })
    expect(run([ctx(81), ctx(85), ctx(50), ctx(82)])).toEqual([
      ['Context 81% full: consider Handoff'],
      [],
      [],
      ['Context 82% full: consider Handoff'],
    ])
  })
})
