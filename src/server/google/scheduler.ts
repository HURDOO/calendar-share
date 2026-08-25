import type { SyncJobKind } from './job-queue'

export interface GoogleScheduler {
  stop(): Promise<void>
}

interface SchedulerDependencies {
  readonly isConnected: () => boolean
  readonly enqueue: (kind: SyncJobKind, dedupeKey: string) => boolean
  readonly needsWindowReplacement: () => boolean
  readonly onRunError?: () => void
  readonly recoverStaleLocks: (maxAgeMs?: number) => number
  readonly runOnce: () => Promise<boolean>
}

interface SchedulerIntervals {
  readonly maintenanceMs: number
  readonly recoveryMs: number
  readonly workerMs: number
}

const defaultIntervals: SchedulerIntervals = {
  maintenanceMs: 60 * 60_000,
  recoveryMs: 5 * 60_000,
  workerMs: 1_000,
}

export function startGoogleScheduler(
  dependencies: SchedulerDependencies,
  intervals: SchedulerIntervals = defaultIntervals,
): GoogleScheduler {
  let stopping = false
  let activeWorker: Promise<boolean> | null = null

  const workerTimer = setInterval(() => {
    if (stopping || activeWorker) return

    const run = dependencies.runOnce().catch(() => {
      dependencies.onRunError?.()
      return false
    })
    activeWorker = run
    void run.finally(() => {
      if (activeWorker === run) activeWorker = null
    })
  }, intervals.workerMs)
  const recoveryTimer = setInterval(() => {
    if (!stopping && dependencies.isConnected()) {
      dependencies.enqueue('RECOVERY_SYNC', 'recovery-sync')
    }
  }, intervals.recoveryMs)
  const maintenanceTimer = setInterval(() => {
    if (stopping || !dependencies.isConnected()) return

    dependencies.recoverStaleLocks()
    dependencies.enqueue('WATCH_RENEWAL', 'watch-renewal')
    if (dependencies.needsWindowReplacement()) {
      dependencies.enqueue('CALENDAR_WINDOW_SYNC', 'calendar-window')
    }
  }, intervals.maintenanceMs)

  const timers = [workerTimer, recoveryTimer, maintenanceTimer]
  for (const timer of timers) timer.unref()

  return {
    async stop() {
      if (!stopping) {
        stopping = true
        for (const timer of timers) clearInterval(timer)
      }
      await activeWorker
    },
  }
}
