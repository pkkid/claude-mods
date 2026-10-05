import { describe, expect, test } from 'claude-code/testing'

import { MASCOT_START, endsWithQuestion, introMs, isQuestionOpenIn, mascotAlt, mascotDrawing, mascotSvg } from '../src/mascot'
import type { MascotPose } from '../types'

const POSES: MascotPose[] = ['idle', 'working', 'reading', 'puzzled', 'sleeping', 'celebrate', 'error', 'wave']

describe('mascot drawings', () => {
  test('every pose, and every transition between two, is one SVG well under the 131072-character limit', () => {
    for (const to of POSES) {
      for (const from of [null, ...POSES]) {
        const source = mascotSvg(to, from, 7)
        expect(source).toMatch(/^<svg [^>]*viewBox="3 2 24 10"[^>]*>[\s\S]*<!--7--><\/svg>$/)
        expect(source.length).toBeLessThan(131072)
      }
    }
  })

  test('a transition plays an intro first; the same pose or none plays none', () => {
    expect(introMs('working', 'idle')).toBeGreaterThan(0)
    expect(introMs('sleeping', 'idle')).toBeGreaterThan(introMs('puzzled', 'idle'))
    expect(introMs('idle', null)).toBe(0)
    expect(introMs('idle', 'idle')).toBe(0)
    expect(mascotSvg('working', 'idle', 1).length).toBeGreaterThan(mascotSvg('working', null, 1).length)
  })

  test('each pose says what Clawd is doing', () => {
    expect(POSES.map(mascotAlt)).toEqual([
      'Clawd standing',
      'Clawd typing on a laptop',
      'Clawd reading a sheet of paper',
      'Clawd looking puzzled',
      'Clawd asleep',
      'Clawd celebrating',
      'Clawd startled',
      'Clawd waving',
    ])
    expect(mascotDrawing(MASCOT_START).alt).toBe('Clawd standing')
  })
})

describe('endsWithQuestion', () => {
  test('a question mark at the end, past closing marks and space', () => {
    expect(endsWithQuestion('Done. What would you like to change?')).toBe(true)
    expect(endsWithQuestion('Want me to **commit it?**\n')).toBe(true)
  })

  test('not a question in the middle, or none at all', () => {
    expect(endsWithQuestion('Is it fast? Yes, it is.')).toBe(false)
    expect(endsWithQuestion('')).toBe(false)
  })
})

describe('isQuestionOpenIn', () => {
  const user = (text: string) => ({ role: 'user' as const, text })
  const assistant = (text: string) => ({ role: 'assistant' as const, text })

  test('the last reply asks and the person has not answered', () => {
    expect(isQuestionOpenIn([user('Help'), assistant('Which file?')])).toBe(true)
    expect(isQuestionOpenIn([user('Help'), assistant('Which file?'), { role: 'user', text: '', toolResults: [] }])).toBe(true)
  })

  test('answered, a statement, or nothing yet', () => {
    expect(isQuestionOpenIn([assistant('Which file?'), user('bar.tsx')])).toBe(false)
    expect(isQuestionOpenIn([user('Help'), assistant('Done.')])).toBe(false)
    expect(isQuestionOpenIn([])).toBe(false)
  })
})
