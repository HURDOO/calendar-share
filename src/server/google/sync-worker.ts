import { SyncJobQueue, type ClaimedSyncJob } from './job-queue'
import {
  CalendarSyncFailures,
  GoogleSyncService,
  googleErrorCode,
  type SkippedEventCounts,
} from './sync-service'
import { GoogleApiError } from './types'
import { GoogleWatchService } from './watch-service'

interface SyncWorkerLogger {
  info(fields: Record<string, unknown>, message: string): void
  warn(fields: Record<string, unknown>, message: string): void
}

export class GoogleSyncWorker {
  constructor(
    private readonly queue: SyncJobQueue,
    private readonly sync: GoogleSyncService,
    private readonly watch: GoogleWatchService,
    private readonly onEventsChanged: () => void = () => undefined,
    private readonly logger?: SyncWorkerLogger,
  ) {}

  async runOnce(): Promise<boolean> {
    const job = this.queue.claimNext()
    if (!job) {
      return false
    }

    const startedAt = process.hrtime.bigint()
    try {
      const skippedEvents = await this.execute(job)
      this.queue.succeed(job.id)
      if (
        job.kind === 'CALENDAR_EVENTS_SYNC' ||
        job.kind === 'CALENDAR_WINDOW_SYNC' ||
        job.kind === 'RECOVERY_SYNC'
      ) {
        this.publishEventsChanged(job, startedAt)
      }
      this.logger?.info(
        {
          ...jobLogFields(job, startedAt, 'succeeded'),
          ...skippedEventFields(skippedEvents),
        },
        'Synchronization job completed',
      )
    } catch (error) {
      const failure = classifyWorkerError(error)
      this.queue.fail(job, failure.category, failure.retryable)
      const status = this.queue.status(job.id)?.status
      const partial = error instanceof CalendarSyncFailures ? error.result : null
      if (partial && partial.syncedCount > 0) {
        this.publishEventsChanged(job, startedAt)
      }
      const googleError = failure.source instanceof GoogleApiError ? failure.source : null
      this.logger?.warn(
        {
          ...jobLogFields(
            job,
            startedAt,
            status === 'RETRY' ? 'retry_scheduled' : 'failed',
          ),
          safe_error_code: failure.category,
          ...(googleError
            ? { google_status: googleError.status, google_reason: googleError.reason }
            : {}),
          ...(partial
            ? {
                failed_calendars: partial.failures.length,
                synced_calendars: partial.syncedCount,
                ...skippedEventFields(partial.skippedEvents),
              }
            : {}),
        },
        'Synchronization job failed',
      )
    }

    return true
  }

  private publishEventsChanged(job: ClaimedSyncJob, startedAt: bigint): void {
    try {
      this.onEventsChanged()
    } catch {
      this.logger?.warn(
        {
          ...jobLogFields(job, startedAt, 'realtime_publish_failed'),
          safe_error_code: 'REALTIME_PUBLISH_FAILED',
        },
        'Synchronization succeeded but realtime notification failed',
      )
    }
  }

  private async execute(job: ClaimedSyncJob): Promise<SkippedEventCounts | undefined> {
    switch (job.kind) {
      case 'CALENDAR_LIST_SYNC': {
        const calendarIds = await this.sync.syncCalendarList()
        for (const calendarId of calendarIds) {
          this.queue.enqueue(
            'CALENDAR_EVENTS_SYNC',
            `calendar-events:${calendarId}`,
            calendarId,
          )
        }
        this.queue.enqueue('WATCH_RENEWAL', 'watch-renewal')
        return
      }
      case 'CALENDAR_EVENTS_SYNC':
        return this.sync.syncCalendar(requireCalendarId(job))
      case 'CALENDAR_WINDOW_SYNC': {
        const result = await this.sync.replaceAllWindows()
        if (result.failures.length > 0) {
          throw new CalendarSyncFailures(result)
        }
        return result.skippedEvents
      }
      case 'WATCH_RENEWAL':
        await this.watch.ensureWatches()
        return
      case 'RECOVERY_SYNC': {
        const calendarIds = await this.sync.syncCalendarList()
        // One failing calendar must not block the others or the watch renewal.
        const result = await this.sync.syncCalendars(calendarIds)
        await this.watch.ensureWatches()
        if (result.failures.length > 0) {
          throw new CalendarSyncFailures(result)
        }
        return result.skippedEvents
      }
    }
  }
}

function jobLogFields(
  job: ClaimedSyncJob,
  startedAt: bigint,
  result: string,
): Record<string, unknown> {
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
  return {
    duration_ms: Math.round(durationMs * 100) / 100,
    job_id: job.id,
    job_kind: job.kind,
    result,
  }
}

function requireCalendarId(job: ClaimedSyncJob): string {
  if (!job.calendarId) {
    throw new Error('SYNC_JOB_CALENDAR_MISSING')
  }
  return job.calendarId
}

function skippedEventFields(
  skippedEvents: SkippedEventCounts | undefined,
): Record<string, unknown> {
  const total = Object.values(skippedEvents ?? {}).reduce((sum, count) => sum + count, 0)
  return total > 0
    ? { skipped_events: total, skipped_event_codes: skippedEvents }
    : {}
}

interface WorkerFailure {
  readonly category: string
  readonly retryable: boolean
  readonly source: unknown
}

function classifyWorkerError(error: unknown): WorkerFailure {
  if (error instanceof CalendarSyncFailures) {
    // Retry when any calendar hit a temporary error, and report that one; otherwise
    // report the first permanent failure.
    const failures = error.result.failures.map(classifySingleError)
    return failures.find((failure) => failure.retryable) ?? failures[0] ?? {
      category: 'SYNC_PERMANENT',
      retryable: false,
      source: error,
    }
  }
  return classifySingleError(error)
}

function classifySingleError(error: unknown): WorkerFailure {
  if (error instanceof GoogleApiError) {
    return {
      category: googleErrorCode(error),
      retryable: error.category === 'RATE_LIMIT' || error.category === 'TRANSIENT',
      source: error,
    }
  }

  return { category: 'SYNC_PERMANENT', retryable: false, source: error }
}
