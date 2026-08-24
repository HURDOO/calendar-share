import { describe, expect, it } from 'vitest'

import { encodeSecretMaterial } from '../../shared/secrets'
import { createTestDatabase } from '../db/testing'
import { GoogleConnectionService } from './connection-service'
import { TokenCipher } from './token-cipher'
import { GOOGLE_CALENDAR_SCOPES } from './types'

describe('GoogleConnectionService', () => {
  it('stores only an encrypted refresh token and decrypts it for the adapter', () => {
    const database = createTestDatabase()
    const service = new GoogleConnectionService(
      database,
      new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(13))),
    )

    try {
      service.connect('plain-refresh-token', [...GOOGLE_CALENDAR_SCOPES])

      const stored = database.sqlite
        .prepare('select refresh_token_ciphertext from google_connections where id = 1')
        .get() as { refresh_token_ciphertext: string }

      expect(stored.refresh_token_ciphertext).not.toContain('plain-refresh-token')
      expect(service.refreshToken()).toBe('plain-refresh-token')
      expect(service.status().connected).toBe(true)
    } finally {
      database.close()
    }
  })

  it('refuses a connection missing either read-only scope', () => {
    const database = createTestDatabase()
    const service = new GoogleConnectionService(
      database,
      new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(14))),
    )

    try {
      expect(() =>
        service.connect('plain-refresh-token', [GOOGLE_CALENDAR_SCOPES[0]]),
      ).toThrow('GOOGLE_REQUIRED_SCOPES_MISSING')
    } finally {
      database.close()
    }
  })
})
