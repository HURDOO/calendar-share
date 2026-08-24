export interface SyncWindow {
  readonly startDate: string
  readonly endDate: string
  readonly timeMin: string
  readonly timeMax: string
}

export function createSyncWindow(
  now: Date,
  timeZone = 'Asia/Seoul',
): SyncWindow {
  const today = formatDateInTimeZone(now, timeZone)
  const startDate = addMonthsClamped(today, -3)
  const endDate = addMonthsClamped(today, 3)
  const endExclusiveDate = addDays(endDate, 1)

  return {
    startDate,
    endDate,
    timeMin: zonedMidnightToInstant(startDate, timeZone).toISOString(),
    timeMax: zonedMidnightToInstant(endExclusiveDate, timeZone).toISOString(),
  }
}

function formatDateInTimeZone(value: Date, timeZone: string): string {
  const parts = dateTimeParts(value, timeZone)
  return formatDate(parts.year, parts.month, parts.day)
}

function addMonthsClamped(date: string, amount: number): string {
  const { year, month, day } = parseDate(date)
  const targetMonthStart = new Date(Date.UTC(year, month - 1 + amount, 1))
  const targetYear = targetMonthStart.getUTCFullYear()
  const targetMonth = targetMonthStart.getUTCMonth() + 1
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  return formatDate(targetYear, targetMonth, Math.min(day, lastDay))
}

export function addDays(date: string, amount: number): string {
  const { year, month, day } = parseDate(date)
  const result = new Date(Date.UTC(year, month - 1, day + amount))
  return formatDate(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    result.getUTCDate(),
  )
}

export function zonedMidnightToInstant(date: string, timeZone: string): Date {
  const { year, month, day } = parseDate(date)
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0)
  let candidate = desired

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = dateTimeParts(new Date(candidate), timeZone)
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    )
    candidate -= represented - desired
  }

  return new Date(candidate)
}

function dateTimeParts(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  })
  const values = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )

  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  }
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new Error('Date must use YYYY-MM-DD')
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

function formatDate(year: number, month: number, day: number): string {
  return [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-')
}
