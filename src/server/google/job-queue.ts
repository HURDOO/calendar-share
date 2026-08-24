import { randomUUID } from 'node:crypto'

import type { AppDatabase } from '../db/database'

export type SyncJobKind =
  | 'CALENDAR_LIST_SYNC'
  | 'CALENDAR_EVENTS_SYNC'
  | 'CALENDAR_WINDOW_SYNC'
  | 'WATCH_RENEWAL'
  | 'RECOVERY_SYNC'

export interface ClaimedSyncJob {
  readonly id: string
  readonly kind: SyncJobKind
  readonly calendarId: string | null
  readonly attemptCount: number
  readonly maxAttempts: number
  readonly payload: Record<string, unknown>
}

export class SyncJobQueue {
  constructor(
    private readonly database: AppDatabase,
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {}

  enqueue(
    kind: SyncJobKind,
    dedupeKey: string,
    calendarId: string | null = null,
    payload: Record<string, unknown> = {},
  ): boolean {
    const now = this.now().getTime()
    const result = this.database.sqlite
      .prepare(`
        insert into sync_jobs (
          id, connection_id, calendar_id, kind, dedupe_key, status,
          payload_json, next_attempt_at, created_at, updated_at
        ) values (?, 1, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
        on conflict do nothing
      `)
      .run(
        randomUUID(),
        calendarId,
        kind,
        dedupeKey,
        JSON.stringify(payload),
        now,
        now,
        now,
      )

    return result.changes === 1
  }

  claimNext(): ClaimedSyncJob | null {
    const now = this.now().getTime()
    const claim = this.database.sqlite.transaction(() => {
      const row = this.database.sqlite
        .prepare(`
          select id, kind, calendar_id, attempt_count, max_attempts, payload_json
          from sync_jobs
          where status in ('PENDING', 'RETRY') and next_attempt_at <= ?
          order by next_attempt_at, created_at
          limit 1
        `)
        .get(now) as
        | {
            id: string
            kind: SyncJobKind
            calendar_id: string | null
            attempt_count: number
            max_attempts: number
            payload_json: string
          }
        | undefined

      if (!row) {
        return null
      }

      this.database.sqlite
        .prepare(`
          update sync_jobs set
            status = 'RUNNING', locked_at = ?, attempt_count = attempt_count + 1,
            updated_at = ?
          where id = ?
        `)
        .run(now, now, row.id)

      return {
        id: row.id,
        kind: row.kind,
        calendarId: row.calendar_id,
        attemptCount: row.attempt_count + 1,
        maxAttempts: row.max_attempts,
        payload: parsePayload(row.payload_json),
      }
    })

    return claim()
  }

  succeed(jobId: string): void {
    const now = this.now().getTime()
    this.database.sqlite
      .prepare(`
        update sync_jobs set
          status = 'SUCCEEDED', locked_at = null, finished_at = ?,
          last_error_category = null, updated_at = ?
        where id = ? and status = 'RUNNING'
      `)
      .run(now, now, jobId)
  }

  fail(job: ClaimedSyncJob, category: string, retryable: boolean): void {
    const now = this.now().getTime()
    const exhausted = job.attemptCount >= job.maxAttempts

    if (!retryable || exhausted) {
      this.database.sqlite
        .prepare(`
          update sync_jobs set
            status = 'FAILED', locked_at = null, finished_at = ?,
            last_error_category = ?, updated_at = ?
          where id = ? and status = 'RUNNING'
        `)
        .run(now, category, now, job.id)
      return
    }

    const exponentialDelay = Math.min(5 * 60_000, 5_000 * 2 ** (job.attemptCount - 1))
    const jitter = Math.floor(exponentialDelay * 0.25 * this.random())
    this.database.sqlite
      .prepare(`
        update sync_jobs set
          status = 'RETRY', locked_at = null, finished_at = null,
          next_attempt_at = ?, last_error_category = ?, updated_at = ?
        where id = ? and status = 'RUNNING'
      `)
      .run(now + exponentialDelay + jitter, category, now, job.id)
  }

  recoverStaleLocks(maxAgeMs = 5 * 60_000): number {
    const now = this.now().getTime()
    const result = this.database.sqlite
      .prepare(`
        update sync_jobs set
          status = 'RETRY', locked_at = null, next_attempt_at = ?,
          last_error_category = 'STALE_LOCK', updated_at = ?
        where status = 'RUNNING' and locked_at < ?
      `)
      .run(now, now, now - maxAgeMs)
    return result.changes
  }

  counts(): Record<string, number> {
    const rows = this.database.sqlite
      .prepare('select status, count(*) as count from sync_jobs group by status')
      .all() as { status: string; count: number }[]
    return Object.fromEntries(rows.map((row) => [row.status, row.count]))
  }
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
