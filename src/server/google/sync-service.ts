import { randomUUID } from 'node:crypto'

import type { AppDatabase } from '../db/database'
import { GoogleConnectionService } from './connection-service'
import { createSyncWindow, type SyncWindow } from './sync-window'
import {
  type GoogleAdapter,
  GoogleApiError,
  type GoogleCalendarEntry,
  type GoogleEventEntry,
  type Page,
} from './types'

interface CalendarRow {
  readonly id: string
  readonly google_calendar_id: string
  readonly sync_token: string | null
}

interface EventSnapshot {
  readonly calendar: CalendarRow
  readonly events: NormalizedEvent[]
  readonly nextSyncToken: string
  readonly skippedEvents: SkippedEventCounts
  readonly window: SyncWindow
}

// Number of skipped events per safe reason code. Never holds event content or IDs.
export type SkippedEventCounts = Record<string, number>

export interface CalendarBatchResult {
  readonly failures: unknown[]
  readonly skippedEvents: SkippedEventCounts
  readonly syncedCount: number
}

// One Google event whose data the app cannot store. The event is skipped so the
// rest of its calendar still syncs.
export class InvalidEventError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'InvalidEventError'
  }
}

// Some calendars failed while the others in the same job were synced.
export class CalendarSyncFailures extends Error {
  constructor(readonly result: CalendarBatchResult) {
    super(`${result.failures.length} calendar sync(s) failed`)
    this.name = 'CalendarSyncFailures'
  }
}

interface NormalizedEvent {
  readonly googleEventId: string
  readonly status: 'CONFIRMED' | 'TENTATIVE'
  readonly etag: string | null
  readonly googleUpdatedAt: number | null
  readonly isAllDay: 0 | 1
  readonly startsAt: number | null
  readonly endsAt: number | null
  readonly startDate: string | null
  readonly endDate: string | null
  readonly startTimeZone: string | null
  readonly endTimeZone: string | null
  readonly recurringEventGoogleId: string | null
  readonly originalStartsAt: number | null
  readonly originalStartDate: string | null
  readonly visibility: 'DEFAULT' | 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL'
  readonly title: string | null
  readonly location: string | null
  readonly description: string | null
}

export class GoogleSyncService {
  constructor(
    private readonly database: AppDatabase,
    private readonly adapter: GoogleAdapter,
    private readonly connection: GoogleConnectionService,
    private readonly timeZone = 'Asia/Seoul',
    private readonly now: () => Date = () => new Date(),
  ) {}

  async syncCalendarList(): Promise<string[]> {
    this.prepareAdapter()
    const existingToken = this.connection.calendarListSyncToken()

    try {
      return await this.performCalendarListSync(existingToken)
    } catch (error) {
      if (existingToken && error instanceof GoogleApiError && error.status === 410) {
        return this.performCalendarListSync(null)
      }

      this.connection.markError(classifySyncError(error))
      throw error
    }
  }

  async syncCalendar(
    calendarId: string,
    forceFull = false,
  ): Promise<SkippedEventCounts> {
    this.prepareAdapter()
    const calendar = this.calendarRow(calendarId)
    const syncToken = forceFull ? null : calendar.sync_token

    try {
      if (syncToken) {
        try {
          return await this.applyIncrementalSync(calendar, syncToken)
        } catch (error) {
          if (!(error instanceof GoogleApiError) || error.status !== 410) {
            throw error
          }
        }
      }

      const snapshot = await this.fetchFullSnapshot(
        calendar,
        createSyncWindow(this.now(), this.timeZone),
      )
      this.replaceSnapshots([snapshot])
      return snapshot.skippedEvents
    } catch (error) {
      this.markCalendarError(calendar.id, classifySyncError(error))
      throw error
    }
  }

