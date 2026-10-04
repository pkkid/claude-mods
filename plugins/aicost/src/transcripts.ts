import { price } from './pricing'
import type { TokenUsage } from './pricing'

export type ScanEntry = { name: string; kind: string; size: number; mtimeMs: number }

export type ScanIO = {
  list(dir: string): Promise<ScanEntry[]>
  /** The whole file; only called for files of at most MAX_READ bytes. */
  readBytes(path: string): Promise<Uint8Array>
  /** The file's bytes from `offset` on; rejects when no tail is available. */
  tail(path: string, offset: number): Promise<Uint8Array>
}

/** `isEstimate`: a priced row used an estimated rate. `isFailed`: the last read failed, so it is retried. */
export type FileCache = { offset: number; size: number; usd: number; isEstimate: boolean; isFailed?: boolean }

export type ScanCache = {
  month: string
  files: Record<string, FileCache>
  seenIds: string[]
  usd: number
  isEstimate: boolean
}

export const MAX_READ = 4 * 1024 * 1024

const NEWLINE = 0x0a
const decoder = new TextDecoder()

export function monthKey(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthStart(ms: number): number {
  const d = new Date(ms)

  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

type Row = { type?: string; timestamp?: string; message?: { id?: string; model?: string; usage?: TokenUsage } }

export function parseChunk(
  bytes: Uint8Array,
  month: string,
  seen: Set<string>,
): { usd: number; isEstimate: boolean; consumed: number } {
  const consumed = bytes.lastIndexOf(NEWLINE) + 1
  let usd = 0
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
    if (row.type !== 'assistant' || !message?.usage || !message.model || !message.id || seen.has(message.id)) {
      continue
    }
    if (!row.timestamp || monthKey(Date.parse(row.timestamp)) !== month) {
      continue
    }
    seen.add(message.id)
    const priced = price(message.model, message.usage)
    usd += priced.usd
    isEstimate ||= priced.isEstimate
  }

  return { usd, isEstimate, consumed }
}

async function walk(io: ScanIO, dir: string, out: (ScanEntry & { path: string })[]): Promise<void> {
  for (const entry of await io.list(dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'directory') {
      await walk(io, path, out)
    } else if (entry.kind === 'file' && entry.name.endsWith('.jsonl')) {
      out.push({ ...entry, path })
    }
  }
}

export async function scanMonth(io: ScanIO, root: string, cache: ScanCache | null, now: number): Promise<ScanCache> {
  const month = monthKey(now)
  const start = monthStart(now)
  const isCurrent = cache?.month === month
  const files: Record<string, FileCache> = isCurrent ? { ...cache.files } : {}
  const seen = new Set(isCurrent ? cache.seenIds : [])

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
      known && entry.size >= known.offset ? { ...known } : { offset: 0, size: 0, usd: 0, isEstimate: false, isFailed: false }
    try {
      const fresh =
        entry.size <= MAX_READ
          ? (await io.readBytes(entry.path)).subarray(file.offset)
          : await io.tail(entry.path, file.offset)
      const parsed = parseChunk(fresh, month, seen)
      file.usd += parsed.usd
      file.offset += parsed.consumed
      file.isEstimate ||= parsed.isEstimate
      file.isFailed = false
    } catch {
      file.isFailed = true
    }
    file.size = entry.size
    files[entry.path] = file
  }

  const all = Object.values(files)

  return {
    month,
    files,
    seenIds: [...seen],
    usd: all.reduce((sum, f) => sum + f.usd, 0),
    isEstimate: all.some(f => f.isEstimate || f.isFailed),
  }
}

export function sessionUsd(cache: ScanCache, sessionId: string): number | undefined {
  const own = Object.entries(cache.files).filter(
    ([path]) => path.endsWith(`/${sessionId}.jsonl`) || path.includes(`/${sessionId}/`),
  )

  return own.length > 0 ? own.reduce((sum, [, f]) => sum + f.usd, 0) : undefined
}
