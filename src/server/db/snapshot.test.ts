import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { openDatabase } from './database'
import {
  createDatabaseBackup,
  restoreDatabaseBackup,
} from './snapshot'

describe('SQLite backup and restore', () => {
  it('restores an online backup into a separate empty database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'calendar-share-backup-'))
    const sourcePath = join(directory, 'live.db')
    const backupPath = join(directory, 'backups', 'known.db')
    const targetPath = join(directory, 'verification', 'restored.db')
    const source = openDatabase({ filePath: sourcePath })
    source.sqlite
      .prepare(`
        insert into share_links (
          id, name, calendar_scope, token_hash, token_version,
          event_date_scope, event_start_date, event_end_date
        ) values ('share-1', '복구 검증', 'ALL', 'hash-1', 1, 'ALL', null, null)
      `)
      .run()

    const backup = await createDatabaseBackup({ backupPath, sourcePath })
    source.sqlite
      .prepare(`
        insert into share_links (
          id, name, calendar_scope, token_hash, token_version,
          event_date_scope, event_start_date, event_end_date
        ) values ('share-2', '백업 이후', 'ALL', 'hash-2', 1, 'ALL', null, null)
      `)
      .run()
    source.close()

    const restored = await restoreDatabaseBackup({
      backupPath,
      targetPath,
    })
    const verification = new BetterSqlite3(targetPath, {
      fileMustExist: true,
      readonly: true,
    })
    const policies = verification
      .prepare('select id, name, event_date_scope from share_links order by id')
      .all()
    verification.close()

    expect(restored.sha256).toBe(backup.sha256)
    expect(policies).toEqual([
      { event_date_scope: 'ALL', id: 'share-1', name: '복구 검증' },
    ])
    expect(readFileSync(backup.checksumPath, 'utf8')).toContain(backup.sha256)
    expect(statSync(backup.snapshotPath).mode & 0o777).toBe(0o600)
    expect(statSync(backup.checksumPath).mode & 0o777).toBe(0o600)
    expect(statSync(targetPath).mode & 0o777).toBe(0o600)
  })

  it('rejects checksum changes and never overwrites a restore target', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'calendar-share-restore-'))
    const sourcePath = join(directory, 'live.db')
    const backupPath = join(directory, 'backup.db')
    const targetPath = join(directory, 'existing.db')
    const source = openDatabase({ filePath: sourcePath })
    source.close()
    await createDatabaseBackup({ backupPath, sourcePath })

    writeFileSync(targetPath, 'keep-me', { encoding: 'utf8', mode: 0o600 })
    await expect(
      restoreDatabaseBackup({ backupPath, targetPath }),
    ).rejects.toMatchObject({
      code: 'RESTORE_TARGET_EXISTS',
    })
    expect(readFileSync(targetPath, 'utf8')).toBe('keep-me')

    writeFileSync(`${backupPath}.sha256`, `${'0'.repeat(64)}  backup.db\n`)
    await expect(
      restoreDatabaseBackup({
        backupPath,
        targetPath: join(directory, 'new-target.db'),
      }),
    ).rejects.toMatchObject({
      code: 'CHECKSUM_INVALID',
    })
  })
})
