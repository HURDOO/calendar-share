import { randomUUID } from 'node:crypto'

import { hashSecret, secretsMatch } from '../../shared/secrets'
import type { AppDatabase } from '../db/database'
import { ShareLinkTokenFactory } from './share-link-token'
import {
  type ShareView,
  type ShareWriteInput,
  shareWriteSchema,
} from './share-types'

interface ShareRow {
  readonly id: string
  readonly name: string
  readonly calendar_scope: 'ALL' | 'SELECTED'
  readonly token_hash: string
  readonly token_version: number | null
  readonly event_date_scope: 'ALL' | 'SELECTED'
  readonly event_start_date: string | null
  readonly event_end_date: string | null
  readonly access_starts_at: number | null
  readonly access_ends_at: number | null
  readonly revoked_at: number | null
  readonly created_at: number
  readonly updated_at: number
}

export class ShareServiceError extends Error {
  constructor(readonly code: 'SHARE_NOT_FOUND' | 'SHARE_REVOKED' | 'CALENDAR_INVALID') {
    super(code)
    this.name = 'ShareServiceError'
  }
}

export class ShareService {
  private readonly tokenFactory: ShareLinkTokenFactory

  constructor(
    private readonly database: AppDatabase,
    private readonly appBaseUrl: string,
    linkSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.tokenFactory = new ShareLinkTokenFactory(linkSecret)
  }

