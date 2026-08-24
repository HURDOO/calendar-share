import type { FastifyInstance } from 'fastify'

import type { AppDatabase } from '../db/database'
import { GoogleConnectionService } from './connection-service'
import type { GoogleSecrets } from './config'
import { GoogleApiAdapter } from './google-adapter'
import { SyncJobQueue } from './job-queue'
import { GoogleOAuthService } from './oauth-service'
import { registerGoogleRoutes } from './google-routes'
import { GoogleSyncService } from './sync-service'
import { GoogleSyncWorker } from './sync-worker'
import { TokenCipher } from './token-cipher'
import type { GoogleAdapter } from './types'
import { GoogleWatchService } from './watch-service'

const workerIntervalMs = 1_000
const recoveryIntervalMs = 5 * 60_000
const maintenanceIntervalMs = 60 * 60_000

export interface GoogleFeatureContext {
  readonly connection: GoogleConnectionService
  readonly oauth: GoogleOAuthService
  readonly queue: SyncJobQueue
  readonly sync: GoogleSyncService
  readonly watch: GoogleWatchService
  disconnect(): Promise<void>
  status(): {
    readonly connected: boolean
    readonly lastErrorCode: string | null
    readonly lastSyncedAt: string | null
    readonly scopes: string[]
    readonly calendars: { readonly active: number; readonly ready: number }
    readonly queue: Record<string, number>
  }
}

export interface RegisterGoogleFeatureOptions extends GoogleSecrets {
  readonly appBaseUrl: string
  readonly database: AppDatabase
  readonly secureCookie: boolean
  readonly timeZone: string
  readonly adapter?: GoogleAdapter
  readonly now?: () => Date
  readonly schedulerEnabled?: boolean
}

export async function registerGoogleFeature(
  app: FastifyInstance,
  options: RegisterGoogleFeatureOptions,
): Promise<void> {
  const now = options.now ?? (() => new Date())
  const adapter =
    options.adapter ??
    new GoogleApiAdapter({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectUri: new URL(
        '/api/v1/admin/google/callback',
        options.appBaseUrl,
      ).toString(),
    })
  const cipher = new TokenCipher(options.tokenEncryptionKey)
  const connection = new GoogleConnectionService(options.database, cipher, now)
  const queue = new SyncJobQueue(options.database, now)
  const sync = new GoogleSyncService(
    options.database,
    adapter,
    connection,
    options.timeZone,
    now,
  )
  const watch = new GoogleWatchService(
    options.database,
    adapter,
    connection,
    queue,
    options.appBaseUrl,
    now,
  )
  const oauth = new GoogleOAuthService(adapter, connection, cipher, now)
  const worker = new GoogleSyncWorker(queue, sync, watch)

  const context: GoogleFeatureContext = {
    connection,
    oauth,
    queue,
    sync,
    watch,
    async disconnect() {
      if (connection.status().connected) {
        const refreshToken = connection.refreshToken()
        try {
          await watch.stopAll()
        } catch {
          app.log.warn('Unable to stop every Google watch channel')
        }
        try {
          await adapter.revokeRefreshToken(refreshToken)
        } catch {
          app.log.warn('Unable to revoke the Google refresh token')
        }
      }

      const disconnectedAt = now().getTime()
      const disconnectLocally = options.database.sqlite.transaction(() => {
        options.database.sqlite.prepare('delete from sync_jobs').run()
        options.database.sqlite.prepare('delete from watch_channels').run()
        options.database.sqlite.prepare('delete from events').run()
        options.database.sqlite
          .prepare(`
            update calendars set
              is_active = 0, sync_token = null, sync_status = 'NEVER',
              last_sync_error_code = null, sync_window_start_date = null,
              sync_window_end_date = null, deleted_at = ?, updated_at = ?
            where connection_id = 1
          `)
          .run(disconnectedAt, disconnectedAt)
        connection.disconnect()
      })
      disconnectLocally()
    },
    status() {
      const google = connection.status()
      const calendars = options.database.sqlite
        .prepare(`
          select
            count(*) filter (where is_active = 1) as active,
            count(*) filter (where is_active = 1 and sync_status = 'READY') as ready
          from calendars where connection_id = 1
        `)
        .get() as { active: number; ready: number }

      return {
        connected: google.connected,
        lastErrorCode: google.lastErrorCode,
        lastSyncedAt: google.lastSyncedAt?.toISOString() ?? null,
        scopes: google.scopes,
        calendars,
        queue: queue.counts(),
      }
    },
  }

  app.decorate('googleFeature', context)
  await registerGoogleRoutes(app, {
    secureCookie: options.secureCookie,
  })

  if (options.schedulerEnabled) {
    queue.recoverStaleLocks()
    if (connection.status().connected) {
      queue.enqueue('RECOVERY_SYNC', 'recovery-sync')
    }

    const timers = startScheduler({ connection, queue, sync, worker })
    app.addHook('onClose', async () => {
      for (const timer of timers) {
        clearInterval(timer)
      }
    })
  }
}

function startScheduler({
  connection,
  queue,
  sync,
  worker,
}: {
  readonly connection: GoogleConnectionService
  readonly queue: SyncJobQueue
  readonly sync: GoogleSyncService
  readonly worker: GoogleSyncWorker
}): NodeJS.Timeout[] {
  let workerRunning = false
  const workerTimer = setInterval(() => {
    if (workerRunning) {
      return
    }

    workerRunning = true
    void worker.runOnce().finally(() => {
      workerRunning = false
    })
  }, workerIntervalMs)
  const recoveryTimer = setInterval(() => {
    if (connection.status().connected) {
      queue.enqueue('RECOVERY_SYNC', 'recovery-sync')
    }
  }, recoveryIntervalMs)
  const maintenanceTimer = setInterval(() => {
    if (!connection.status().connected) {
      return
    }

    queue.recoverStaleLocks()
    queue.enqueue('WATCH_RENEWAL', 'watch-renewal')
    if (sync.needsWindowReplacement()) {
      queue.enqueue('CALENDAR_WINDOW_SYNC', 'calendar-window')
    }
  }, maintenanceIntervalMs)

  const timers = [workerTimer, recoveryTimer, maintenanceTimer]
  for (const timer of timers) {
    timer.unref()
  }
  return timers
}
