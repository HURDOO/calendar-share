import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import type { AppDatabase } from './database'
import { migrateDatabase } from './database'
import { createTestDatabase } from './testing'

describe('SQLite database foundation', () => {
  const databases: AppDatabase[] = []

  function createDatabase() {
    const database = createTestDatabase()
    databases.push(database)
    return database
  }

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close()
    }
  })

  it('migrates an empty database and safely re-runs migrations', () => {
    const database = createDatabase()
    const tableRows = database.sqlite
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as { name: string }[]

    expect(tableRows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        '__drizzle_migrations',
        'admin_sessions',
        'calendars',
        'events',
        'google_connections',
        'share_calendars',
        'share_links',
        'sync_jobs',
        'visitor_sessions',
        'watch_channels',
      ]),
    )

    const before = database.sqlite
      .prepare('select count(*) as count from __drizzle_migrations')
      .get() as { count: number }

    migrateDatabase(database.orm)

    const after = database.sqlite
      .prepare('select count(*) as count from __drizzle_migrations')
      .get() as { count: number }

    expect(before.count).toBeGreaterThanOrEqual(1)
    expect(after.count).toBe(before.count)
  })

  it('upgrades legacy shares without losing links, allowlists, or sessions', () => {
    const sqlite = new BetterSqlite3(':memory:')
    try {
      sqlite.pragma('foreign_keys = ON')
      applySqlMigration(sqlite, '0000_initial_schema.sql')
      applySqlMigration(sqlite, '0001_google_sync_state.sql')
      sqlite
        .prepare("insert into google_connections (id, status) values (1, 'DISCONNECTED')")
        .run()
      sqlite
        .prepare(`
          insert into calendars (
            id, connection_id, google_calendar_id, display_name
          ) values ('legacy-calendar', 1, 'google-legacy', '기존 캘린더')
        `)
        .run()
      sqlite
        .prepare(`
          insert into share_links (
            id, name, calendar_scope, token_hash,
            event_start_date, event_end_date, created_at, updated_at
          ) values (
            'legacy-share', '기존 공유', 'SELECTED', 'legacy-token-hash',
            '2026-08-01', '2026-08-31', 1000, 1000
          )
        `)
        .run()
      sqlite
        .prepare(`
          insert into share_calendars (share_id, calendar_id, created_at)
          values ('legacy-share', 'legacy-calendar', 1000)
        `)
        .run()
      sqlite
        .prepare(`
          insert into visitor_sessions (
            id, share_id, token_hash, expires_at, last_used_at, created_at
          ) values (
            'legacy-session', 'legacy-share', 'legacy-session-hash',
            2000, 1000, 1000
          )
        `)
        .run()

      sqlite.exec('begin')
      try {
        applySqlMigration(sqlite, '0002_hesitant_karen_page.sql')
        sqlite.exec('commit')
      } catch (error) {
        sqlite.exec('rollback')
        throw error
      }

      expect(
        sqlite
          .prepare(`
            select token_hash, token_version, event_date_scope,
                   event_start_date, event_end_date
            from share_links where id = 'legacy-share'
          `)
          .get(),
      ).toEqual({
        token_hash: 'legacy-token-hash',
        token_version: null,
        event_date_scope: 'SELECTED',
        event_start_date: '2026-08-01',
        event_end_date: '2026-08-31',
      })
      expect(
        sqlite.prepare('select count(*) as count from share_calendars').get(),
      ).toEqual({ count: 1 })
      expect(
        sqlite.prepare('select count(*) as count from visitor_sessions').get(),
      ).toEqual({ count: 1 })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    } finally {
      sqlite.close()
    }
  })

  it('enables foreign keys and enforces parent relationships', () => {
    const database = createDatabase()

    expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(() =>
      database.sqlite
        .prepare(
          "insert into share_calendars (share_id, calendar_id) values ('missing-share', 'missing-calendar')",
        )
        .run(),
    ).toThrow()
  })

  it('enforces event identity and timed or all-day boundaries', () => {
    const database = createDatabase()
    seedCalendar(database)

    const insertTimedEvent = database.sqlite.prepare(`
      insert into events (
        id, calendar_id, google_event_id, is_all_day, starts_at, ends_at
      ) values (?, 'calendar-1', ?, 0, ?, ?)
    `)

    insertTimedEvent.run('event-1', 'google-event-1', 1_000, 2_000)

    expect(() =>
      insertTimedEvent.run('event-2', 'google-event-1', 2_000, 3_000),
    ).toThrow()
    // Google allows zero-length events, so end == start is stored.
    expect(() =>
      insertTimedEvent.run('event-3', 'google-event-3', 3_000, 3_000),
    ).not.toThrow()
    expect(() =>
      insertTimedEvent.run('event-5', 'google-event-5', 3_000, 2_999),
    ).toThrow()
    expect(() =>
      database.sqlite
        .prepare(`
          insert into events (
            id, calendar_id, google_event_id, is_all_day, start_date, end_date
          ) values ('event-4', 'calendar-1', 'google-event-4', 1, '2026-08-27', '2026-08-26')
        `)
        .run(),
    ).toThrow()
  })

  it('keeps share dates inclusive and access end instants exclusive', () => {
    const database = createDatabase()
    const insertShare = database.sqlite.prepare(`
      insert into share_links (
        id, name, token_hash, event_start_date, event_end_date,
        access_starts_at, access_ends_at
      ) values (?, '가족', ?, ?, ?, ?, ?)
    `)

    expect(() =>
      insertShare.run(
        'share-inclusive',
        'token-hash-1',
        '2026-08-25',
        '2026-08-25',
        1_000,
        2_000,
      ),
    ).not.toThrow()
    expect(() =>
      insertShare.run(
        'share-invalid-date',
        'token-hash-2',
        '2026-08-26',
        '2026-08-25',
        1_000,
        2_000,
      ),
    ).toThrow()
    expect(() =>
      insertShare.run(
        'share-duplicate-token',
        'token-hash-1',
        '2026-08-25',
        '2026-08-26',
        1_000,
        2_000,
      ),
    ).toThrow()
    expect(() =>
      insertShare.run(
        'share-invalid-access',
        'token-hash-3',
        '2026-08-25',
        '2026-08-26',
        2_000,
        2_000,
      ),
    ).toThrow()
  })

  it('enforces session expiry and last-used boundaries', () => {
    const database = createDatabase()
    const insertSession = database.sqlite.prepare(`
      insert into admin_sessions (
        id, token_hash, expires_at, last_used_at, created_at
      ) values (?, ?, ?, ?, ?)
    `)

    expect(() =>
      insertSession.run('session-1', 'session-hash-1', 2_000, 1_500, 1_000),
    ).not.toThrow()
    expect(() =>
      insertSession.run('session-2', 'session-hash-2', 1_000, 1_000, 1_000),
    ).toThrow()
    expect(() =>
      insertSession.run('session-3', 'session-hash-3', 2_000, 2_001, 1_000),
    ).toThrow()
  })

  it('prevents private event details from entering the read model', () => {
    const database = createDatabase()
    seedCalendar(database)

    expect(() =>
      database.sqlite
        .prepare(`
          insert into events (
            id, calendar_id, google_event_id, is_all_day, starts_at, ends_at,
            visibility, title
          ) values (
            'private-event', 'calendar-1', 'google-private', 0, 1000, 2000,
            'PRIVATE', '저장하면 안 되는 제목'
          )
        `)
        .run(),
    ).toThrow()

    expect(() =>
      database.sqlite
        .prepare(`
          insert into events (
            id, calendar_id, google_event_id, is_all_day, starts_at, ends_at,
            visibility
          ) values (
            'masked-private-event', 'calendar-1', 'google-private-masked', 0,
            1000, 2000, 'PRIVATE'
          )
        `)
        .run(),
    ).not.toThrow()
  })

  it('deduplicates only active sync jobs', () => {
    const database = createDatabase()
    seedConnection(database)
    const insertJob = database.sqlite.prepare(`
      insert into sync_jobs (
        id, connection_id, kind, dedupe_key, status, next_attempt_at, finished_at
      ) values (?, 1, 'CALENDAR_LIST_SYNC', 'calendar-list', ?, 1000, ?)
    `)

    insertJob.run('job-1', 'PENDING', null)
    expect(() => insertJob.run('job-2', 'RETRY', null)).toThrow()

    database.sqlite
      .prepare("update sync_jobs set status = 'SUCCEEDED', finished_at = 2000 where id = 'job-1'")
      .run()

    expect(() => insertJob.run('job-3', 'PENDING', null)).not.toThrow()
  })
})

function seedConnection(database: AppDatabase): void {
  database.sqlite
    .prepare("insert or ignore into google_connections (id, status) values (1, 'DISCONNECTED')")
    .run()
}

function seedCalendar(database: AppDatabase): void {
  seedConnection(database)
  database.sqlite
    .prepare(`
      insert into calendars (
        id, connection_id, google_calendar_id, display_name
      ) values ('calendar-1', 1, 'google-calendar-1', '기본 캘린더')
    `)
    .run()
}

function applySqlMigration(
  sqlite: BetterSqlite3.Database,
  filename: string,
): void {
  const sql = readFileSync(resolve(process.cwd(), 'drizzle', filename), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) {
      sqlite.exec(statement)
    }
  }
}
