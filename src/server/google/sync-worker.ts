import { SyncJobQueue, type ClaimedSyncJob } from './job-queue'
import { GoogleSyncService } from './sync-service'
import { GoogleApiError } from './types'
import { GoogleWatchService } from './watch-service'

export class GoogleSyncWorker {
  constructor(
    private readonly queue: SyncJobQueue,
    private readonly sync: GoogleSyncService,
    private readonly watch: GoogleWatchService,
  ) {}

  async runOnce(): Promise<boolean> {
    const job = this.queue.claimNext()
    if (!job) {
      return false
    }

    try {
      await this.execute(job)
      this.queue.succeed(job.id)
    } catch (error) {
      const failure = classifyWorkerError(error)
      this.queue.fail(job, failure.category, failure.retryable)
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
      category: `GOOGLE_${error.category}`,
      retryable: error.category === 'RATE_LIMIT' || error.category === 'TRANSIENT',
    }
  }

  return { category: 'SYNC_PERMANENT', retryable: false }
}
