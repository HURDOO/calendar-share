import { describe, expect, it } from 'vitest'

import { encodeSecretMaterial } from '../../shared/secrets'
import { TokenCipher } from './token-cipher'

describe('TokenCipher', () => {
  const cipher = new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(11)))

  it('round trips tokens with authenticated encryption', () => {
    const encrypted = cipher.encrypt('refresh-token-value', 'google-refresh-token')

    expect(encrypted).not.toContain('refresh-token-value')
    expect(cipher.decrypt(encrypted, 'google-refresh-token')).toBe(
      'refresh-token-value',
    )
  })

  it('rejects a different purpose and tampered ciphertext', () => {
    const encrypted = cipher.encrypt('refresh-token-value', 'google-refresh-token')
    const parts = encrypted.split('.')
    const ciphertext = parts[2] ?? ''
    parts[2] = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`
    const tampered = parts.join('.')

    expect(() => cipher.decrypt(encrypted, 'oauth-transaction')).toThrow()
    expect(() => cipher.decrypt(tampered, 'google-refresh-token')).toThrow()
  })
})
