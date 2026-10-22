import { afterEach, describe, expect, it, vi } from 'vitest'

import { encodeSecretMaterial } from '../../shared/secrets'
import type { AppDatabase } from '../db/database'
import { createTestDatabase } from '../db/testing'
import { GoogleConnectionService } from './connection-service'
import { SyncJobQueue } from './job-queue'
import { GoogleSyncService } from './sync-service'
import { GoogleSyncWorker } from './sync-worker'
import { createFakeGoogleAdapter } from './testing/fake-google-adapter'
import { TokenCipher } from './token-cipher'
import { type GoogleAdapter, GoogleApiError, GOOGLE_CALENDAR_SCOPES } from './types'
import { GoogleWatchService } from './watch-service'

const now = new Date('2026-08-25T00:00:00.000Z')

describe('GoogleSyncWorker', () => {
  const databases: AppDatabase[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  it.each([
    [429, 'RATE_LIMIT'],
    [503, 'TRANSIENT'],
  ] as const)('retries Google %s failures with durable backoff', async (status, category) => {
    const adapter = createFakeGoogleAdapter({
      listCalendars: async () => {
        throw new GoogleApiError(status, category)
      },
    })
    const database = createTestDatabase()
    databases.push(database)
    const connection = new GoogleConnectionService(
      database,
      new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(19))),
      () => now,
    )
    connection.connect('fixture-refresh-token', [...GOOGLE_CALENDAR_SCOPES])
    const queue = new SyncJobQueue(database, () => now, () => 0)
    const sync = new GoogleSyncService(
      database,
      adapter,
      connection,
      'Asia/Seoul',
      () => now,
    )
    const watch = new GoogleWatchService(
      database,
      adapter,
      connection,
      queue,
      'https://calendar.app.hurdoo.kr',
      () => now,
    )
    const logger = { info: vi.fn(), warn: vi.fn() }
    const worker = new GoogleSyncWorker(queue, sync, watch, undefined, logger)
    queue.enqueue('CALENDAR_LIST_SYNC', 'calendar-list')

    expect(await worker.runOnce()).toBe(true)

    expect(
      database.sqlite
        .prepare(
          'select status, attempt_count, last_error_category from sync_jobs',
        )
        .get(),
    ).toEqual({
      status: 'RETRY',
      attempt_count: 1,
      last_error_category: `GOOGLE_${category}`,
    })
    expect(logger.warn).toHaveBeenCalledWith(
      {
        duration_ms: expect.any(Number),
        job_id: expect.any(String),
        job_kind: 'CALENDAR_LIST_SYNC',
        result: 'retry_scheduled',
        safe_error_code: `GOOGLE_${category}`,
        google_status: status,
        google_reason: null,
      },
      'Synchronization job failed',
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'fixture-refresh-token',
    )
  })

  it('fans a calendar-list job out into deduplicated event jobs', async () => {
    const adapter = createFakeGoogleAdapter({
      listCalendars: async () => ({
        items: [
          {
            id: 'google-calendar-1',
            summary: '기본 캘린더',
            primary: true,
            deleted: false,
          },
        ],
        nextSyncToken: 'calendar-token',
      }),
    })
    const database = createTestDatabase()
    databases.push(database)
    const connection = new GoogleConnectionService(
      database,
      new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(20))),
      () => now,
    )
    connection.connect('fixture-refresh-token', [...GOOGLE_CALENDAR_SCOPES])
    const queue = new SyncJobQueue(database, () => now)
    const sync = new GoogleSyncService(
      database,
      adapter,
      connection,
      'Asia/Seoul',
      () => now,
    )
    const watch = new GoogleWatchService(
      database,
      adapter,
      connection,
      queue,
      'http://localhost:8464',
      () => now,
    )
    const worker = new GoogleSyncWorker(queue, sync, watch)
    queue.enqueue('CALENDAR_LIST_SYNC', 'calendar-list')

    await worker.runOnce()

    expect(queue.counts()).toEqual({ PENDING: 2, SUCCEEDED: 1 })
    expect(
      database.sqlite
        .prepare("select count(*) as count from sync_jobs where kind = 'CALENDAR_EVENTS_SYNC'")
        .get(),
    ).toEqual({ count: 1 })
  })

  it('signals clients only after an event sync succeeds', async () => {
    const adapter = createFakeGoogleAdapter({
      listEvents: async () => ({ items: [], nextSyncToken: 'events-next' }),
    })
    const database = createTestDatabase()
    databases.push(database)
    const connection = new GoogleConnectionService(
      database,
      new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(21))),
      () => now,
    )
    connection.connect('fixture-refresh-token', [...GOOGLE_CALENDAR_SCOPES])
    database.sqlite
      .prepare(`
        insert into calendars (
          id, connection_id, google_calendar_id, display_name, sync_token
        ) values ('calendar-1', 1, 'google-calendar-1', '기본', 'events-old')
      `)
      .run()
    const queue = new SyncJobQueue(database, () => now)
    const sync = new GoogleSyncService(
      database,
      adapter,
      connection,
      'Asia/Seoul',
      () => now,
    )
    const watch = new GoogleWatchService(
      database,
      adapter,
      connection,
      queue,
      'http://localhost:8464',
      () => now,
    )
    const onEventsChanged = vi.fn()
    const worker = new GoogleSyncWorker(queue, sync, watch, onEventsChanged)
    queue.enqueue('CALENDAR_EVENTS_SYNC', 'calendar-events:calendar-1', 'calendar-1')

    await worker.runOnce()

    expect(onEventsChanged).toHaveBeenCalledTimes(1)
    expect(queue.counts()).toEqual({ SUCCEEDED: 1 })
  })
  function recoverySetup(listEvents: GoogleAdapter['listEvents']) {
    const adapter = createFakeGoogleAdapter({
      listCalendars: async () => ({
        items: [
          { id: 'google-calendar-1', summary: '깨진 캘린더', primary: false, deleted: false },
          { id: 'google-calendar-2', summary: '정상 캘린더', primary: true, deleted: false },
          { id: 'google-calendar-3', summary: '정상 캘린더 2', primary: false, deleted: false },
        ],
        nextSyncToken: 'calendar-token',
      }),
      listEvents,
    })
    const database = createTestDatabase()
    databases.push(database)
    const connection = new GoogleConnectionService(
      database,
      new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(22))),
      () => now,
    )
    connection.connect('fixture-refresh-token', [...GOOGLE_CALENDAR_SCOPES])
    const queue = new SyncJobQueue(database, () => now, () => 0)
    const sync = new GoogleSyncService(database, adapter, connection, 'Asia/Seoul', () => now)
    const watch = new GoogleWatchService(
      database,
      adapter,
      connection,
      queue,
      'http://localhost:8464',
      () => now,
    )
    const ensureWatches = vi.spyOn(watch, 'ensureWatches')
    const onEventsChanged = vi.fn()
    const logger = { info: vi.fn(), warn: vi.fn() }
    const worker = new GoogleSyncWorker(queue, sync, watch, onEventsChanged, logger)
    return { database, ensureWatches, logger, onEventsChanged, queue, worker }
  }

  function calendarStates(database: AppDatabase) {
    return database.sqlite
      .prepare(
        'select google_calendar_id, sync_status, last_sync_error_code from calendars order by google_calendar_id',
      )
      .all()
  }

  it('keeps syncing other calendars and watches when one calendar fails in recovery', async () => {
    const { database, ensureWatches, logger, onEventsChanged, queue, worker } =
      recoverySetup(async (request) => {
        if (request.calendarId === 'google-calendar-1') {
          throw new GoogleApiError(404, 'PERMANENT', 'notFound')
        }
        return { items: [], nextSyncToken: 'events-token' }
      })
    queue.enqueue('RECOVERY_SYNC', 'recovery-sync')

    await worker.runOnce()

    expect(calendarStates(database)).toEqual([
      {
        google_calendar_id: 'google-calendar-1',
        sync_status: 'ERROR',
        last_sync_error_code: 'GOOGLE_PERMANENT_404_notFound',
      },
      {
        google_calendar_id: 'google-calendar-2',
        sync_status: 'READY',
        last_sync_error_code: null,
      },
      {
        google_calendar_id: 'google-calendar-3',
        sync_status: 'READY',
        last_sync_error_code: null,
      },
    ])
    expect(ensureWatches).toHaveBeenCalledTimes(1)
    expect(onEventsChanged).toHaveBeenCalledTimes(1)
    expect(
      database.sqlite.prepare('select status, last_error_category from sync_jobs').get(),
    ).toEqual({ status: 'FAILED', last_error_category: 'GOOGLE_PERMANENT_404_notFound' })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        job_kind: 'RECOVERY_SYNC',
        result: 'failed',
        safe_error_code: 'GOOGLE_PERMANENT_404_notFound',
        google_status: 404,
        google_reason: 'notFound',
        failed_calendars: 1,
        synced_calendars: 2,
      }),
      'Synchronization job failed',
    )
  })

  it('retries recovery when a failed calendar hit a temporary error', async () => {
    const { database, queue, worker } = recoverySetup(async (request) => {
      if (request.calendarId === 'google-calendar-1') {
        throw new GoogleApiError(503, 'TRANSIENT')
      }
      return { items: [], nextSyncToken: 'events-token' }
    })
    queue.enqueue('RECOVERY_SYNC', 'recovery-sync')

    await worker.runOnce()

    expect(
      database.sqlite.prepare('select status, last_error_category from sync_jobs').get(),
    ).toEqual({ status: 'RETRY', last_error_category: 'GOOGLE_TRANSIENT' })
  })

  it('completes recovery and logs only safe counts for skipped events', async () => {
    const { database, logger, queue, worker } = recoverySetup(async () => ({
      items: [
        {
          id: 'event-secret-id',
          status: 'confirmed',
          summary: '비공개 제목',
          start: { dateTime: '2026-08-25T11:00:00+09:00' },
          end: { dateTime: '2026-08-25T10:00:00+09:00' },
        },
      ],
      nextSyncToken: 'events-token',
    }))
    queue.enqueue('RECOVERY_SYNC', 'recovery-sync')

    await worker.runOnce()

    expect(queue.counts()).toEqual({ SUCCEEDED: 1 })
    expect(calendarStates(database)).toEqual([
      { google_calendar_id: 'google-calendar-1', sync_status: 'READY', last_sync_error_code: null },
      { google_calendar_id: 'google-calendar-2', sync_status: 'READY', last_sync_error_code: null },
      { google_calendar_id: 'google-calendar-3', sync_status: 'READY', last_sync_error_code: null },
    ])
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        job_kind: 'RECOVERY_SYNC',
        result: 'succeeded',
        skipped_events: 3,
        skipped_event_codes: { GOOGLE_EVENT_TIME_RANGE_INVALID: 3 },
      }),
      'Synchronization job completed',
    )
    const logged = JSON.stringify(logger.info.mock.calls)
    expect(logged).not.toContain('event-secret-id')
    expect(logged).not.toContain('비공개 제목')
  })

  it('replaces windows for healthy calendars when one calendar fails', async () => {
    const { database, queue, worker } = recoverySetup(async (request) => {
      if (request.calendarId === 'google-calendar-1') {
        throw new GoogleApiError(404, 'PERMANENT', 'notFound')
      }
      return { items: [], nextSyncToken: 'window-token' }
    })
    database.sqlite
      .prepare(`
        insert into calendars (id, connection_id, google_calendar_id, display_name)
        values ('calendar-1', 1, 'google-calendar-1', '깨진'),
               ('calendar-2', 1, 'google-calendar-2', '정상'),
               ('calendar-3', 1, 'google-calendar-3', '정상 2')
      `)
      .run()
    queue.enqueue('CALENDAR_WINDOW_SYNC', 'calendar-window')

    await worker.runOnce()

    expect(calendarStates(database)).toEqual([
      {
        google_calendar_id: 'google-calendar-1',
        sync_status: 'ERROR',
        last_sync_error_code: 'GOOGLE_PERMANENT_404_notFound',
      },
      {
        google_calendar_id: 'google-calendar-2',
        sync_status: 'READY',
        last_sync_error_code: null,
      },
      {
        google_calendar_id: 'google-calendar-3',
        sync_status: 'READY',
        last_sync_error_code: null,
      },
    ])
    expect(
      database.sqlite
        .prepare("select sync_token from calendars where id in ('calendar-2', 'calendar-3')")
        .all(),
    ).toEqual([{ sync_token: 'window-token' }, { sync_token: 'window-token' }])
    expect(
      database.sqlite.prepare('select status from sync_jobs').get(),
    ).toEqual({ status: 'FAILED' })
  })
})
