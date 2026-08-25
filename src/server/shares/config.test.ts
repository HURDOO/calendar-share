import { describe, expect, it } from 'vitest'

import { encodeSecretMaterial } from '../../shared/secrets'
import { loadShareSecrets } from './config'

describe('loadShareSecrets', () => {
  it('accepts canonical 32-byte base64url key material', () => {
    const value = encodeSecretMaterial(new Uint8Array(32).fill(7))

    expect(loadShareSecrets({ SHARE_LINK_SECRET: value })).toEqual({
      linkSecret: value,
    })
  })

  it('reports only the variable name for missing or invalid material', () => {
    expect(() => loadShareSecrets({})).toThrow(
      'Missing required environment variables: SHARE_LINK_SECRET',
    )
    expect(() => loadShareSecrets({ SHARE_LINK_SECRET: 'sensitive-invalid' })).toThrow(
      'Invalid environment variables: SHARE_LINK_SECRET',
    )

    try {
      loadShareSecrets({ SHARE_LINK_SECRET: 'sensitive-invalid' })
    } catch (error) {
      expect(String(error)).not.toContain('sensitive-invalid')
    }
  })
})
