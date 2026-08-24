import { eq } from 'drizzle-orm'

import type { AppDatabase } from '../db/database'
import { googleConnections } from '../db/schema'
import { TokenCipher } from './token-cipher'
import { GOOGLE_CALENDAR_SCOPES } from './types'

const refreshTokenPurpose = 'google-refresh-token'

export interface GoogleConnectionStatus {
  readonly connected: boolean
  readonly lastErrorCode: string | null
  readonly lastSyncedAt: Date | null
  readonly scopes: string[]
}

export class GoogleConnectionService {
  constructor(
    private readonly database: AppDatabase,
    private readonly cipher: TokenCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  connect(refreshToken: string, scopes: string[]): void {
    if (!GOOGLE_CALENDAR_SCOPES.every((scope) => scopes.includes(scope))) {
      throw new Error('GOOGLE_REQUIRED_SCOPES_MISSING')
    }

    const now = this.now()
    const refreshTokenCiphertext = this.cipher.encrypt(
      refreshToken,
      refreshTokenPurpose,
    )
    this.database.orm
      .insert(googleConnections)
      .values({
        id: 1,
        status: 'CONNECTED',
        refreshTokenCiphertext,
        scopes,
        connectedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: googleConnections.id,
        set: {
          status: 'CONNECTED',
          refreshTokenCiphertext,
          scopes,
          connectedAt: now,
          lastErrorCode: null,
          updatedAt: now,
        },
      })
      .run()
  }

  disconnect(): void {
    const now = this.now()
    this.database.orm
      .insert(googleConnections)
      .values({ id: 1, status: 'DISCONNECTED', createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: googleConnections.id,
        set: {
          status: 'DISCONNECTED',
          refreshTokenCiphertext: null,
          calendarListSyncToken: null,
          lastErrorCode: null,
          updatedAt: now,
        },
      })
      .run()
  }

  refreshToken(): string {
    const connection = this.connectionRow()
    if (
      !connection ||
      connection.status === 'DISCONNECTED' ||
      !connection.refreshTokenCiphertext
    ) {
      throw new Error('GOOGLE_NOT_CONNECTED')
    }

    return this.cipher.decrypt(
      connection.refreshTokenCiphertext,
      refreshTokenPurpose,
    )
  }

  status(): GoogleConnectionStatus {
    const row = this.connectionRow()
    return {
      connected: Boolean(row?.refreshTokenCiphertext),
      lastErrorCode: row?.lastErrorCode ?? null,
      lastSyncedAt: row?.lastSyncedAt ?? null,
      scopes: row?.scopes ?? [],
    }
  }

  markError(code: string): void {
    this.database.orm
      .update(googleConnections)
      .set({ status: 'ERROR', lastErrorCode: code, updatedAt: this.now() })
      .where(eq(googleConnections.id, 1))
      .run()
  }

  markSynced(syncToken: string): void {
    const now = this.now()
    this.database.orm
      .update(googleConnections)
      .set({
        calendarListSyncToken: syncToken,
        lastErrorCode: null,
        lastSyncedAt: now,
        status: 'CONNECTED',
        updatedAt: now,
      })
      .where(eq(googleConnections.id, 1))
      .run()
  }

  calendarListSyncToken(): string | null {
    return this.connectionRow()?.calendarListSyncToken ?? null
  }

  private connectionRow() {
    return this.database.orm
      .select()
      .from(googleConnections)
      .where(eq(googleConnections.id, 1))
      .get()
  }
}
