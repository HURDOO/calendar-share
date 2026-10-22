import { afterEach, describe, expect, it, vi } from 'vitest'

import { encodeSecretMaterial } from '../../shared/secrets'
import type { AppDatabase } from '../db/database'
import { createTestDatabase } from '../db/testing'
import { GoogleConnectionService } from './connection-service'
import { GoogleSyncService } from './sync-service'
import { createFakeGoogleAdapter } from './testing/fake-google-adapter'
import { TokenCipher } from './token-cipher'
import {
  type GoogleAdapter,
  GoogleApiError,
  GOOGLE_CALENDAR_SCOPES,
  type ListEventsRequest,
} from './types'

const now = new Date('2026-08-25T03:00:00.000Z')

describe('GoogleSyncService', () => {
  const databases: AppDatabase[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close()
    }
  })

  function setup(adapter: GoogleAdapter) {
    const database = createTestDatabase()
    databases.push(database)
    const connection = new GoogleConnectionService(
      database,
      new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(15))),
      () => now,
    )
    connection.connect('fixture-refresh-token', [...GOOGLE_CALENDAR_SCOPES])
    const service = new GoogleSyncService(
      database,
      adapter,
      connection,
      'Asia/Seoul',
      () => now,
    )
    return { connection, database, service }
  }

  it('paginates the calendar list and stores only the final sync token', async () => {
    const listCalendars = vi.fn<GoogleAdapter['listCalendars']>(async (request) =>
      request.pageToken
        ? {
            items: [calendarFixture('google-calendar-2', '업무')],
            nextSyncToken: 'calendar-token-final',
          }
        : {
            items: [calendarFixture('google-calendar-1', '개인')],
            nextPageToken: 'page-2',
          },
    )
    const { connection, database, service } = setup(
      createFakeGoogleAdapter({ listCalendars }),
    )

    const calendarIds = await service.syncCalendarList()

    expect(listCalendars).toHaveBeenCalledTimes(2)
    expect(calendarIds).toHaveLength(2)
    expect(connection.calendarListSyncToken()).toBe('calendar-token-final')
    expect(
      database.sqlite
        .prepare('select count(*) as count from calendars where is_active = 1')
        .get(),
    ).toEqual({ count: 2 })
  })

  it('recovers an expired CalendarList token in the same execution', async () => {
    const requests: Array<{ syncToken?: string }> = []
    const listCalendars = vi.fn<GoogleAdapter['listCalendars']>(async (request) => {
      requests.push(request)
      if (request.syncToken) {
        throw new GoogleApiError(410, 'GONE')
      }
      return {
        items: [calendarFixture('google-calendar-recovered', '복구 캘린더')],
        nextSyncToken: 'calendar-token-recovered',
      }
    })
    const { connection, database, service } = setup(
      createFakeGoogleAdapter({ listCalendars }),
    )
    connection.markSynced('calendar-token-expired')
    seedCalendar(database, 'calendar-old', 'google-calendar-old')

    const ids = await service.syncCalendarList()

    expect(requests).toEqual([
      { syncToken: 'calendar-token-expired' },
      {},
    ])
    expect(ids).toHaveLength(1)
    expect(connection.calendarListSyncToken()).toBe('calendar-token-recovered')
    expect(
      database.sqlite
        .prepare('select is_active from calendars where id = ?')
        .get('calendar-old'),
    ).toEqual({ is_active: 0 })
  })

  it('deduplicates paginated events and masks private details before storage', async () => {
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async (request) =>
      request.pageToken
        ? {
            items: [
              timedEvent('event-1', '수정된 제목'),
              {
                ...timedEvent('event-private', '민감한 제목'),
                description: '<b>민감한 설명</b>',
                location: '민감한 장소',
                visibility: 'private',
              },
            ],
            nextSyncToken: 'event-token-final',
          }
        : {
            items: [timedEvent('event-1', '이전 제목')],
            nextPageToken: 'event-page-2',
          },
    )
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1')

    await service.syncCalendar('calendar-1')

    const rows = database.sqlite
      .prepare(
        'select google_event_id, title, location, description from events order by google_event_id',
      )
      .all()

    expect(rows).toEqual([
      {
        google_event_id: 'event-1',
        title: '수정된 제목',
        location: null,
        description: null,
      },
      {
        google_event_id: 'event-private',
        title: null,
        location: null,
        description: null,
      },
    ])
  })

  it('normalizes all-day recurring instances and untrusted descriptions', async () => {
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async () => ({
      items: [
        {
          id: 'all-day-instance',
          description:
            '<p>공개 설명 &amp; 내용</p><script>숨은 스크립트</script>',
          end: { date: '2026-08-27', timeZone: 'Asia/Seoul' },
          originalStartTime: { date: '2026-08-26' },
          recurringEventId: 'recurring-parent',
          start: { date: '2026-08-26', timeZone: 'Asia/Seoul' },
          status: 'confirmed',
          summary: '종일 반복 일정',
        },
      ],
      nextSyncToken: 'all-day-token',
    }))
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1')

    await service.syncCalendar('calendar-1')

    expect(
      database.sqlite
        .prepare(`
          select is_all_day, start_date, end_date, recurring_event_google_id,
                 original_start_date, original_starts_at, description
          from events
        `)
        .get(),
    ).toEqual({
      is_all_day: 1,
      start_date: '2026-08-26',
      end_date: '2026-08-27',
      recurring_event_google_id: 'recurring-parent',
      original_start_date: '2026-08-26',
      original_starts_at: null,
      description: '공개 설명 & 내용',
    })
    expect(service.needsWindowReplacement()).toBe(false)
  })

  it('applies incremental changes and deletes cancelled events', async () => {
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async () => ({
      items: [{ id: 'event-1', status: 'cancelled' }],
      nextSyncToken: 'event-token-next',
    }))
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1', 'event-token-old')
    seedStoredEvent(database, 'calendar-1', 'event-1', '기존 일정')

    await service.syncCalendar('calendar-1')

    expect(listEvents.mock.calls[0]?.[0]).toMatchObject({
      calendarId: 'google-calendar-1',
      syncToken: 'event-token-old',
    })
    expect(
      database.sqlite.prepare('select count(*) as count from events').get(),
    ).toEqual({ count: 0 })
  })

  it('recovers a 410 incremental token with a full window sync', async () => {
    const requests: ListEventsRequest[] = []
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async (request) => {
      requests.push(request)
      if (request.syncToken) {
        throw new GoogleApiError(410, 'GONE')
      }
      return {
        items: [timedEvent('event-recovered', '복구 일정')],
        nextSyncToken: 'event-token-recovered',
      }
    })
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1', 'expired-token')

    await service.syncCalendar('calendar-1')

    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ syncToken: 'expired-token' })
    expect(requests[0]?.timeMin).toBeUndefined()
    expect(requests[1]?.syncToken).toBeUndefined()
    expect(requests[1]?.timeMin).toBe('2026-05-24T15:00:00.000Z')
    expect(
      database.sqlite.prepare('select title from events').get(),
    ).toEqual({ title: '복구 일정' })
  })

  it('preserves the previous snapshot when a full sync fails', async () => {
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async () => {
      throw new GoogleApiError(503, 'TRANSIENT')
    })
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1')
    seedStoredEvent(database, 'calendar-1', 'event-old', '보존할 일정')

    await expect(service.syncCalendar('calendar-1', true)).rejects.toThrow()

    expect(
      database.sqlite.prepare('select title from events').get(),
    ).toEqual({ title: '보존할 일정' })
    expect(
      database.sqlite
        .prepare('select sync_status, last_sync_error_code from calendars where id = ?')
        .get('calendar-1'),
    ).toEqual({
      sync_status: 'ERROR',
      last_sync_error_code: 'GOOGLE_TRANSIENT',
    })
  })

  it('replaces the windows of fetched calendars and keeps a failed one as ERROR', async () => {
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async (request) => {
      if (request.calendarId === 'google-calendar-2') {
        throw new GoogleApiError(429, 'RATE_LIMIT')
      }
      return {
        items: [timedEvent('event-new', '새 일정')],
        nextSyncToken: 'new-token',
      }
    })
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1')
    seedCalendar(database, 'calendar-2', 'google-calendar-2')
    seedStoredEvent(database, 'calendar-1', 'event-old-1', '기존 일정 1')
    seedStoredEvent(database, 'calendar-2', 'event-old-2', '기존 일정 2')

    const result = await service.replaceAllWindows()

    expect(result.syncedCount).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(
      database.sqlite.prepare('select title from events order by title').all(),
    ).toEqual([{ title: '기존 일정 2' }, { title: '새 일정' }])
    expect(
      database.sqlite
        .prepare('select id, sync_status, last_sync_error_code from calendars order by id')
        .all(),
    ).toEqual([
      { id: 'calendar-1', sync_status: 'READY', last_sync_error_code: null },
      {
        id: 'calendar-2',
        sync_status: 'ERROR',
        last_sync_error_code: 'GOOGLE_RATE_LIMIT',
      },
    ])
  })

  it('stores zero-length events that Google allows', async () => {
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async () => ({
      items: [
        {
          ...timedEvent('event-point', '알림 일정'),
          start: { dateTime: '2026-08-25T10:00:00+09:00', timeZone: 'Asia/Seoul' },
          end: { dateTime: '2026-08-25T10:00:00+09:00', timeZone: 'Asia/Seoul' },
        },
      ],
      nextSyncToken: 'events-token',
    }))
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1')

    await expect(service.syncCalendar('calendar-1', true)).resolves.toEqual({})

    const point = Date.parse('2026-08-25T10:00:00+09:00')
    expect(
      database.sqlite.prepare('select title, starts_at, ends_at from events').get(),
    ).toEqual({ title: '알림 일정', starts_at: point, ends_at: point })
    expect(
      database.sqlite
        .prepare('select sync_status from calendars where id = ?')
        .get('calendar-1'),
    ).toEqual({ sync_status: 'READY' })
  })

  it('skips an invalid event, counts it by reason and keeps the calendar READY', async () => {
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async () => ({
      items: [
        timedEvent('event-good', '정상 일정'),
        {
          ...timedEvent('event-reversed', '거꾸로 일정'),
          start: { dateTime: '2026-08-25T11:00:00+09:00' },
          end: { dateTime: '2026-08-25T10:00:00+09:00' },
        },
        { id: 'event-no-time', status: 'confirmed', summary: '시간 없음' },
      ],
      nextSyncToken: 'events-token',
    }))
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1')

    const skipped = await service.syncCalendar('calendar-1', true)

    expect(skipped).toEqual({
      GOOGLE_EVENT_TIME_MISSING: 1,
      GOOGLE_EVENT_TIME_RANGE_INVALID: 1,
    })
    expect(JSON.stringify(skipped)).not.toContain('event-')
    expect(database.sqlite.prepare('select title from events').all()).toEqual([
      { title: '정상 일정' },
    ])
    expect(
      database.sqlite
        .prepare('select sync_status, last_sync_error_code from calendars where id = ?')
        .get('calendar-1'),
    ).toEqual({ sync_status: 'READY', last_sync_error_code: null })
  })

  it('removes the stored copy when an incremental change is invalid', async () => {
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async () => ({
      items: [{ id: 'event-old', status: 'confirmed', summary: '깨진 변경' }],
      nextSyncToken: 'events-next',
    }))
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1', 'events-old')
    seedStoredEvent(database, 'calendar-1', 'event-old', '예전 일정')

    await expect(service.syncCalendar('calendar-1')).resolves.toEqual({
      GOOGLE_EVENT_TIME_MISSING: 1,
    })

    expect(database.sqlite.prepare('select count(*) as count from events').get()).toEqual({
      count: 0,
    })
    expect(
      database.sqlite.prepare('select sync_token from calendars where id = ?').get('calendar-1'),
    ).toEqual({ sync_token: 'events-next' })
  })

  it('syncs every calendar even when one of them fails', async () => {
    const listEvents = vi.fn<GoogleAdapter['listEvents']>(async (request) => {
      if (request.calendarId === 'google-calendar-1') {
        throw new GoogleApiError(404, 'PERMANENT', 'notFound')
      }
      return {
        items: [timedEvent(`event-${request.calendarId}`, '새 일정')],
        nextSyncToken: 'new-token',
      }
    })
    const { database, service } = setup(createFakeGoogleAdapter({ listEvents }))
    seedCalendar(database, 'calendar-1', 'google-calendar-1')
    seedCalendar(database, 'calendar-2', 'google-calendar-2')

    const result = await service.syncCalendars(['calendar-1', 'calendar-2'])

    expect(result.syncedCount).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(
      database.sqlite
        .prepare('select id, sync_status, last_sync_error_code from calendars order by id')
        .all(),
    ).toEqual([
      {
        id: 'calendar-1',
        sync_status: 'ERROR',
        last_sync_error_code: 'GOOGLE_PERMANENT_404_notFound',
      },
      { id: 'calendar-2', sync_status: 'READY', last_sync_error_code: null },
    ])
  })
})

function calendarFixture(id: string, summary: string) {
  return { id, summary, primary: false, deleted: false }
}

function timedEvent(id: string, summary: string) {
  return {
    id,
    summary,
    status: 'confirmed',
    start: { dateTime: '2026-08-25T10:00:00+09:00', timeZone: 'Asia/Seoul' },
    end: { dateTime: '2026-08-25T11:00:00+09:00', timeZone: 'Asia/Seoul' },
  }
}

function seedCalendar(
  database: AppDatabase,
  id: string,
  googleCalendarId: string,
  syncToken: string | null = null,
): void {
  database.sqlite
    .prepare(`
      insert into calendars (
        id, connection_id, google_calendar_id, display_name, sync_token
      ) values (?, 1, ?, ?, ?)
    `)
    .run(id, googleCalendarId, googleCalendarId, syncToken)
}

function seedStoredEvent(
  database: AppDatabase,
  calendarId: string,
  googleEventId: string,
  title: string,
): void {
  database.sqlite
    .prepare(`
      insert into events (
        id, calendar_id, google_event_id, is_all_day, starts_at, ends_at, title
      ) values (?, ?, ?, 0, 1000, 2000, ?)
    `)
    .run(`stored-${googleEventId}`, calendarId, googleEventId, title)
}
