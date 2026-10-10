/**
 * /keepwarm: keeps the main conversation's prompt cache from lapsing while the person is away. Shortly before the
 * cache's hour is up it sends one small request over the conversation (`$.model.fork`, which the API serves from the
 * cache, restarting its hour, and which adds nothing to the conversation), until the time asked for runs out. The
 * logic follows cache-tax (github.com/karanb192/cache-tax): a ping's readback must show the cache was read, any failure
 * stops the window with its reason, and a cache that has already lapsed is never pinged.
 */

import { CACHE_TTL } from './bar'
import { clockTime, duration, tokens, usd } from './format'
import type { KeepWarm } from '../types'

/** How long before the cache would lapse the ping is sent. */
export const KEEPWARM_LEAD_MS = 5 * 60_000
/** How long a bare /keepwarm keeps the cache warm. */
export const KEEPWARM_DEFAULT_MS = 6 * 60 * 60_000
/** The ping's one message, after the conversation as the main thread last sent it. */
export const KEEPWARM_PROMPT = 'Reply with the single word: warm'

/** What `/keepwarm <args>` asks for: keep warm for `ms`, stop, say how it stands, or say how to use it. */
export type KeepWarmArgs = { kind: 'start'; ms: number } | { kind: 'stop' } | { kind: 'status' } | { kind: 'help' }

/** `/keepwarm help`, and the reply to an argument it cannot read. */
export const KEEPWARM_HELP = [
  'Keeps the prompt cache warm while you are away: 5 minutes before its hour is up, one small request reads it again.',
  '/keepwarm             keep warm for 6 hours',
  '/keepwarm 90m         for a time of your own (also 2h30m, 10h)',
  '/keepwarm status      time left, the next ping, and what the last ping read and cost',
  '/keepwarm off         stop',
].join('\n')

/** Reads `/keepwarm`'s argument: nothing for 6 hours, `5h`, `90m`, `1h30m`, `2.5h`; `off` (or `stop`); `status`; `help`. */
export function parseKeepWarm(args: string): KeepWarmArgs | null {
  const word = args.trim().toLowerCase().replace(/\s+/g, '')
  if (word === '') {
    return { kind: 'start', ms: KEEPWARM_DEFAULT_MS }
  }
  if (word === 'off' || word === 'stop') {
    return { kind: 'stop' }
  }
  if (word === 'status') {
    return { kind: 'status' }
  }
  if (word === 'help') {
    return { kind: 'help' }
  }
  const match = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?$/.exec(word)
  if (match === null || (match[1] === undefined && match[2] === undefined)) {
    return null
  }
  const ms = Number(match[1] ?? 0) * 60 * 60_000 + Number(match[2] ?? 0) * 60_000

  return ms > 0 ? { kind: 'start', ms: Math.round(ms) } : null
}

/**
 * How long until the next ping: KEEPWARM_LEAD_MS before the cache lapses. Null when there is nothing to ping: no
 * request yet, a cache that has lapsed (a ping would write it afresh at full price), or one that outlives keepwarm.
 */
export function pingDelay(now: number, cacheAt: number | null, until: number): number | null {
  if (cacheAt === null) {
    return null
  }
  const lapses = cacheAt + CACHE_TTL
  if (now >= lapses || lapses >= until) {
    return null
  }

  return Math.max(1000, lapses - KEEPWARM_LEAD_MS - now)
}

/** The token counts of a ping's reply, in the API's spelling. */
export type PingUsage = { cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** Whether a ping found the cache warm: it read the prefix, and wrote under a tenth of that (only its own message). */
export function isWarmReadback(u: PingUsage): boolean {
  return u.cache_read_input_tokens > 0 && u.cache_creation_input_tokens < 0.1 * u.cache_read_input_tokens
}

/** Why a ping that got no answer stopped keepwarm. */
export function failureText(reason: string, status?: number | null): string {
  if (reason === 'nothing-to-fork') return 'there is no conversation to warm yet'
  if (reason === 'api-error') return `the API call failed${status == null ? '' : ` (${status})`}`
  if (reason === 'aborted') return 'the ping was interrupted'

  return 'the ping returned no text'
}

/** Why a ping that answered stopped keepwarm: its readback shows the cache had already lapsed. */
export function coldPingText(u: PingUsage): string {
  return `the ping read ${tokens(u.cache_read_input_tokens)} and wrote ${tokens(u.cache_creation_input_tokens)} tokens, so the cache had already lapsed`
}

/**
 * What `/keepwarm status` says: how long is left and when it ends, when the next ping goes, and what the last one read;
 * off, why it last stopped early, if it did.
 */
export function keepWarmStatus(kw: KeepWarm | null, stopped: string | null, cacheAt: number | null, now: number): string {
  if (kw === null) {
    const why = stopped === null ? '' : ` It stopped early: ${stopped}.`
    return `Keepwarm is off.${why} /keepwarm keeps the cache warm for 6 hours, /keepwarm 90m for a time of your own.`
  }
  const delay = pingDelay(now, cacheAt, kw.until)
  const next =
    cacheAt === null ? ' Waiting for the next request.'
    : now >= cacheAt + CACHE_TTL ? ' The cache is cold now, so pings start after the next request.'
    : delay === null ? ' The cache stays warm until then without a ping.'
    : ` Next ping in ${duration(delay)}.`
  const last = kw.lastPing === null ? '' : ` Last ping read ${tokens(kw.lastPing.read)} tokens${kw.lastPing.usd === null ? '' : `, ${usd(kw.lastPing.usd, kw.lastPing.isEstimate)}`}.`

  return `Keeping the cache warm for ${duration(kw.until - now)} more, until ${clockTime(kw.until)}.${next}${last} /keepwarm off stops it.`
}
