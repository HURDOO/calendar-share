import { describe, expect, it } from 'vitest'

import { encodeSecretMaterial } from '../../shared/secrets'
import { ConfigurationError } from '../config'
import { loadAdminAuthSecrets } from './config'

const verifier = '$scrypt$ln=10,r=8,p=1$YWJjZGVmZ2hpamtsbW5vcA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU'

describe('loadAdminAuthSecrets', () => {
  it('loads names-only authentication secrets without exposing their values', () => {
    const sessionSecret = encodeSecretMaterial(new Uint8Array(32).fill(3))

    expect(
      loadAdminAuthSecrets({
        ADMIN_PASSWORD_HASH: verifier,
        SESSION_SECRET: sessionSecret,
      }),
    ).toEqual({ passwordVerifier: verifier, sessionSecret })
  })

  it('reports missing names only', () => {
    expect(() => loadAdminAuthSecrets({})).toThrow(
      new ConfigurationError(
        'Missing required environment variables: ADMIN_PASSWORD_HASH, SESSION_SECRET',
      ),
    )
  })

  it('rejects malformed values without echoing them', () => {
    const invalidValue = 'not-a-valid-secret'

    expect(() =>
      loadAdminAuthSecrets({
        ADMIN_PASSWORD_HASH: invalidValue,
        SESSION_SECRET: invalidValue,
      }),
    ).toThrow('Invalid environment variables: ADMIN_PASSWORD_HASH')

    try {
      loadAdminAuthSecrets({
        ADMIN_PASSWORD_HASH: invalidValue,
        SESSION_SECRET: invalidValue,
      })
    } catch (error) {
      expect(String(error)).not.toContain(invalidValue)
    }
  })
})
