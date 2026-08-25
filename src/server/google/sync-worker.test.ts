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
import { GoogleApiError, GOOGLE_CALENDAR_SCOPES } from './types'
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
})
