import type { AppDatabase } from '../db/database'

const retainedLatencySamples = 512
const queueStatuses = ['PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED'] as const

interface LatencySnapshot {
  readonly count: number
  readonly maxMs: number | null
  readonly p95Ms: number | null
}

export interface OperationsSnapshot {
  readonly startedAt: string
  readonly uptimeSeconds: number
  readonly google: {
    readonly calendars: Array<{
      readonly calendarId: string
      readonly lagSeconds: number | null
      readonly lastErrorCode: string | null
      readonly lastSyncedAt: string | null
      readonly syncStatus: string
    }>
    readonly lastSuccessfulSyncAt: string | null
    readonly queue: {
      readonly depth: number
      readonly failedTotal: number
      readonly statuses: Record<(typeof queueStatuses)[number], number>
    }
    readonly watches: {
      readonly active: number
      readonly nextExpiresAt: string | null
      readonly secondsUntilNextExpiry: number | null
    }
  }
  readonly http: {
    readonly publicEvents: LatencySnapshot
  }
}

export class OperationsMetrics {
  private readonly startedAt: Date
  private readonly latencySamples = new Map<string, number[]>()

  constructor(
    private readonly now: () => Date = () => new Date(),
    startedAt = now(),
  ) {
    this.startedAt = startedAt
  }

  recordHttp(route: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return
    }
    const samples = this.latencySamples.get(route) ?? []
    samples.push(durationMs)
    if (samples.length > retainedLatencySamples) {
      samples.splice(0, samples.length - retainedLatencySamples)
    }
    this.latencySamples.set(route, samples)
  }

  snapshot(database: AppDatabase): OperationsSnapshot {
    const now = this.now()
    const connection = database.sqlite
      .prepare('select last_synced_at from google_connections where id = 1')
      .get() as { last_synced_at: number | null } | undefined
    const calendarRows = database.sqlite
      .prepare(`
        select id, sync_status, last_synced_at, last_sync_error_code
        from calendars
        where connection_id = 1 and is_active = 1
        order by id
      `)
      .all() as Array<{
      id: string
      sync_status: string
      last_synced_at: number | null
      last_sync_error_code: string | null
    }>
    const queueRows = database.sqlite
      .prepare('select status, count(*) as count from sync_jobs group by status')
      .all() as Array<{ status: string; count: number }>
    const queue = Object.fromEntries(
      queueStatuses.map((status) => [status, 0]),
    ) as Record<(typeof queueStatuses)[number], number>
    for (const row of queueRows) {
      if (isQueueStatus(row.status)) {
        queue[row.status] = row.count
      }
    }
    const watch = database.sqlite
      .prepare(`
        select count(*) as active, min(expires_at) as next_expires_at
        from watch_channels
        where stopped_at is null
      `)
      .get() as { active: number; next_expires_at: number | null }
    const nextExpiresAt = watch.next_expires_at

    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.max(
        0,
        Math.floor((now.getTime() - this.startedAt.getTime()) / 1_000),
      ),
      google: {
        calendars: calendarRows.map((calendar) => ({
          calendarId: calendar.id,
          lagSeconds:
            calendar.last_synced_at === null
              ? null
              : Math.max(
                  0,
                  Math.floor((now.getTime() - calendar.last_synced_at) / 1_000),
                ),
          lastErrorCode: calendar.last_sync_error_code,
          lastSyncedAt: toIsoString(calendar.last_synced_at),
          syncStatus: calendar.sync_status,
        })),
        lastSuccessfulSyncAt: toIsoString(connection?.last_synced_at ?? null),
        queue: {
          depth: queue.PENDING + queue.RUNNING + queue.RETRY,
          failedTotal: queue.FAILED,
          statuses: queue,
        },
        watches: {
          active: watch.active,
          nextExpiresAt: toIsoString(nextExpiresAt),
          secondsUntilNextExpiry:
            nextExpiresAt === null
              ? null
              : Math.floor((nextExpiresAt - now.getTime()) / 1_000),
        },
      },
      http: {
        publicEvents: latencySnapshot(
          this.latencySamples.get('/api/v1/public/events') ?? [],
        ),
      },
    }
  }
}

function latencySnapshot(samples: number[]): LatencySnapshot {
  if (samples.length === 0) {
    return { count: 0, maxMs: null, p95Ms: null }
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
  return {
    count: samples.length,
    maxMs: roundMilliseconds(sorted.at(-1) ?? 0),
    p95Ms: roundMilliseconds(sorted[p95Index] ?? 0),
  }
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100
}

function toIsoString(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

function isQueueStatus(
  value: string,
): value is (typeof queueStatuses)[number] {
  return queueStatuses.includes(value as (typeof queueStatuses)[number])
}
