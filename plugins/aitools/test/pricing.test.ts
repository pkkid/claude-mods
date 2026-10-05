import { describe, expect, test } from 'claude-code/testing'

import { price } from '../src/pricing'

const M = 1_000_000

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9)
}

describe('price', () => {
  test('opus 5.5 input', () => {
    const r = price('claude-opus-5-5', { input_tokens: M })
    expectClose(r.usd, 4)
    expect(r.isEstimate).toBe(false)
  })

  test('opus 5.5 output', () => expectClose(price('claude-opus-5-5', { output_tokens: M }).usd, 20))

  test('opus 5.5 cache read', () => expectClose(price('claude-opus-5-5', { cache_read_input_tokens: M }).usd, 0.2))

  test('cache write without split is 5m rate', () => {
    expectClose(price('claude-opus-5-5', { cache_creation_input_tokens: M }).usd, 5)
  })

  test('cache write 1h split', () => {
    const usage = { cache_creation_input_tokens: M, cache_creation: { ephemeral_1h_input_tokens: M } }
    expectClose(price('claude-opus-5-5', usage).usd, 8)
  })

  test('fable 5.1 cache read', () => expectClose(price('claude-fable-5-1', { cache_read_input_tokens: M }).usd, 0.25))

  test('date suffix stripped', () => {
    const r = price('claude-haiku-4-5-20251001', { input_tokens: M })
    expectClose(r.usd, 1)
    expect(r.isEstimate).toBe(false)
  })

  test('unknown claude family is estimate', () => {
    const r = price('claude-opus-9', { input_tokens: M })
    expectClose(r.usd, 4)
    expect(r.isEstimate).toBe(true)
  })

  test('zero-token synthetic is free', () => {
    const r = price('<synthetic>', { input_tokens: 0, output_tokens: 0 })
    expect(r.usd).toBe(0)
    expect(r.isEstimate).toBe(false)
  })

  test('synthetic with tokens is estimate', () => {
    expect(price('<synthetic>', { input_tokens: 10 }).isEstimate).toBe(true)
  })
})
