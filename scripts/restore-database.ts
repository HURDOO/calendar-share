import { parseArgs } from 'node:util'

import {
  DatabaseSnapshotError,
  restoreDatabaseBackup,
} from '../src/server/db/snapshot'

async function main() {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      backup: { type: 'string' },
      target: { type: 'string' },
    },
    strict: true,
  })
  if (!values.backup || !values.target) {
    throw new Error('BACKUP_AND_TARGET_REQUIRED')
  }

  const result = await restoreDatabaseBackup({
    backupPath: values.backup,
    targetPath: values.target,
  })
  process.stdout.write(`${JSON.stringify({ result: 'ok', ...result })}\n`)
}

main().catch((error: unknown) => {
  const code =
    error instanceof DatabaseSnapshotError ? error.code : 'DATABASE_RESTORE_FAILED'
  process.stderr.write(`${code}\n`)
  process.exitCode = 1
})
