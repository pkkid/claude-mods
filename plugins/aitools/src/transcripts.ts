import { price } from './pricing'
import type { TokenUsage } from './pricing'

export type ScanEntry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number }

export type ScanIO = {
  list(dir: string): Promise<ScanEntry[]>
  /** The whole file; only called for files of at most MAX_READ bytes. */
  readBytes(path: string): Promise<Uint8Array>
  /** The file's bytes from `offset` on, possibly cut short (`isTruncated`); rejects when no tail is available. */
  tail(path: string, offset: number): Promise<{ bytes: Uint8Array; isTruncated: boolean }>
}

/**
 * `isEstimate`: a priced row used an estimated rate. `isFailed`: the last read failed, so it is retried. `tokens`: every
 * token the month's responses in the file used (input, output, cache reads and writes).
 */
export type FileCache = {
  offset: number
  size: number
  usd: number
  tokens?: number
  isEstimate: boolean
  isFailed?: boolean
}

export type ScanCache = {
  /** The cache's layout; an older one is read again from scratch. */
  version?: number
  month: string
  files: Record<string, FileCache>
  seenIds: string[]
  usd: number
  isEstimate: boolean
  /** Cost per hour (key: hours since the epoch) over the last HOURS_KEPT_MS, for the weekly window's total. */
  hours?: Record<string, number>
}

export const MAX_READ = 4 * 1024 * 1024
/** Bumped when the cache gains a field older scans lack (2: hourly costs and per-file tokens). */
export const CACHE_VERSION = 2
const HOUR_MS = 60 * 60_000
/** Hourly costs are kept this far back: the 7-day weekly window, plus a day of slack. */
export const HOURS_KEPT_MS = 8 * 24 * HOUR_MS

const NEWLINE = 0x0a
const ID_KEY_LENGTH = 16
const decoder = new TextDecoder()

/** Message ids share a long constant prefix; their tail is unique enough and keeps the stored set small. */
function idKey(id: string): string {
  return id.slice(-ID_KEY_LENGTH)
}

