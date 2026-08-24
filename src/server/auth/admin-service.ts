import { createHmac, randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { generateSecret, hashSecret, secretsMatch, verifyPassword } from '../../shared/secrets'
import type { AppDatabase } from '../db/database'
import { adminSessions } from '../db/schema'

export const ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000
export const ADMIN_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000

export interface AuthenticatedAdminSession {
  readonly id: string
  readonly csrfToken: string
  readonly expiresAt: Date
}

export interface AdminSessionServiceOptions {
  readonly database: AppDatabase
  readonly passwordVerifier: string
  readonly sessionSecret: string
  readonly now?: () => Date
}

export class AdminSessionService {
  private readonly database: AppDatabase
  private readonly passwordVerifier: string
  private readonly sessionSecret: Buffer
  private readonly now: () => Date

  constructor({
    database,
    passwordVerifier,
    sessionSecret,
    now = () => new Date(),
  }: AdminSessionServiceOptions) {
    this.database = database
    this.passwordVerifier = passwordVerifier
    this.sessionSecret = Buffer.from(sessionSecret, 'base64url')
    this.now = now
  }

  verifyCredentials(password: string): Promise<boolean> {
    return verifyPassword(password, this.passwordVerifier)
  }

  createSession(): { readonly token: string; readonly session: AuthenticatedAdminSession } {
    const token = generateSecret()
    const tokenHash = hashSecret(token)
    const id = randomUUID()
    const now = this.now()
    const expiresAt = new Date(now.getTime() + ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS)

    this.database.orm.insert(adminSessions).values({
      id,
      tokenHash,
      expiresAt,
      lastUsedAt: now,
      createdAt: now,
    }).run()

    return {
      token,
      session: {
        id,
        csrfToken: this.createCsrfToken(id),
        expiresAt,
      },
    }
  }

  authenticate(token: string): AuthenticatedAdminSession | null {
    const tokenHash = hashSecret(token)
    const row = this.database.orm
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.tokenHash, tokenHash))
      .get()

    if (!row) {
      return null
    }

    const now = this.now()
    const idleExpiresAt = row.lastUsedAt.getTime() + ADMIN_SESSION_IDLE_TIMEOUT_MS
    const isExpired = row.expiresAt.getTime() <= now.getTime() || idleExpiresAt <= now.getTime()

    if (row.revokedAt || isExpired) {
      if (!row.revokedAt) {
        this.database.orm
          .update(adminSessions)
          .set({ revokedAt: now })
          .where(eq(adminSessions.id, row.id))
          .run()
      }

      return null
    }

    this.database.orm
      .update(adminSessions)
      .set({ lastUsedAt: now })
      .where(eq(adminSessions.id, row.id))
      .run()

    return {
      id: row.id,
      csrfToken: this.createCsrfToken(row.id),
      expiresAt: row.expiresAt,
    }
  }

  revoke(sessionId: string): void {
    this.database.orm
      .update(adminSessions)
      .set({ revokedAt: this.now() })
      .where(eq(adminSessions.id, sessionId))
      .run()
  }

  verifyCsrf(sessionId: string, actualToken: string | undefined): boolean {
    return Boolean(actualToken) && secretsMatch(actualToken ?? '', this.createCsrfToken(sessionId))
  }

  private createCsrfToken(sessionId: string): string {
    return createHmac('sha256', this.sessionSecret)
      .update(`calendar-share:admin-csrf:v1:${sessionId}`, 'utf8')
      .digest('base64url')
  }
}
