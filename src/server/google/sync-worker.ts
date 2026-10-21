import { SyncJobQueue, type ClaimedSyncJob } from './job-queue'
import { GoogleSyncService, googleErrorCode } from './sync-service'
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
      await this.execute(job)
      this.queue.succeed(job.id)
      if (
        job.kind === 'CALENDAR_EVENTS_SYNC' ||
        job.kind === 'CALENDAR_WINDOW_SYNC' ||
        job.kind === 'RECOVERY_SYNC'
      ) {
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
      this.logger?.info(
        jobLogFields(job, startedAt, 'succeeded'),
        'Synchronization job completed',
      )
    } catch (error) {
      const failure = classifyWorkerError(error)
      this.queue.fail(job, failure.category, failure.retryable)
      const status = this.queue.status(job.id)?.status
      this.logger?.warn(
        {
          ...jobLogFields(
            job,
            startedAt,
            status === 'RETRY' ? 'retry_scheduled' : 'failed',
          ),
          safe_error_code: failure.category,
          ...(error instanceof GoogleApiError
            ? { google_status: error.status, google_reason: error.reason }
            : {}),
        },
        'Synchronization job failed',
      )
    }

    return true
  }

  private async execute(job: ClaimedSyncJob): Promise<void> {
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
        await this.sync.syncCalendar(requireCalendarId(job))
        return
      case 'CALENDAR_WINDOW_SYNC':
        await this.sync.replaceAllWindows()
        return
      case 'WATCH_RENEWAL':
        await this.watch.ensureWatches()
        return
      case 'RECOVERY_SYNC': {
        const calendarIds = await this.sync.syncCalendarList()
        for (const calendarId of calendarIds) {
          await this.sync.syncCalendar(calendarId)
        }
        await this.watch.ensureWatches()
        return
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

function classifyWorkerError(error: unknown): {
  readonly category: string
  readonly retryable: boolean
} {
  if (error instanceof GoogleApiError) {
    return {
      category: googleErrorCode(error),
      retryable: error.category === 'RATE_LIMIT' || error.category === 'TRANSIENT',
    }
  }

  return { category: 'SYNC_PERMANENT', retryable: false }
}
