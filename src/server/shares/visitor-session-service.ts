import { randomUUID } from 'node:crypto'

import { generateSecret, hashSecret } from '../../shared/secrets'
import type { AppDatabase } from '../db/database'
import { SharePolicyService } from './policy-service'

export const VISITOR_SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000
export const VISITOR_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000

interface VisitorSessionRow {
  readonly id: string
  readonly share_id: string
  readonly expires_at: number
  readonly last_used_at: number
  readonly revoked_at: number | null
  readonly share_revoked_at: number | null
  readonly access_starts_at: number | null
  readonly access_ends_at: number | null
}

export interface AuthenticatedVisitorSession {
  readonly id: string
  readonly shareId: string
  readonly expiresAt: Date
}

export class VisitorSessionService {
  constructor(
    private readonly database: AppDatabase,
    private readonly policy: SharePolicyService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  exchangeShareToken(rawToken: string): {
    readonly maxAgeSeconds: number
    readonly token: string
    readonly session: AuthenticatedVisitorSession
  } | null {
    const share = this.database.sqlite
      .prepare('select id, access_ends_at from share_links where token_hash = ?')
      .get(hashSecret(rawToken)) as
      | { id: string; access_ends_at: number | null }
      | undefined
    if (!share || this.policy.evaluate(share.id).availability !== 'AVAILABLE') {
      return null
    }

    const token = generateSecret()
    const now = this.now()
    const absoluteExpiry = now.getTime() + VISITOR_SESSION_ABSOLUTE_TIMEOUT_MS
    const expiresAt = new Date(
      share.access_ends_at === null
        ? absoluteExpiry
        : Math.min(absoluteExpiry, share.access_ends_at),
    )
    if (expiresAt.getTime() <= now.getTime()) {
      return null
    }
    const id = randomUUID()
    this.database.sqlite
      .prepare(`
        insert into visitor_sessions (
          id, share_id, token_hash, expires_at, last_used_at, created_at
        ) values (?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        share.id,
        hashSecret(token),
        expiresAt.getTime(),
        now.getTime(),
        now.getTime(),
      )

    return {
      maxAgeSeconds: Math.max(
        1,
        Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
      ),
      token,
      session: { id, shareId: share.id, expiresAt },
    }
  }

  authenticate(rawToken: string): AuthenticatedVisitorSession | null {
    const row = this.database.sqlite
      .prepare(`
        select visitor_sessions.id, visitor_sessions.share_id,
               visitor_sessions.expires_at, visitor_sessions.last_used_at,
               visitor_sessions.revoked_at,
               share_links.revoked_at as share_revoked_at,
               share_links.access_starts_at, share_links.access_ends_at
        from visitor_sessions
        join share_links on share_links.id = visitor_sessions.share_id
        where visitor_sessions.token_hash = ?
      `)
      .get(hashSecret(rawToken)) as VisitorSessionRow | undefined
    if (!row) {
      return null
    }

    const now = this.now()
    const timestamp = now.getTime()
    const invalid =
      row.revoked_at !== null ||
      row.share_revoked_at !== null ||
      row.expires_at <= timestamp ||
      row.last_used_at + VISITOR_SESSION_IDLE_TIMEOUT_MS <= timestamp ||
      (row.access_starts_at !== null && timestamp < row.access_starts_at) ||
      (row.access_ends_at !== null && timestamp >= row.access_ends_at)
    if (invalid) {
      if (row.revoked_at === null) {
        this.database.sqlite
          .prepare('update visitor_sessions set revoked_at = ? where id = ?')
          .run(timestamp, row.id)
      }
      return null
    }

    this.database.sqlite
      .prepare('update visitor_sessions set last_used_at = ? where id = ?')
      .run(timestamp, row.id)
    return {
      id: row.id,
      shareId: row.share_id,
      expiresAt: new Date(row.expires_at),
    }
  }
}
