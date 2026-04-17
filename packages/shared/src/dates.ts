const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export function daysAgo(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - n * DAY_MS)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / HOUR_MS
}

/** Monday 00:00 UTC of the week containing `d`. */
export function startOfWeekUtc(d: Date = new Date()): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = date.getUTCDay() // 0 = Sunday … 6 = Saturday
  const diff = (day + 6) % 7 // days since Monday
  date.setUTCDate(date.getUTCDate() - diff)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

export function lastNWeeks(n: number, from: Date = new Date()): Date[] {
  const start = startOfWeekUtc(from)
  const out: Date[] = []
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(start.getTime() - i * 7 * DAY_MS))
  }
  return out
}