  // Syncs each calendar on its own so one failing calendar does not stop the rest.
  // Failed calendars keep their own ERROR state; the caller decides how to report them.
  async syncCalendars(calendarIds: string[]): Promise<CalendarBatchResult> {
    const failures: unknown[] = []
    const skippedEvents: SkippedEventCounts = {}
    let syncedCount = 0

    for (const calendarId of calendarIds) {
      try {
        addCounts(skippedEvents, await this.syncCalendar(calendarId))
        syncedCount += 1
      } catch (error) {
        failures.push(error)
      }
    }

    return { failures, skippedEvents, syncedCount }
  }

  // Replaces the window of every calendar that could be fetched in one transaction.
  // A calendar that fails keeps its previous snapshot and is marked ERROR.
  async replaceAllWindows(): Promise<CalendarBatchResult> {
    this.prepareAdapter()
    const window = createSyncWindow(this.now(), this.timeZone)
    const calendars = this.activeCalendarRows()
    const snapshots: EventSnapshot[] = []
    const failures: unknown[] = []
    const skippedEvents: SkippedEventCounts = {}

    for (const calendar of calendars) {
      try {
        const snapshot = await this.fetchFullSnapshot(calendar, window)
        snapshots.push(snapshot)
        addCounts(skippedEvents, snapshot.skippedEvents)
      } catch (error) {
        this.markCalendarError(calendar.id, classifySyncError(error))
        failures.push(error)
      }
    }

    this.replaceSnapshots(snapshots)
    return { failures, skippedEvents, syncedCount: snapshots.length }
  }

  activeCalendarIds(): string[] {
    return this.activeCalendarRows().map((calendar) => calendar.id)
  }

  needsWindowReplacement(): boolean {
    const expected = createSyncWindow(this.now(), this.timeZone)
    const row = this.database.sqlite
      .prepare(`
        select 1 from calendars
        where connection_id = 1 and is_active = 1
          and (
            sync_window_start_date is null
            or sync_window_end_date is null
            or sync_window_start_date <> ?
            or sync_window_end_date <> ?
          )
        limit 1
      `)
      .get(expected.startDate, expected.endDate)
    return Boolean(row)
  }

  private async performCalendarListSync(syncToken: string | null): Promise<string[]> {
    const { items, nextSyncToken } = await collectPages((pageToken) =>
      this.adapter.listCalendars({
        ...(pageToken ? { pageToken } : {}),
        ...(syncToken ? { syncToken } : {}),
      }),
    )

    if (!nextSyncToken) {
      throw new Error('GOOGLE_CALENDAR_SYNC_TOKEN_MISSING')
    }

    const now = this.now()
    const applyChanges = this.database.sqlite.transaction(() => {
      if (!syncToken) {
        this.database.sqlite
          .prepare(
            `update calendars
             set is_active = 0, deleted_at = ?, updated_at = ?
             where connection_id = 1`,
          )
          .run(now.getTime(), now.getTime())
      }

      const upsert = this.database.sqlite.prepare(`
        insert into calendars (
          id, connection_id, google_calendar_id, display_name, color, time_zone,
          is_primary, is_active, deleted_at, created_at, updated_at
        ) values (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(connection_id, google_calendar_id) do update set
          display_name = excluded.display_name,
          color = excluded.color,
          time_zone = excluded.time_zone,
          is_primary = excluded.is_primary,
          is_active = excluded.is_active,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
      `)

      for (const calendar of dedupeById(items)) {
        upsert.run(
          randomUUID(),
          calendar.id,
          calendar.summary,
          calendar.backgroundColor ?? null,
          calendar.timeZone ?? null,
          calendar.primary ? 1 : 0,
          calendar.deleted ? 0 : 1,
          calendar.deleted ? now.getTime() : null,
          now.getTime(),
          now.getTime(),
        )
      }

      this.connection.markSynced(nextSyncToken)
    })

    applyChanges()
    return this.activeCalendarIds()
  }

