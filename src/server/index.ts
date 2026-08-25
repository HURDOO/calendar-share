import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'
import type { FastifyInstance } from 'fastify'

import { buildServer } from './app'
import { loadAdminAuthSecrets } from './auth/config'
import { ConfigurationError, loadRuntimeConfig } from './config'
import { databaseFilePath, openDatabase } from './db/database'
import { loadGoogleSecrets } from './google/config'
import { loadShareSecrets } from './shares/config'
import { installGracefulShutdown } from './shutdown'

async function main() {
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.CALENDAR_SHARE_SKIP_LOCAL_ENV !== '1'
  ) {
    loadDotenv({ path: '.env.local', override: false, quiet: true })
  }

  const runtime = loadRuntimeConfig()
  const adminAuth = loadAdminAuthSecrets()
  const googleSecrets = loadGoogleSecrets()
  const shareSecrets = loadShareSecrets()
  const publicDir =
    runtime.nodeEnv === 'production'
      ? resolve(fileURLToPath(new URL('../client', import.meta.url)))
      : undefined
  const database = openDatabase({
    filePath: databaseFilePath(runtime.storageDir),
  })
  let app: FastifyInstance | undefined

  try {
    app = await buildServer({
      adminAuth,
      appBaseUrl: runtime.appBaseUrl,
      database,
      share: shareSecrets,
      google: {
        ...googleSecrets,
        schedulerEnabled: true,
        timeZone: runtime.appTimeZone,
      },
      ...(publicDir ? { publicDir } : {}),
      logger: true,
      logLevel: runtime.logLevel,
      secureCookies: runtime.nodeEnv === 'production',
      timeZone: runtime.appTimeZone,
      trustProxy: runtime.trustProxy,
    })

    await app.listen({ host: runtime.host, port: runtime.port })
    installGracefulShutdown(app)
  } catch (error) {
    if (app) {
      await app.close()
    } else {
      database.close()
    }
    throw error
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof ConfigurationError
      ? `${error.code}: ${error.message}`
      : 'STARTUP_FAILED'

  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
