import { describe, expect, it } from 'vitest'

import { createTestDatabase } from '../db/testing'
import { SyncJobQueue } from './job-queue'

describe('SyncJobQueue', () => {
  it('deduplicates active jobs and allows a later run after success', () => {
    const database = createTestDatabase()
    database.sqlite
      .prepare("insert into google_connections (id, status) values (1, 'DISCONNECTED')")
      .run()
    const queue = new SyncJobQueue(database)

    try {
      expect(queue.enqueue('CALENDAR_LIST_SYNC', 'calendar-list')).toBe(true)
      expect(queue.enqueue('CALENDAR_LIST_SYNC', 'calendar-list')).toBe(false)

      const job = queue.claimNext()
      expect(job?.kind).toBe('CALENDAR_LIST_SYNC')
      queue.succeed(job?.id ?? '')

      expect(queue.enqueue('CALENDAR_LIST_SYNC', 'calendar-list')).toBe(true)
    } finally {
      database.close()
    }
  })

  it('backs off retryable failures and dead-letters permanent failures', () => {
    const database = createTestDatabase()
    database.sqlite
      .prepare("insert into google_connections (id, status) values (1, 'DISCONNECTED')")
      .run()
    const baseTime = new Date('2026-08-25T00:00:00.000Z')
    const queue = new SyncJobQueue(database, () => baseTime, () => 0)

    try {
      queue.enqueue('RECOVERY_SYNC', 'recovery')
      const retryJob = queue.claimNext()
      if (!retryJob) throw new Error('fixture job missing')
      queue.fail(retryJob, 'GOOGLE_TRANSIENT', true)

      expect(
        database.sqlite
          .prepare(
            'select status, next_attempt_at, last_error_category from sync_jobs where id = ?',
          )
          .get(retryJob.id),
      ).toEqual({
        status: 'RETRY',
        next_attempt_at: baseTime.getTime() + 5_000,
        last_error_category: 'GOOGLE_TRANSIENT',
      })

      queue.enqueue('WATCH_RENEWAL', 'watch-renewal')
      const permanentJob = queue.claimNext()
      if (!permanentJob) throw new Error('fixture job missing')
      queue.fail(permanentJob, 'GOOGLE_AUTH', false)

      expect(
        database.sqlite
          .prepare('select status from sync_jobs where id = ?')
          .get(permanentJob.id),
      ).toEqual({ status: 'FAILED' })
    } finally {
      database.close()
    }
  })
})
