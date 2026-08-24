import { randomUUID } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { encodeSecretMaterial } from '../../shared/secrets'
import { createTestDatabase } from '../db/testing'
import { GoogleConnectionService } from './connection-service'
import { GoogleOAuthService, OAUTH_TRANSACTION_TIMEOUT_MS } from './oauth-service'
import { createFakeGoogleAdapter } from './testing/fake-google-adapter'
import { TokenCipher } from './token-cipher'
import { GOOGLE_CALENDAR_SCOPES, type GoogleAdapter } from './types'

describe('GoogleOAuthService', () => {
  it('binds encrypted state and PKCE to the administrator session', async () => {
    const database = createTestDatabase()
    const cipher = new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(21)))
    const connection = new GoogleConnectionService(database, cipher)
    const authorizationUrl = vi.fn<GoogleAdapter['authorizationUrl']>(
      ({ codeChallenge, state }) =>
        `https://accounts.google.test/auth?state=${state}&code_challenge=${codeChallenge}`,
    )
    const exchangeAuthorizationCode = vi.fn<
      GoogleAdapter['exchangeAuthorizationCode']
    >(async () => ({
      refreshToken: 'refresh-token',
      scopes: [...GOOGLE_CALENDAR_SCOPES],
    }))
    const adapter = createFakeGoogleAdapter({
      authorizationUrl,
      exchangeAuthorizationCode,
    })
    const service = new GoogleOAuthService(adapter, connection, cipher)
    const sessionId = randomUUID()

    try {
      const started = service.begin(sessionId)
      const url = new URL(started.authorizationUrl)
      const state = url.searchParams.get('state') ?? ''

      expect(started.transaction).not.toContain(state)
      expect(url.searchParams.get('code_challenge')).toMatch(
        /^[A-Za-z0-9_-]{43}$/,
      )

      await service.complete(started.transaction, state, 'authorization-code', sessionId)

      expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
        'authorization-code',
        expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      )
      expect(connection.status().connected).toBe(true)
    } finally {
      database.close()
    }
  })

  it('rejects mismatched and expired transactions before code exchange', async () => {
    const database = createTestDatabase()
    const cipher = new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(22)))
    const connection = new GoogleConnectionService(database, cipher)
    const exchangeAuthorizationCode = vi.fn<
      GoogleAdapter['exchangeAuthorizationCode']
    >()
    const adapter = createFakeGoogleAdapter({
      authorizationUrl: ({ state }) => `https://accounts.google.test/auth?state=${state}`,
      exchangeAuthorizationCode,
    })
    let now = new Date('2026-08-25T00:00:00.000Z')
    const service = new GoogleOAuthService(
      adapter,
      connection,
      cipher,
      () => now,
    )
    const sessionId = randomUUID()

    try {
      const mismatched = service.begin(sessionId)
      await expect(
        service.complete(
          mismatched.transaction,
          'different-state',
          'code',
          sessionId,
        ),
      ).rejects.toThrow('OAUTH_TRANSACTION_REJECTED')

      const expired = service.begin(sessionId)
      const expiredState = new URL(expired.authorizationUrl).searchParams.get('state') ?? ''
      now = new Date(now.getTime() + OAUTH_TRANSACTION_TIMEOUT_MS + 1)
      await expect(
        service.complete(expired.transaction, expiredState, 'code', sessionId),
      ).rejects.toThrow('OAUTH_TRANSACTION_REJECTED')
      expect(exchangeAuthorizationCode).not.toHaveBeenCalled()
    } finally {
      database.close()
    }
  })
})
