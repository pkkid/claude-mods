import { describe, expect, test } from 'claude-code/testing'

import { MAX_READ, monthKey, monthStart, parseChunk, scanMonth, sessionUsd } from '../src/transcripts'
import type { ScanCache, ScanEntry, ScanIO } from '../src/transcripts'

const M = 1_000_000
const OPUS = 'claude-opus-5-5'
const NOW = new Date(2026, 9, 15, 12, 0).getTime()
const MONTH = '2026-10'
const THIS_MONTH = new Date(2026, 9, 10, 9, 0).toISOString()
const LAST_MONTH = new Date(2026, 8, 28, 9, 0).toISOString()
const encoder = new TextEncoder()

function row(id: string, usage: object, opts: { type?: string; ts?: string; model?: string } = {}): string {
  const { type = 'assistant', ts = THIS_MONTH, model = OPUS } = opts

  return JSON.stringify({ type, timestamp: ts, message: { id, model, usage } })
}

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9)
}

type FakeFile = { text: string; mtimeMs?: number; size?: number }

function fakeIO(files: Record<string, FakeFile>, opts: { tailFails?: boolean } = {}) {
  const calls = { readBytes: [] as string[], tail: [] as [string, number][] }
  const io: ScanIO = {
    async list(dir) {
      const entries = new Map<string, ScanEntry>()
      for (const [path, file] of Object.entries(files)) {
        if (!path.startsWith(`${dir}/`)) {
          continue
        }
        const [name = '', ...rest] = path.slice(dir.length + 1).split('/')
        entries.set(
          name,
          rest.length > 0
            ? { name, kind: 'directory', size: 0, mtimeMs: 0 }
            : { name, kind: 'file', size: file.size ?? encoder.encode(file.text).length, mtimeMs: file.mtimeMs ?? NOW },
        )
      }

      return [...entries.values()]
    },
    async readBytes(path) {
      calls.readBytes.push(path)

      return encoder.encode(files[path]?.text ?? '')
    },
    async tail(path, offset) {
      calls.tail.push([path, offset])
      if (opts.tailFails) {
        throw new Error('no tail')
      }

      return encoder.encode(files[path]?.text ?? '').subarray(offset)
    },
  }

  return { io, calls }
}

describe('monthKey', () => {
  test('local year-month', () => expect(monthKey(NOW)).toBe(MONTH))
  test('month start is local midnight on the 1st', () => {
    expect(monthStart(NOW)).toBe(new Date(2026, 9, 1).getTime())
  })
})

describe('parseChunk', () => {
  test('prices one assistant row', () => {
    const line = `${row('a', { input_tokens: M })}\n`
    const r = parseChunk(encoder.encode(line), MONTH, new Set())
    expectClose(r.usd, 4)
    expect(r.isEstimate).toBe(false)
    expect(r.consumed).toBe(encoder.encode(line).length)
  })

  test('non-assistant rows and rows without usage count nothing', () => {
    const text = [
      row('a', { input_tokens: M }, { type: 'user' }),
      JSON.stringify({ type: 'assistant', timestamp: THIS_MONTH, message: { id: 'b', model: OPUS } }),
      'not json',
      '',
    ].join('\n')
    expect(parseChunk(encoder.encode(text), MONTH, new Set()).usd).toBe(0)
  })

  test('dedupes message ids across lines and calls', () => {
    const seen = new Set<string>()
    const twice = `${row('a', { input_tokens: M })}\n${row('a', { input_tokens: M })}\n`
    expectClose(parseChunk(encoder.encode(twice), MONTH, seen).usd, 4)
    expect(parseChunk(encoder.encode(twice), MONTH, seen).usd).toBe(0)
  })

  test('stops at last newline', () => {
    const first = `${row('é', { input_tokens: M })}\n`
    const partial = row('b', { input_tokens: M }).slice(0, 20)
    const r = parseChunk(encoder.encode(first + partial), MONTH, new Set())
    expectClose(r.usd, 4)
    expect(r.consumed).toBe(encoder.encode(first).length)
    expect(r.consumed).toBeGreaterThan(first.length)
  })

  test('ignores rows outside the month', () => {
    const line = `${row('a', { input_tokens: M }, { ts: LAST_MONTH })}\n`
    expect(parseChunk(encoder.encode(line), MONTH, new Set()).usd).toBe(0)
  })
})

