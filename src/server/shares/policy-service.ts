import type { AppDatabase } from '../db/database'
import { addDays, zonedMidnightToInstant } from '../google/sync-window'

export type ShareAvailability =
  | 'AVAILABLE'
  | 'NOT_FOUND'
  | 'REVOKED'
  | 'NOT_STARTED'
  | 'EXPIRED'

interface SharePolicyRow {
  readonly id: string
  readonly name: string
  readonly calendar_scope: 'ALL' | 'SELECTED'
  readonly event_start_date: string
  readonly event_end_date: string
  readonly access_starts_at: number | null
  readonly access_ends_at: number | null
  readonly revoked_at: number | null
}

interface EventRow {
  readonly id: string
  readonly calendar_id: string
  readonly calendar_name: string
  readonly calendar_color: string | null
  readonly is_all_day: 0 | 1
  readonly starts_at: number | null
  readonly ends_at: number | null
  readonly start_date: string | null
  readonly end_date: string | null
  readonly start_time_zone: string | null
  readonly end_time_zone: string | null
  readonly visibility: 'DEFAULT' | 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL'
  readonly title: string | null
  readonly location: string | null
  readonly description: string | null
}

export interface PolicyEvent {
  readonly id: string
  readonly calendar: {
    readonly id: string
    readonly name: string
    readonly color: string | null
  }
  readonly isAllDay: boolean
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly startDate: string | null
  readonly endDate: string | null
  readonly startTimeZone: string | null
  readonly endTimeZone: string | null
  readonly title: string
  readonly location: string | null
  readonly description: string | null
  readonly isPrivate: boolean
}

export interface SharePolicyResult {
  readonly availability: ShareAvailability
  readonly share: {
    readonly id: string
    readonly name: string
    readonly eventStartDate: string
    readonly eventEndDate: string
  } | null
  readonly events: PolicyEvent[]
}

export class SharePolicyService {
  constructor(
    private readonly database: AppDatabase,
    private readonly timeZone = 'Asia/Seoul',
    private readonly now: () => Date = () => new Date(),
  ) {}

  evaluate(shareId: string): SharePolicyResult {
    const share = this.shareRow(shareId)
    if (!share) {
      return { availability: 'NOT_FOUND', share: null, events: [] }
    }

    const shareSummary = {
      id: share.id,
      name: share.name,
      eventStartDate: share.event_start_date,
      eventEndDate: share.event_end_date,
    }
    const availability = availabilityAt(share, this.now())
    if (availability !== 'AVAILABLE') {
      return { availability, share: shareSummary, events: [] }
    }

    const calendarIds = this.allowedCalendarIds(share)
    if (calendarIds.length === 0) {
      return { availability, share: shareSummary, events: [] }
    }

    const startInstant = zonedMidnightToInstant(
      share.event_start_date,
      this.timeZone,
    ).getTime()
    const endExclusiveDate = addDays(share.event_end_date, 1)
    const endInstant = zonedMidnightToInstant(endExclusiveDate, this.timeZone).getTime()
    const placeholders = calendarIds.map(() => '?').join(', ')
    const rows = this.database.sqlite
      .prepare(`
        select
          events.id, events.calendar_id, calendars.display_name as calendar_name,
          calendars.color as calendar_color, events.is_all_day, events.starts_at,
          events.ends_at, events.start_date, events.end_date,
          events.start_time_zone, events.end_time_zone, events.visibility,
          events.title, events.location, events.description
        from events
        join calendars on calendars.id = events.calendar_id
        where events.calendar_id in (${placeholders})
          and events.status <> 'CANCELLED'
          and (
            (events.is_all_day = 0 and events.ends_at > ? and events.starts_at < ?)
            or
            (events.is_all_day = 1 and events.end_date > ? and events.start_date < ?)
          )
      `)
      .all(
        ...calendarIds,
        startInstant,
        endInstant,
        share.event_start_date,
        endExclusiveDate,
      ) as EventRow[]
    const events = rows.map(toPolicyEvent)
    events.sort((left, right) => {
      const chronological =
        eventSortValue(left, this.timeZone) - eventSortValue(right, this.timeZone)
      return chronological || left.id.localeCompare(right.id)
    })
    return { availability, share: shareSummary, events }
  }

  private shareRow(shareId: string): SharePolicyRow | undefined {
    return this.database.sqlite
      .prepare(`
        select id, name, calendar_scope, event_start_date, event_end_date,
               access_starts_at, access_ends_at, revoked_at
        from share_links where id = ?
      `)
      .get(shareId) as SharePolicyRow | undefined
  }

  private allowedCalendarIds(share: SharePolicyRow): string[] {
    if (share.calendar_scope === 'ALL') {
      const rows = this.database.sqlite
        .prepare('select id from calendars where is_active = 1 order by id')
        .all() as { id: string }[]
      return rows.map((row) => row.id)
    }

    const rows = this.database.sqlite
      .prepare(`
        select calendars.id
        from share_calendars
        join calendars on calendars.id = share_calendars.calendar_id
        where share_calendars.share_id = ? and calendars.is_active = 1
        order by calendars.id
      `)
      .all(share.id) as { id: string }[]
    return rows.map((row) => row.id)
  }
}

function availabilityAt(share: SharePolicyRow, now: Date): ShareAvailability {
  const timestamp = now.getTime()
  if (share.revoked_at !== null) {
    return 'REVOKED'
  }
  if (share.access_starts_at !== null && timestamp < share.access_starts_at) {
    return 'NOT_STARTED'
  }
  if (share.access_ends_at !== null && timestamp >= share.access_ends_at) {
    return 'EXPIRED'
  }
  return 'AVAILABLE'
}

function toPolicyEvent(row: EventRow): PolicyEvent {
  const isPrivate = row.visibility === 'PRIVATE'
  return {
    id: row.id,
    calendar: {
      id: row.calendar_id,
      name: row.calendar_name,
      color: row.calendar_color,
    },
    isAllDay: row.is_all_day === 1,
    startsAt: row.starts_at === null ? null : new Date(row.starts_at).toISOString(),
    endsAt: row.ends_at === null ? null : new Date(row.ends_at).toISOString(),
    startDate: row.start_date,
    endDate: row.end_date,
    startTimeZone: row.start_time_zone,
    endTimeZone: row.end_time_zone,
    title: isPrivate ? '비공개 일정' : row.title ?? '제목 없는 일정',
    location: isPrivate ? null : row.location,
    description: isPrivate ? null : row.description,
    isPrivate,
  }
}

function eventSortValue(event: PolicyEvent, timeZone: string): number {
  if (event.startsAt) {
    return Date.parse(event.startsAt)
  }
  return event.startDate
    ? zonedMidnightToInstant(event.startDate, timeZone).getTime()
    : Number.MAX_SAFE_INTEGER
}
