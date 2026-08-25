import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  chmodSync,
  copyFileSync,
  openSync,
  closeSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import BetterSqlite3 from 'better-sqlite3'

import { defaultMigrationsFolder } from './database'

export type DatabaseSnapshotErrorCode =
  | 'BACKUP_DESTINATION_EXISTS'
  | 'BACKUP_SOURCE_MISSING'
  | 'CHECKSUM_INVALID'
  | 'CHECKSUM_MISSING'
  | 'DATABASE_FOREIGN_KEY_INVALID'
  | 'DATABASE_INTEGRITY_INVALID'
  | 'DATABASE_MIGRATION_STATE_INVALID'
  | 'RESTORE_TARGET_EXISTS'

export class DatabaseSnapshotError extends Error {
  constructor(readonly code: DatabaseSnapshotErrorCode) {
    super(code)
    this.name = 'DatabaseSnapshotError'
  }
}

interface VerifySnapshotOptions {
  readonly checksumPath?: string
  readonly migrationsFolder?: string
  readonly snapshotPath: string
}

interface CreateBackupOptions {
  readonly backupDirectory?: string
  readonly backupPath?: string
  readonly migrationsFolder?: string
  readonly now?: () => Date
  readonly sourcePath: string
}

interface RestoreBackupOptions {
  readonly backupPath: string
  readonly checksumPath?: string
  readonly migrationsFolder?: string
  readonly targetPath: string
}

export interface DatabaseSnapshotResult {
  readonly checksumPath: string
  readonly sha256: string
  readonly snapshotPath: string
}

export async function createDatabaseBackup({
  backupDirectory,
  backupPath,
  migrationsFolder = defaultMigrationsFolder(),
  now = () => new Date(),
  sourcePath,
}: CreateBackupOptions): Promise<DatabaseSnapshotResult> {
  if (!existsSync(sourcePath)) {
    throw new DatabaseSnapshotError('BACKUP_SOURCE_MISSING')
  }

  const destination = resolve(
    backupPath ??
      resolve(
        backupDirectory ?? resolve(dirname(sourcePath), 'backups'),
        backupFileName(now()),
      ),
  )
  const checksumPath = `${destination}.sha256`
  if (existsSync(destination) || existsSync(checksumPath)) {
    throw new DatabaseSnapshotError('BACKUP_DESTINATION_EXISTS')
  }

  mkdirSync(dirname(destination), { mode: 0o700, recursive: true })
  const reservedDestination = openSync(destination, 'wx', 0o600)
  closeSync(reservedDestination)

  const source = new BetterSqlite3(sourcePath, {
    fileMustExist: true,
    readonly: true,
  })
  try {
    source.pragma('busy_timeout = 5000')
    await source.backup(destination)
  } finally {
    source.close()
  }
  chmodSync(destination, 0o600)

  const sha256 = await sha256File(destination)
  writeFileSync(checksumPath, `${sha256}  ${basename(destination)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  verifyDatabaseSnapshot({
    checksumPath,
    migrationsFolder,
    snapshotPath: destination,
  })

  return { checksumPath, sha256, snapshotPath: destination }
}

export async function restoreDatabaseBackup({
  backupPath,
  checksumPath = `${backupPath}.sha256`,
  migrationsFolder = defaultMigrationsFolder(),
  targetPath,
}: RestoreBackupOptions): Promise<DatabaseSnapshotResult> {
  const resolvedTarget = resolve(targetPath)
  if (
    existsSync(resolvedTarget) ||
    existsSync(`${resolvedTarget}-shm`) ||
    existsSync(`${resolvedTarget}-wal`)
  ) {
    throw new DatabaseSnapshotError('RESTORE_TARGET_EXISTS')
  }

  const verified = verifyDatabaseSnapshot({
    checksumPath,
    migrationsFolder,
    snapshotPath: backupPath,
  })
  mkdirSync(dirname(resolvedTarget), { mode: 0o700, recursive: true })
  copyFileSync(backupPath, resolvedTarget, constants.COPYFILE_EXCL)
  chmodSync(resolvedTarget, 0o600)
  const restored = verifyDatabaseSnapshot({
    migrationsFolder,
    snapshotPath: resolvedTarget,
  })
  if (restored.sha256 !== verified.sha256) {
    throw new DatabaseSnapshotError('CHECKSUM_INVALID')
  }

  return {
    checksumPath: resolve(checksumPath),
    sha256: verified.sha256,
    snapshotPath: resolvedTarget,
  }
}

export function verifyDatabaseSnapshot({
  checksumPath,
  migrationsFolder = defaultMigrationsFolder(),
  snapshotPath,
}: VerifySnapshotOptions): { readonly sha256: string } {
  if (!existsSync(snapshotPath)) {
    throw new DatabaseSnapshotError('BACKUP_SOURCE_MISSING')
  }

  const actualSha256 = sha256FileSync(snapshotPath)
  if (checksumPath) {
    if (!existsSync(checksumPath)) {
      throw new DatabaseSnapshotError('CHECKSUM_MISSING')
    }
    const expected = parseChecksum(readFileSync(checksumPath, 'utf8'), snapshotPath)
    if (expected !== actualSha256) {
      throw new DatabaseSnapshotError('CHECKSUM_INVALID')
    }
  }

  const snapshot = new BetterSqlite3(snapshotPath, {
    fileMustExist: true,
    readonly: true,
  })
  try {
    const integrityRows = snapshot.pragma('integrity_check') as Record<string, unknown>[]
    if (
      integrityRows.length !== 1 ||
      Object.values(integrityRows[0] ?? {})[0] !== 'ok'
    ) {
      throw new DatabaseSnapshotError('DATABASE_INTEGRITY_INVALID')
    }
    const foreignKeyRows = snapshot.pragma('foreign_key_check') as Record<
      string,
      unknown
    >[]
    if (foreignKeyRows.length > 0) {
      throw new DatabaseSnapshotError('DATABASE_FOREIGN_KEY_INVALID')
    }

    const applied = snapshot
      .prepare('select count(*) as count from __drizzle_migrations')
      .get() as { count: number }
    const expected = readdirSync(migrationsFolder).filter((name) =>
      name.endsWith('.sql'),
    ).length
    if (applied.count !== expected) {
      throw new DatabaseSnapshotError('DATABASE_MIGRATION_STATE_INVALID')
    }
  } finally {
    snapshot.close()
  }

  return { sha256: actualSha256 }
}

function backupFileName(now: Date): string {
  const timestamp = now.toISOString().replaceAll(/[-:.]/g, '')
  return `calendar-share-${timestamp}-${randomUUID().slice(0, 8)}.db`
}

function parseChecksum(contents: string, snapshotPath: string): string {
  const match = /^([a-f0-9]{64}) {2}([^\n]+)\n?$/.exec(contents)
  if (!match || match[2] !== basename(snapshotPath)) {
    throw new DatabaseSnapshotError('CHECKSUM_INVALID')
  }
  return match[1] ?? ''
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function sha256FileSync(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}