describe('scanMonth', () => {
  const ROOT = '/home/u/.claude/projects'

  test('scanMonth incremental', async () => {
    const path = `${ROOT}/proj/s1.jsonl`
    const files: Record<string, FakeFile> = {
      [path]: { text: `${row('a', { input_tokens: M })}\n` },
      [`${ROOT}/proj/s2.jsonl`]: { text: `${row('b', { output_tokens: M })}\n` },
    }
    const { io, calls } = fakeIO(files)
    const first = await scanMonth(io, ROOT, null, NOW)
    expectClose(first.usd, 24)

    files[path] = { text: `${files[path]?.text}${row('c', { input_tokens: M })}\n` }
    calls.readBytes.length = 0
    const second = await scanMonth(io, ROOT, first, NOW)
    expectClose(second.usd, 28)
    expect(calls.readBytes).toEqual([path])
  })

  test('skips files modified before the month', async () => {
    const { io, calls } = fakeIO({
      [`${ROOT}/p/old.jsonl`]: { text: `${row('a', { input_tokens: M })}\n`, mtimeMs: new Date(2026, 8, 20).getTime() },
    })
    const r = await scanMonth(io, ROOT, null, NOW)
    expect(r.usd).toBe(0)
    expect(calls.readBytes).toHaveLength(0)
  })

  test('new month discards cache', async () => {
    const path = `${ROOT}/p/s.jsonl`
    const text = `${row('a', { input_tokens: M })}\n`
    const stale: ScanCache = {
      month: '2026-09',
      files: { [path]: { offset: encoder.encode(text).length, size: encoder.encode(text).length, usd: 9, isEstimate: false } },
      seenIds: ['a'],
      usd: 9,
      isEstimate: false,
    }
    const { io } = fakeIO({ [path]: { text } })
    const r = await scanMonth(io, ROOT, stale, NOW)
    expect(r.month).toBe(MONTH)
    expectClose(r.usd, 4)
  })

  test('large file uses tail', async () => {
    const path = `${ROOT}/p/big.jsonl`
    const { io, calls } = fakeIO({ [path]: { text: `${row('a', { input_tokens: M })}\n`, size: MAX_READ + 1 } })
    const r = await scanMonth(io, ROOT, null, NOW)
    expect(calls.tail).toEqual([[path, 0]])
    expectClose(r.usd, 4)
  })

  test('failed tail marks the total as an estimate', async () => {
    const path = `${ROOT}/p/big.jsonl`
    const { io } = fakeIO({ [path]: { text: `${row('a', { input_tokens: M })}\n`, size: MAX_READ + 1 } }, { tailFails: true })
    const r = await scanMonth(io, ROOT, null, NOW)
    expect(r.isEstimate).toBe(true)
    expect(r.usd).toBe(0)
  })

  test('estimate from an unknown model survives a rescan', async () => {
    const path = `${ROOT}/p/s.jsonl`
    const { io, calls } = fakeIO({ [path]: { text: `${row('a', { input_tokens: M }, { model: 'claude-opus-9' })}\n` } })
    const first = await scanMonth(io, ROOT, null, NOW)
    expect(first.isEstimate).toBe(true)
    calls.readBytes.length = 0
    const second = await scanMonth(io, ROOT, first, NOW)
    expect(second.isEstimate).toBe(true)
    expect(calls.readBytes).toHaveLength(0)
  })

  test('failed tail is retried on the next scan', async () => {
    const path = `${ROOT}/p/big.jsonl`
    const files = { [path]: { text: `${row('a', { input_tokens: M })}\n`, size: MAX_READ + 1 } }
    const failing = fakeIO(files, { tailFails: true })
    const first = await scanMonth(failing.io, ROOT, null, NOW)
    const working = fakeIO(files)
    const second = await scanMonth(working.io, ROOT, first, NOW)
    expectClose(second.usd, 4)
    expect(second.isEstimate).toBe(false)
  })

  test('sessionUsd sums the session and its subagents', async () => {
    const { io } = fakeIO({
      [`${ROOT}/p/abc.jsonl`]: { text: `${row('a', { input_tokens: M })}\n` },
      [`${ROOT}/p/abc/subagents/x.jsonl`]: { text: `${row('b', { input_tokens: M })}\n` },
      [`${ROOT}/p/zzz.jsonl`]: { text: `${row('c', { input_tokens: M })}\n` },
    })
    const cache = await scanMonth(io, ROOT, null, NOW)
    expectClose(sessionUsd(cache, 'abc') ?? -1, 8)
    expect(sessionUsd(cache, 'nope')).toBeUndefined()
  })
})