  private async applyIncrementalSync(
    calendar: CalendarRow,
    syncToken: string,
  ): Promise<SkippedEventCounts> {
    const { items, nextSyncToken } = await collectPages((pageToken) =>
      this.adapter.listEvents({
        calendarId: calendar.google_calendar_id,
        syncToken,
        ...(pageToken ? { pageToken } : {}),
      }),
    )

    if (!nextSyncToken) {
      throw new Error('GOOGLE_EVENT_SYNC_TOKEN_MISSING')
    }

    const changed = dedupeEvents(items)
    const { events: normalized, skippedEventIds, skippedEvents } =
      normalizeEvents(changed)
    const now = this.now()
    const applyChanges = this.database.sqlite.transaction(() => {
      const remove = this.database.sqlite.prepare(
        'delete from events where calendar_id = ? and google_event_id = ?',
      )

      for (const event of changed) {
        if (event.status?.toLowerCase() === 'cancelled') {
          remove.run(calendar.id, event.id)
        }
      }
      // A skipped change must not leave its older stored copy on screen.
      for (const eventId of skippedEventIds) {
        remove.run(calendar.id, eventId)
      }

      this.upsertEvents(calendar.id, normalized, now)
      this.markCalendarReady(calendar.id, nextSyncToken, null, now)
    })
    applyChanges()
    return skippedEvents
  }

  private async fetchFullSnapshot(
    calendar: CalendarRow,
    window: SyncWindow,
  ): Promise<EventSnapshot> {
    const { items, nextSyncToken } = await collectPages((pageToken) =>
      this.adapter.listEvents({
        calendarId: calendar.google_calendar_id,
        timeMin: window.timeMin,
        timeMax: window.timeMax,
        ...(pageToken ? { pageToken } : {}),
      }),
    )

    if (!nextSyncToken) {
      throw new Error('GOOGLE_EVENT_SYNC_TOKEN_MISSING')
    }

    const { events, skippedEvents } = normalizeEvents(dedupeEvents(items))

    return { calendar, events, nextSyncToken, skippedEvents, window }
  }

  private replaceSnapshots(snapshots: EventSnapshot[]): void {
    const now = this.now()
    const replace = this.database.sqlite.transaction(() => {
      const clearEvents = this.database.sqlite.prepare(
        'delete from events where calendar_id = ?',
      )

      for (const snapshot of snapshots) {
        clearEvents.run(snapshot.calendar.id)
        this.upsertEvents(snapshot.calendar.id, snapshot.events, now)
        this.markCalendarReady(
          snapshot.calendar.id,
          snapshot.nextSyncToken,
          snapshot.window,
          now,
        )
      }
    })
    replace()
  }

  private upsertEvents(
    calendarId: string,
    normalizedEvents: NormalizedEvent[],
    now: Date,
  ): void {
    const statement = this.database.sqlite.prepare(`
      insert into events (
        id, calendar_id, google_event_id, status, etag, google_updated_at,
        is_all_day, starts_at, ends_at, start_date, end_date,
        start_time_zone, end_time_zone, recurring_event_google_id,
        original_starts_at, original_start_date, visibility, title, location,
        description, created_at, updated_at
      ) values (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      on conflict(calendar_id, google_event_id) do update set
        status = excluded.status,
        etag = excluded.etag,
        google_updated_at = excluded.google_updated_at,
        is_all_day = excluded.is_all_day,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        start_time_zone = excluded.start_time_zone,
        end_time_zone = excluded.end_time_zone,
        recurring_event_google_id = excluded.recurring_event_google_id,
        original_starts_at = excluded.original_starts_at,
        original_start_date = excluded.original_start_date,
        visibility = excluded.visibility,
        title = excluded.title,
        location = excluded.location,
        description = excluded.description,
        updated_at = excluded.updated_at
    `)

    for (const event of normalizedEvents) {
      statement.run(
        randomUUID(),
        calendarId,
        event.googleEventId,
        event.status,
        event.etag,
        event.googleUpdatedAt,
        event.isAllDay,
        event.startsAt,
        event.endsAt,
        event.startDate,
        event.endDate,
        event.startTimeZone,
        event.endTimeZone,
        event.recurringEventGoogleId,
        event.originalStartsAt,
        event.originalStartDate,
        event.visibility,
        event.title,
        event.location,
        event.description,
        now.getTime(),
        now.getTime(),
      )
    }
  }

