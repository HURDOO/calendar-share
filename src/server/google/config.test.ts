import { describe, expect, it } from 'vitest'

import { encodeSecretMaterial } from '../../shared/secrets'
import { ConfigurationError } from '../config'
import { loadGoogleSecrets } from './config'

describe('loadGoogleSecrets', () => {
  it('validates a 256-bit token encryption key', () => {
    const tokenEncryptionKey = encodeSecretMaterial(new Uint8Array(32).fill(9))

    expect(
      loadGoogleSecrets({
        GOOGLE_CLIENT_ID: 'fixture-client-id',
        GOOGLE_CLIENT_SECRET: 'fixture-client-secret',
        GOOGLE_TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
      }),
    ).toEqual({
      clientId: 'fixture-client-id',
      clientSecret: 'fixture-client-secret',
      tokenEncryptionKey,
    })
  })

  it('reports missing variable names without values', () => {
    expect(() => loadGoogleSecrets({})).toThrow(
      new ConfigurationError(
        'Missing required environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_ENCRYPTION_KEY',
      ),
    )
  })
})