  create(rawInput: ShareWriteInput): {
    readonly share: ShareView
    readonly token: string
    readonly shareUrl: string
  } {
    const input = shareWriteSchema.parse(rawInput)
    this.assertCalendars(input.calendarIds)
    const id = randomUUID()
    const tokenVersion = 1
    const token = this.tokenFactory.create(id, tokenVersion)
    const now = this.now().getTime()
    const create = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(`
          insert into share_links (
            id, name, calendar_scope, token_hash, token_version,
            event_date_scope, event_start_date, event_end_date,
            access_starts_at, access_ends_at, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          input.name,
          input.calendarScope,
          hashSecret(token),
          tokenVersion,
          input.eventDateScope,
          input.eventStartDate,
          input.eventEndDate,
          parseOptionalInstant(input.accessStartsAt),
          parseOptionalInstant(input.accessEndsAt),
          now,
          now,
        )
      this.replaceCalendarAllowlist(id, input.calendarScope, input.calendarIds, now)
    })
    create()

    const share = this.requireView(id)
    return {
      share,
      token,
      shareUrl: share.shareUrl ?? this.shareUrl(token),
    }
  }

  list(): ShareView[] {
    return this.rows().map((row) => this.toView(row))
  }

  get(id: string): ShareView | null {
    const row = this.row(id)
    return row ? this.toView(row) : null
  }

  update(id: string, rawInput: ShareWriteInput): ShareView {
    const input = shareWriteSchema.parse(rawInput)
    const existing = this.requireRow(id)
    if (existing.revoked_at !== null) {
      throw new ShareServiceError('SHARE_REVOKED')
    }
    this.assertCalendars(input.calendarIds)
    const now = this.now().getTime()
    const update = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(`
          update share_links set
            name = ?, calendar_scope = ?, event_date_scope = ?,
            event_start_date = ?, event_end_date = ?, access_starts_at = ?,
            access_ends_at = ?, updated_at = ?
          where id = ?
        `)
        .run(
          input.name,
          input.calendarScope,
          input.eventDateScope,
          input.eventStartDate,
          input.eventEndDate,
          parseOptionalInstant(input.accessStartsAt),
          parseOptionalInstant(input.accessEndsAt),
          now,
          id,
        )
      this.replaceCalendarAllowlist(id, input.calendarScope, input.calendarIds, now)
    })
    update()
    return this.requireView(id)
  }

  revoke(id: string): void {
    const existing = this.requireRow(id)
    if (existing.revoked_at !== null) {
      return
    }
    const now = this.now().getTime()
    const revoke = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare('update share_links set revoked_at = ?, updated_at = ? where id = ?')
        .run(now, now, id)
      this.database.sqlite
        .prepare(
          'update visitor_sessions set revoked_at = ? where share_id = ? and revoked_at is null',
        )
        .run(now, id)
    })
    revoke()
  }

  rotateToken(id: string): {
    readonly share: ShareView
    readonly token: string
    readonly shareUrl: string
  } {
    const existing = this.requireRow(id)
    if (existing.revoked_at !== null) {
      throw new ShareServiceError('SHARE_REVOKED')
    }
    const tokenVersion = (existing.token_version ?? 0) + 1
    const token = this.tokenFactory.create(id, tokenVersion)
    const now = this.now().getTime()
    const rotate = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'update share_links set token_hash = ?, token_version = ?, updated_at = ? where id = ?',
        )
        .run(hashSecret(token), tokenVersion, now, id)
      this.database.sqlite
        .prepare(
          'update visitor_sessions set revoked_at = ? where share_id = ? and revoked_at is null',
        )
        .run(now, id)
    })
    rotate()
    const share = this.requireView(id)
    return { share, token, shareUrl: share.shareUrl ?? this.shareUrl(token) }
  }

  private shareUrl(token: string): string {
    const url = new URL('/', this.appBaseUrl)
    url.hash = `share=${token}`
    return url.toString()
  }

  private assertCalendars(calendarIds: string[]): void {
    if (calendarIds.length === 0) {
      return
    }
    const placeholders = calendarIds.map(() => '?').join(', ')
    const row = this.database.sqlite
      .prepare(
        `select count(*) as count from calendars
         where id in (${placeholders}) and is_active = 1`,
      )
      .get(...calendarIds) as { count: number }
    if (row.count !== calendarIds.length) {
      throw new ShareServiceError('CALENDAR_INVALID')
    }
  }

  private replaceCalendarAllowlist(
    shareId: string,
    scope: ShareWriteInput['calendarScope'],
    calendarIds: string[],
    now: number,
  ): void {
    this.database.sqlite
      .prepare('delete from share_calendars where share_id = ?')
      .run(shareId)
    if (scope !== 'SELECTED') {
      return
    }
    const insert = this.database.sqlite.prepare(
      'insert into share_calendars (share_id, calendar_id, created_at) values (?, ?, ?)',
    )
    for (const calendarId of calendarIds) {
      insert.run(shareId, calendarId, now)
    }
  }

  private rows(): ShareRow[] {
    return this.database.sqlite
      .prepare('select * from share_links order by created_at desc, id')
      .all() as ShareRow[]
  }

  private row(id: string): ShareRow | undefined {
    return this.database.sqlite
      .prepare('select * from share_links where id = ?')
      .get(id) as ShareRow | undefined
  }

  private requireRow(id: string): ShareRow {
    const row = this.row(id)
    if (!row) {
      throw new ShareServiceError('SHARE_NOT_FOUND')
    }
    return row
  }

  private requireView(id: string): ShareView {
    return this.toView(this.requireRow(id))
  }

  private toView(row: ShareRow): ShareView {
    const calendarIds = this.database.sqlite
      .prepare('select calendar_id from share_calendars where share_id = ? order by calendar_id')
      .all(row.id) as { calendar_id: string }[]
    return {
      id: row.id,
      name: row.name,
      calendarScope: row.calendar_scope,
      calendarIds: calendarIds.map((item) => item.calendar_id),
      eventDateScope: row.event_date_scope,
      eventStartDate: row.event_start_date,
      eventEndDate: row.event_end_date,
      shareUrl: this.recoverShareUrl(row),
      accessStartsAt: formatOptionalInstant(row.access_starts_at),
      accessEndsAt: formatOptionalInstant(row.access_ends_at),
      revokedAt: formatOptionalInstant(row.revoked_at),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }
  }

  private recoverShareUrl(row: ShareRow): string | null {
    if (row.revoked_at !== null || row.token_version === null) {
      return null
    }

    const token = this.tokenFactory.create(row.id, row.token_version)
    return secretsMatch(hashSecret(token), row.token_hash)
      ? this.shareUrl(token)
      : null
  }
}

function parseOptionalInstant(value: string | null): number | null {
  return value ? Date.parse(value) : null
}

function formatOptionalInstant(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}
