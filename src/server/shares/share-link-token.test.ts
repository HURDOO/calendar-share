import { describe, expect, it } from 'vitest'

import { encodeSecretMaterial } from '../../shared/secrets'
import { ShareLinkTokenFactory } from './share-link-token'

describe('ShareLinkTokenFactory', () => {
  it('derives stable 256-bit tokens separated by share and version', () => {
    const factory = new ShareLinkTokenFactory(
      encodeSecretMaterial(new Uint8Array(32).fill(5)),
    )
    const first = factory.create('share-one', 1)

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(factory.create('share-one', 1)).toBe(first)
    expect(factory.create('share-one', 2)).not.toBe(first)
    expect(factory.create('share-two', 1)).not.toBe(first)
  })
})
