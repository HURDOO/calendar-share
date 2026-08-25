import { parseArgs } from 'node:util'

import { databaseFilePath } from '../src/server/db/database'
import {
  createDatabaseBackup,
  DatabaseSnapshotError,
} from '../src/server/db/snapshot'

async function main() {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      output: { type: 'string' },
      source: { type: 'string' },
    },
    strict: true,
  })
  const sourcePath = values.source ?? databaseFilePath(process.env.STORAGE_DIR ?? './data')
  const result = await createDatabaseBackup({
    sourcePath,
    ...(values.output ? { backupPath: values.output } : {}),
  })
  process.stdout.write(`${JSON.stringify({ result: 'ok', ...result })}\n`)
}

main().catch((error: unknown) => {
  const code =
    error instanceof DatabaseSnapshotError ? error.code : 'DATABASE_BACKUP_FAILED'
  process.stderr.write(`${code}\n`)
  process.exitCode = 1
})
