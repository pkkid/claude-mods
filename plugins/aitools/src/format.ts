const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function usd(n: number, isEstimate = false): string {
  const [whole = '0', cents = '00'] = n.toFixed(2).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return `${isEstimate ? '~' : ''}$${grouped}.${cents}`
}

export function tokens(n: number): string {
  if (n < 1000) {
    return String(Math.round(n))
  }
  if (n < 1_000_000) {
    return `${Math.round(n / 1000)}k`
  }

  return `${Number((n / 1_000_000).toFixed(1))}M`
}

export function duration(ms: number): string {
  if (ms < MIN) {
    return '<1m'
  }
  if (ms < HOUR) {
    return `${Math.floor(ms / MIN)}m`
  }
  if (ms < DAY) {
    return `${Math.floor(ms / HOUR)}h${Math.floor((ms % HOUR) / MIN)}m`
  }

  return `${Math.floor(ms / DAY)}d${Math.floor((ms % DAY) / HOUR)}h`
}

export function weeklyReset(iso: string, now: number): string {
  const at = Date.parse(iso)
  const hours = (at - now) / HOUR

  return hours < 24 ? `${Math.max(1, Math.ceil(hours))}h` : (WEEKDAYS[new Date(at).getDay()] ?? '')
}

export function clockTime(ms: number): string {
  const d = new Date(ms)
  const hours = d.getHours()
  const minutes = String(d.getMinutes()).padStart(2, '0')

  return `${hours % 12 || 12}:${minutes}${hours < 12 ? 'am' : 'pm'}`
}

/** Minutes and seconds, `1:05`, or hours too once past an hour; a clock-style running time. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  const pad = (n: number) => String(n).padStart(2, '0')

  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
