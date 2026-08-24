import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'

import { buildServer } from './app'
import { ConfigurationError, loadRuntimeConfig } from './config'
import { databaseFilePath, openDatabase } from './db/database'

async function main() {
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.CALENDAR_SHARE_SKIP_LOCAL_ENV !== '1'
  ) {
    loadDotenv({ path: '.env.local', override: false, quiet: true })
  }

  const runtime = loadRuntimeConfig()
  const publicDir =
    runtime.nodeEnv === 'production'
      ? resolve(fileURLToPath(new URL('../client', import.meta.url)))
      : undefined
  const database = openDatabase({
    filePath: databaseFilePath(runtime.storageDir),
  })

  try {
    const app = await buildServer({
      database,
      ...(publicDir ? { publicDir } : {}),
      logger: true,
      logLevel: runtime.logLevel,
    })

    await app.listen({ host: runtime.host, port: runtime.port })
  } catch (error) {
    database.close()
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
