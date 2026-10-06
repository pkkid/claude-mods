import { describe, expect, test } from 'claude-code/testing'

import { TOTEM_MAX, totemAlt, totemSvg } from '../src/totem'

/** Mini Clawds in a drawing: each has one 9 x 3 body. */
const minis = (source: string) => source.split('width="9" height="3"').length - 1

describe('totem', () => {
  test('one mini Clawd per running subagent, the stack full past TOTEM_MAX', () => {
    expect(minis(totemSvg(0))).toBe(0)
    expect(minis(totemSvg(3))).toBe(3)
    expect(minis(totemSvg(TOTEM_MAX + 3))).toBe(TOTEM_MAX)
    expect(totemSvg(TOTEM_MAX + 3)).toBe(totemSvg(TOTEM_MAX))
  })

  test('asleep with nothing running: sitting in grey, with his Zzz', () => {
    expect(totemAlt(0)).toBe('Clawd asleep')
    expect(totemSvg(0)).not.toContain('#D77757')
    expect(totemSvg(1)).toContain('#D77757')
    expect(totemSvg(0)).toContain('opacity="0"')
    expect(totemSvg(1)).not.toContain('opacity="0"')
  })

  test('the alt text counts every subagent running', () => {
    expect(totemAlt(1)).toBe('Clawd with 1 mini Clawd stacked on his head')
    expect(totemAlt(6)).toBe('Clawd with 6 mini Clawds stacked on his head')
  })

  test('the same count draws the same source, so a redraw keeps the animation going', () => {
    expect(totemSvg(2)).toBe(totemSvg(2))
  })
})
