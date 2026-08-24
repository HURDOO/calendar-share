import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SCRYPT_PARAMETERS,
  encodeSecretMaterial,
  hashSecret,
  hashPassword,
  secretsMatch,
  verifyPassword,
} from './secrets'

const lightweightTestParameters = {
  n: 2 ** 10,
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16,
  maxmem: 8 * 1024 * 1024,
} as const

describe('secret utilities', () => {
  it('keeps the OWASP scrypt work factors as production defaults', () => {
    expect(DEFAULT_SCRYPT_PARAMETERS).toMatchObject({
      n: 2 ** 17,
      r: 8,
      p: 1,
    })
  })

  it('creates and verifies a self-describing password verifier', async () => {
    const verifier = await hashPassword('fixture-password', lightweightTestParameters)

    await expect(verifyPassword('fixture-password', verifier)).resolves.toBe(true)
    await expect(verifyPassword('different-password', verifier)).resolves.toBe(false)
  })

  it('encodes exactly 256 bits as base64url without padding', () => {
    const encoded = encodeSecretMaterial(new Uint8Array(32).fill(7))

    expect(encoded).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(encoded).not.toContain('=')
  })

  it('hashes opaque tokens and compares encoded values safely', () => {
    const first = hashSecret('first-token')
    const repeated = hashSecret('first-token')
    const different = hashSecret('different-token')

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first).toBe(repeated)
    expect(first).not.toBe(different)
    expect(secretsMatch(first, repeated)).toBe(true)
    expect(secretsMatch(first, different)).toBe(false)
  })
})
