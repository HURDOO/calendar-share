import { describe, expect, it } from 'vitest'

import { createTestDatabase } from '../db/testing'
import { SyncJobQueue } from '../google/job-queue'
import { OperationsMetrics } from './metrics'

describe('OperationsMetrics', () => {
  it('returns bounded operational state without calendar or event details', () => {
    const now = new Date('2026-08-25T12:00:00.000Z')
    const database = createTestDatabase()
    try {
      database.sqlite
        .prepare(
          `insert into google_connections (id, status, last_synced_at)
           values (1, 'DISCONNECTED', ?)`,
        )
        .run(now.getTime() - 60_000)
      database.sqlite
        .prepare(`
          insert into calendars (
            id, connection_id, google_calendar_id, display_name, is_active,
            sync_status, last_synced_at, last_sync_error_code
          ) values (
            'calendar-1', 1, 'google-private-id', '민감할 수 있는 이름', 1,
            'READY', ?, null
          )
        `)
        .run(now.getTime() - 120_000)
      database.sqlite
        .prepare(`
          insert into watch_channels (
            channel_id, connection_id, kind, resource_id,
            verification_token_hash, expires_at, created_at, updated_at
          ) values ('channel-1', 1, 'CALENDAR_LIST', 'resource-1',
                    'token-hash', ?, ?, ?)
        `)
        .run(now.getTime() + 3_600_000, now.getTime(), now.getTime())

      const queue = new SyncJobQueue(database, () => now)
      queue.enqueue('RECOVERY_SYNC', 'pending-job')
      queue.enqueue('WATCH_RENEWAL', 'failed-job')
      const failed = queue.claimNext()
      if (!failed) throw new Error('fixture job missing')
      queue.fail(failed, 'GOOGLE_AUTH', false)

      const metrics = new OperationsMetrics(
        () => now,
        new Date(now.getTime() - 10_000),
      )
      for (let duration = 1; duration <= 20; duration += 1) {
        metrics.recordHttp('/api/v1/public/events', duration)
      }

      const snapshot = metrics.snapshot(database)

      expect(snapshot).toEqual({
        startedAt: '2026-08-25T11:59:50.000Z',
        uptimeSeconds: 10,
        google: {
          calendars: [
            {
              calendarId: 'calendar-1',
              lagSeconds: 120,
              lastErrorCode: null,
              lastSyncedAt: '2026-08-25T11:58:00.000Z',
              syncStatus: 'READY',
            },
          ],
          lastSuccessfulSyncAt: '2026-08-25T11:59:00.000Z',
          queue: {
            depth: 1,
            failedTotal: 1,
            statuses: {
              FAILED: 1,
              PENDING: 1,
              RETRY: 0,
              RUNNING: 0,
              SUCCEEDED: 0,
            },
          },
          watches: {
            active: 1,
            nextExpiresAt: '2026-08-25T13:00:00.000Z',
            secondsUntilNextExpiry: 3_600,
          },
        },
        http: {
          publicEvents: { count: 20, maxMs: 20, p95Ms: 19 },
        },
      })
      expect(JSON.stringify(snapshot)).not.toContain('google-private-id')
      expect(JSON.stringify(snapshot)).not.toContain('민감할 수 있는 이름')
    } finally {
      database.close()
    }
  })
})