  private markCalendarReady(
    calendarId: string,
    syncToken: string,
    window: SyncWindow | null,
    now: Date,
  ): void {
    this.database.sqlite
      .prepare(`
        update calendars set
          sync_token = ?,
          sync_status = 'READY',
          last_synced_at = ?,
          last_sync_error_code = null,
          sync_window_start_date = coalesce(?, sync_window_start_date),
          sync_window_end_date = coalesce(?, sync_window_end_date),
          updated_at = ?
        where id = ?
      `)
      .run(
        syncToken,
        now.getTime(),
        window?.startDate ?? null,
        window?.endDate ?? null,
        now.getTime(),
        calendarId,
      )
  }

  private markCalendarError(calendarId: string, code: string): void {
    const now = this.now()
    this.database.sqlite
      .prepare(`
        update calendars set
          sync_status = 'ERROR', last_sync_error_code = ?, updated_at = ?
        where id = ?
      `)
      .run(code, now.getTime(), calendarId)
  }

  private prepareAdapter(): void {
    this.adapter.setRefreshToken(this.connection.refreshToken())
  }

  private calendarRow(calendarId: string): CalendarRow {
    const row = this.database.sqlite
      .prepare(
        `select id, google_calendar_id, sync_token
         from calendars where id = ? and is_active = 1`,
      )
      .get(calendarId) as CalendarRow | undefined

    if (!row) {
      throw new Error('CALENDAR_NOT_FOUND')
    }

    return row
  }

  private activeCalendarRows(): CalendarRow[] {
    return this.database.sqlite
      .prepare(
        `select id, google_calendar_id, sync_token
         from calendars where connection_id = 1 and is_active = 1
         order by id`,
      )
      .all() as CalendarRow[]
  }
}

async function collectPages<T>(
  load: (pageToken?: string) => Promise<Page<T>>,
): Promise<{ readonly items: T[]; readonly nextSyncToken?: string }> {
  const items: T[] = []
  const seenPageTokens = new Set<string>()
  let pageToken: string | undefined

  for (let page = 0; page < 1000; page += 1) {
    const result = await load(pageToken)
    items.push(...result.items)

    if (!result.nextPageToken) {
      return {
        items,
        ...(result.nextSyncToken ? { nextSyncToken: result.nextSyncToken } : {}),
      }
    }

    if (seenPageTokens.has(result.nextPageToken)) {
      throw new Error('GOOGLE_PAGINATION_LOOP')
    }

    seenPageTokens.add(result.nextPageToken)
    pageToken = result.nextPageToken
  }

  throw new Error('GOOGLE_PAGINATION_LIMIT')
}

