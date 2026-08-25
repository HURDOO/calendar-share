import type { FastifyInstance } from 'fastify'

import type { AppDatabase } from '../db/database'
import { GoogleConnectionService } from './connection-service'
import type { GoogleSecrets } from './config'
import { GoogleApiAdapter } from './google-adapter'
import { SyncJobQueue } from './job-queue'
import { GoogleOAuthService } from './oauth-service'
import { registerGoogleRoutes } from './google-routes'
import { startGoogleScheduler, type GoogleScheduler } from './scheduler'
import { GoogleSyncService } from './sync-service'
import { GoogleSyncWorker } from './sync-worker'
import { TokenCipher } from './token-cipher'
import type { GoogleAdapter } from './types'
import { GoogleWatchService } from './watch-service'

export interface GoogleFeatureContext {
  readonly connection: GoogleConnectionService
  readonly oauth: GoogleOAuthService
  readonly queue: SyncJobQueue
  readonly sync: GoogleSyncService
  readonly watch: GoogleWatchService
  disconnect(): Promise<void>
  shutdown(): Promise<void>
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
  readonly onEventsChanged?: () => void
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
  const worker = new GoogleSyncWorker(
    queue,
    sync,
    watch,
    options.onEventsChanged,
    app.log,
  )
  let scheduler: GoogleScheduler | null = null

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
    async shutdown() {
      await scheduler?.stop()
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
    const recoveredJobs = queue.recoverStaleLocks(0)
    app.log.info(
      {
        recovered_jobs: recoveredJobs,
        result: 'startup_recovery_completed',
      },
      'Recovered interrupted synchronization jobs',
    )
    if (connection.status().connected) {
      queue.enqueue('RECOVERY_SYNC', 'recovery-sync')
    }

    scheduler = startGoogleScheduler({
      enqueue: (kind, dedupeKey) => queue.enqueue(kind, dedupeKey),
      isConnected: () => connection.status().connected,
      needsWindowReplacement: () => sync.needsWindowReplacement(),
      onRunError: () => {
        app.log.error(
          {
            result: 'failed',
            safe_error_code: 'SYNC_WORKER_FAILED',
          },
          'Synchronization worker failed outside a claimed job',
        )
      },
      recoverStaleLocks: (maxAgeMs) => queue.recoverStaleLocks(maxAgeMs),
      runOnce: () => worker.runOnce(),
    })
  }
}