export function monthKey(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthStart(ms: number): number {
  const d = new Date(ms)

  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

type Row = { type?: string; timestamp?: string; message?: { id?: string; model?: string; usage?: TokenUsage } }

/**
 * Prices a chunk's assistant rows once each (by message id): the month's into `usd`, and, given `hours`, any since
 * `since` into its hourly buckets, so the weekly window can reach back into last month.
 */
export function parseChunk(
  bytes: Uint8Array,
  month: string,
  seen: Set<string>,
  hours?: { since: number; usd: Record<string, number> },
): { usd: number; tokens: number; isEstimate: boolean; consumed: number } {
  const consumed = bytes.lastIndexOf(NEWLINE) + 1
  let usd = 0
  let tokens = 0
  let isEstimate = false
  for (const line of decoder.decode(bytes.subarray(0, consumed)).split('\n')) {
    if (!line) {
      continue
    }
    let row: Row
    try {
      row = JSON.parse(line) as Row
    } catch {
      continue
    }
    const message = row.message
    if (row.type !== 'assistant' || !message?.usage || !message.model || !message.id || seen.has(idKey(message.id))) {
      continue
    }
    const at = row.timestamp ? Date.parse(row.timestamp) : NaN
    const isMonth = !Number.isNaN(at) && monthKey(at) === month
    const isRecent = hours !== undefined && at >= hours.since
    if (!isMonth && !isRecent) {
      continue
    }
    seen.add(idKey(message.id))
    const priced = price(message.model, message.usage)
    if (isMonth) {
      usd += priced.usd
      tokens += usageTokens(message.usage)
      isEstimate ||= priced.isEstimate
    }
    if (isRecent) {
      const key = String(Math.floor(at / HOUR_MS))
      hours.usd[key] = (hours.usd[key] ?? 0) + priced.usd
    }
  }

  return { usd, tokens, isEstimate, consumed }
}

/** Every token a response used: input, output, and the prompt cache's reads and writes. */
export function usageTokens(usage: TokenUsage): number {
  const counts = [usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens]

  return counts.reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0)
}

async function walk(io: ScanIO, dir: string, out: (ScanEntry & { path: string })[]): Promise<void> {
  for (const entry of await io.list(dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir') {
      await walk(io, path, out)
    } else if (entry.kind === 'file' && entry.name.endsWith('.jsonl')) {
      out.push({ ...entry, path })
    }
  }
}

export async function scanMonth(io: ScanIO, root: string, cache: ScanCache | null, now: number): Promise<ScanCache> {
  const month = monthKey(now)
  // Files back to the month's start or the weekly window's, whichever is earlier; a cache without hourly costs (an
  // older one) is rebuilt so its hours are filled in.
  const since = now - HOURS_KEPT_MS
  const start = Math.min(monthStart(now), since)
  const isCurrent = cache?.month === month && cache.version === CACHE_VERSION
  const files: Record<string, FileCache> = isCurrent ? { ...cache.files } : {}
  const seen = new Set(isCurrent ? cache.seenIds : [])
  const hours = { since, usd: { ...(isCurrent ? cache.hours : {}) } }

  const entries: (ScanEntry & { path: string })[] = []
  await walk(io, root, entries)
  for (const entry of entries) {
    if (entry.mtimeMs < start) {
      continue
    }
    const known = files[entry.path]
    if (known && known.size === entry.size && !known.isFailed) {
      continue
    }
    const file: FileCache =
      known && entry.size >= known.offset
        ? { ...known }
        : { offset: 0, size: 0, usd: 0, tokens: 0, isEstimate: false, isFailed: false }
    const take = (bytes: Uint8Array): number => {
      const parsed = parseChunk(bytes, month, seen, hours)
      file.usd += parsed.usd
      file.tokens = (file.tokens ?? 0) + parsed.tokens
      file.offset += parsed.consumed
      file.isEstimate ||= parsed.isEstimate

      return parsed.consumed
    }
    try {
      if (entry.size <= MAX_READ) {
        take((await io.readBytes(entry.path)).subarray(file.offset))
      } else {
        let isMore = true
        while (isMore) {
          const { bytes, isTruncated } = await io.tail(entry.path, file.offset)
          isMore = take(bytes) > 0 && isTruncated
        }
      }
      file.isFailed = false
    } catch {
      file.isFailed = true
    }
    file.size = entry.size
    files[entry.path] = file
  }

  const all = Object.values(files)
  const oldest = Math.floor(since / HOUR_MS)

  return {
    version: CACHE_VERSION,
    month,
    files,
    seenIds: [...seen],
    usd: all.reduce((sum, f) => sum + f.usd, 0),
    isEstimate: all.some(f => f.isEstimate || f.isFailed),
    hours: Object.fromEntries(Object.entries(hours.usd).filter(([key]) => Number(key) >= oldest)),
  }
}

/** The cost of the hours from `from` on: the hour `from` falls in counts whole. */
export function usdSince(hours: Record<string, number> | undefined, from: number): number {
  const first = Math.floor(from / HOUR_MS)

  return Object.entries(hours ?? {}).reduce((sum, [key, usd]) => (Number(key) >= first ? sum + usd : sum), 0)
}

/** The session's own transcript files: its main one and its helpers' beside it. */
function sessionFiles(cache: ScanCache, sessionId: string): FileCache[] {
  return Object.entries(cache.files)
    .filter(([path]) => path.endsWith(`/${sessionId}.jsonl`) || path.includes(`/${sessionId}/`))
    .map(([, file]) => file)
}

export function sessionUsd(cache: ScanCache, sessionId: string): number | undefined {
  const own = sessionFiles(cache, sessionId)

  return own.length > 0 ? own.reduce((sum, f) => sum + f.usd, 0) : undefined
}

/** Every token this month's responses in the session used, its helpers' included; undefined without its files. */
export function sessionTokens(cache: ScanCache, sessionId: string): number | undefined {
  const own = sessionFiles(cache, sessionId)

  return own.length > 0 ? own.reduce((sum, f) => sum + (f.tokens ?? 0), 0) : undefined
}