function dedupeById(items: GoogleCalendarEntry[]): GoogleCalendarEntry[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function dedupeEvents(items: GoogleEventEntry[]): GoogleEventEntry[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function normalizeEvents(items: GoogleEventEntry[]): {
  readonly events: NormalizedEvent[]
  readonly skippedEventIds: string[]
  readonly skippedEvents: SkippedEventCounts
} {
  const events: NormalizedEvent[] = []
  const skippedEventIds: string[] = []
  const skippedEvents: SkippedEventCounts = {}

  for (const event of items) {
    if (event.status?.toLowerCase() === 'cancelled') {
      continue
    }
    try {
      events.push(normalizeEvent(event))
    } catch (error) {
      if (!(error instanceof InvalidEventError)) {
        throw error
      }
      skippedEventIds.push(event.id)
      addCounts(skippedEvents, { [error.code]: 1 })
    }
  }

  return { events, skippedEventIds, skippedEvents }
}

function addCounts(target: SkippedEventCounts, source: SkippedEventCounts): void {
  for (const [code, count] of Object.entries(source)) {
    target[code] = (target[code] ?? 0) + count
  }
}

function normalizeEvent(event: GoogleEventEntry): NormalizedEvent {
  const visibility = normalizeVisibility(event.visibility)
  const isPrivate = visibility === 'PRIVATE'
  const common = {
    googleEventId: event.id,
    status: event.status?.toLowerCase() === 'tentative' ? ('TENTATIVE' as const) : ('CONFIRMED' as const),
    etag: event.etag ?? null,
    googleUpdatedAt: parseOptionalInstant(event.updated),
    recurringEventGoogleId: event.recurringEventId ?? null,
    originalStartsAt: event.originalStartTime?.dateTime
      ? parseInstant(event.originalStartTime.dateTime)
      : null,
    originalStartDate: event.originalStartTime?.date ?? null,
    visibility,
    title: isPrivate ? null : event.summary?.trim() || null,
    location: isPrivate ? null : event.location?.trim() || null,
    description: isPrivate ? null : normalizePlainText(event.description),
  }

  if (event.start?.date && event.end?.date) {
    assertDate(event.start.date)
    assertDate(event.end.date)
    if (event.end.date <= event.start.date) {
      throw new InvalidEventError('GOOGLE_EVENT_DATE_RANGE_INVALID')
    }

    return {
      ...common,
      isAllDay: 1,
      startsAt: null,
      endsAt: null,
      startDate: event.start.date,
      endDate: event.end.date,
      startTimeZone: event.start.timeZone ?? null,
      endTimeZone: event.end.timeZone ?? null,
    }
  }

  if (event.start?.dateTime && event.end?.dateTime) {
    const startsAt = parseInstant(event.start.dateTime)
    const endsAt = parseInstant(event.end.dateTime)
    // Google allows zero-length events (end == start); only a reversed range is invalid.
    if (endsAt < startsAt) {
      throw new InvalidEventError('GOOGLE_EVENT_TIME_RANGE_INVALID')
    }

    return {
      ...common,
      isAllDay: 0,
      startsAt,
      endsAt,
      startDate: null,
      endDate: null,
      startTimeZone: event.start.timeZone ?? null,
      endTimeZone: event.end.timeZone ?? null,
    }
  }

  throw new InvalidEventError('GOOGLE_EVENT_TIME_MISSING')
}

function normalizeVisibility(
  visibility: string | undefined,
): NormalizedEvent['visibility'] {
  switch (visibility?.toLowerCase()) {
    case 'public':
      return 'PUBLIC'
    case 'private':
      return 'PRIVATE'
    case 'confidential':
      return 'CONFIDENTIAL'
    default:
      return 'DEFAULT'
  }
}

function parseOptionalInstant(value: string | undefined): number | null {
  return value ? parseInstant(value) : null
}

function parseInstant(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new InvalidEventError('GOOGLE_EVENT_INSTANT_INVALID')
  }
  return timestamp
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value !== new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10)) {
    throw new InvalidEventError('GOOGLE_EVENT_DATE_INVALID')
  }
}

function normalizePlainText(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const normalized = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized || null
}

function classifySyncError(error: unknown): string {
  if (error instanceof GoogleApiError) {
    return googleErrorCode(error)
  }
  return 'SYNC_INVALID_DATA'
}

// Permanent failures carry the HTTP status and Google reason so the admin
// screen shows something actionable instead of a bare GOOGLE_PERMANENT.
export function googleErrorCode(error: GoogleApiError): string {
  const base = `GOOGLE_${error.category}`
  if (error.category !== 'PERMANENT') {
    return base
  }
  return [base, error.status || null, error.reason].filter(Boolean).join('_')
}
