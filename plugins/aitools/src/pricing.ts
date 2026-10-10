// API list prices in $ per million tokens, as of 2026-09-25.
// Cache writes are 1.25x input for the 5-minute TTL and 2x input for the 1-hour TTL.

export type Rates = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number }

export type TokenUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

function rates(input: number, output: number, cacheRead: number): Rates {
  return { input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead }
}

const FABLE_5_1 = rates(10, 50, 0.25)
const FABLE_5 = rates(10, 50, 1)
const OPUS_5_5 = rates(4, 20, 0.2)
const OPUS_5 = rates(5, 25, 0.5)
const OPUS_4_1 = rates(15, 75, 1.5)
const SONNET_5 = rates(2, 10, 0.2)
const SONNET_4 = rates(3, 15, 0.3)
const HAIKU_4_5 = rates(1, 5, 0.1)

const TABLE: Record<string, Rates> = {
  'claude-fable-5-1': FABLE_5_1,
  'claude-mythos-5-1': FABLE_5_1,
  'claude-fable-5': FABLE_5,
  'claude-mythos-5': FABLE_5,
  'claude-opus-5-5': OPUS_5_5,
  'claude-opus-5': OPUS_5,
  'claude-opus-4-8': OPUS_5,
  'claude-opus-4-7': OPUS_5,
  'claude-opus-4-6': OPUS_5,
  'claude-opus-4-5': OPUS_5,
  'claude-opus-4-1': OPUS_4_1,
  'claude-opus-4': OPUS_4_1,
  'claude-sonnet-5-5': SONNET_5,
  'claude-sonnet-5': SONNET_5,
  'claude-sonnet-4-6': SONNET_4,
  'claude-sonnet-4-5': SONNET_4,
  'claude-sonnet-4': SONNET_4,
  'claude-haiku-4-5': HAIKU_4_5,
}

const FAMILIES: [RegExp, Rates][] = [
  [/fable|mythos/, FABLE_5_1],
  [/opus/, OPUS_5_5],
  [/sonnet/, SONNET_5],
  [/haiku/, HAIKU_4_5],
]

function ratesFor(model: string): { rates: Rates | null; isEstimate: boolean } {
  const exact = TABLE[model.replace(/-\d{8}$/, '')]
  if (exact) {
    return { rates: exact, isEstimate: false }
  }
  const family = FAMILIES.find(([pattern]) => pattern.test(model))

  return { rates: family?.[1] ?? null, isEstimate: true }
}

/**
 * What a cold cache costs the next request: `tokens` of context written afresh at the 1-hour write rate, as cache-tax
 * prices it (a warm one reads them at the cache-read rate). Null for a model with no known rates.
 */
export function coldCacheUsd(model: string, tokens: number): { usd: number; isEstimate: boolean } | null {
  const { rates, isEstimate } = ratesFor(model)

  return rates === null ? null : { usd: (tokens * rates.cacheWrite1h) / 1_000_000, isEstimate }
}

export function price(model: string, usage: TokenUsage): { usd: number; isEstimate: boolean } {
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  if (input + output + cacheRead + cacheWrite === 0) {
    return { usd: 0, isEstimate: false }
  }

  const { rates, isEstimate } = ratesFor(model)
  if (!rates) {
    return { usd: 0, isEstimate: true }
  }
  const split = usage.cache_creation
  const write1h = split ? (split.ephemeral_1h_input_tokens ?? 0) : 0
  const write5m = split ? (split.ephemeral_5m_input_tokens ?? 0) : cacheWrite
  const perMillion =
    input * rates.input +
    output * rates.output +
    cacheRead * rates.cacheRead +
    write5m * rates.cacheWrite5m +
    write1h * rates.cacheWrite1h

  return { usd: perMillion / 1_000_000, isEstimate }
}
