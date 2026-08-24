import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { databaseSchema } from './schema'

export interface AppDatabase {
  readonly filePath: string
  readonly orm: BetterSQLite3Database<typeof databaseSchema>
  readonly sqlite: BetterSqlite3.Database
  assertReady(): void
  close(): void
}

interface OpenDatabaseOptions {
  readonly filePath: string
  readonly migrationsFolder?: string
}

export function databaseFilePath(storageDirectory: string): string {
  return resolve(storageDirectory, 'calendar-share.db')
}

export function defaultMigrationsFolder(): string {
  return resolve(process.cwd(), 'drizzle')
}

export function migrateDatabase(
  orm: BetterSQLite3Database<typeof databaseSchema>,
  migrationsFolder = defaultMigrationsFolder(),
): void {
  migrate(orm, { migrationsFolder })
}

export function openDatabase({
  filePath,
  migrationsFolder = defaultMigrationsFolder(),
}: OpenDatabaseOptions): AppDatabase {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true })
  }

  const sqlite = new BetterSqlite3(filePath)

  try {
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')

    if (filePath !== ':memory:') {
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = FULL')
    }

    const orm = drizzle({ client: sqlite, schema: databaseSchema })
    migrateDatabase(orm, migrationsFolder)

    return {
      filePath,
      orm,
      sqlite,
      assertReady() {
        sqlite.prepare('select 1 as ready').get()
      },
      close() {
        if (sqlite.open) {
          sqlite.close()
        }
      },
    }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
