import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const algorithm = 'aes-256-gcm'
const version = 'v1'

export class TokenCipher {
  private readonly key: Buffer

  constructor(encodedKey: string) {
    const key = Buffer.from(encodedKey, 'base64url')
    if (key.length !== 32) {
      throw new Error('Token encryption key must contain 256 bits')
    }

    this.key = key
  }

  encrypt(plaintext: string, purpose: string): string {
    const initializationVector = randomBytes(12)
    const cipher = createCipheriv(algorithm, this.key, initializationVector)
    cipher.setAAD(Buffer.from(`${version}:${purpose}`, 'utf8'))
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const authenticationTag = cipher.getAuthTag()

    return [
      version,
      initializationVector.toString('base64url'),
      ciphertext.toString('base64url'),
      authenticationTag.toString('base64url'),
    ].join('.')
  }

  decrypt(encoded: string, purpose: string): string {
    const [encodedVersion, encodedIv, encodedCiphertext, encodedTag, extra] =
      encoded.split('.')

    if (
      encodedVersion !== version ||
      !encodedIv ||
      !encodedCiphertext ||
      !encodedTag ||
      extra
    ) {
      throw new Error('Encrypted token format is invalid')
    }

    const decipher = createDecipheriv(
      algorithm,
      this.key,
      Buffer.from(encodedIv, 'base64url'),
    )
    decipher.setAAD(Buffer.from(`${version}:${purpose}`, 'utf8'))
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))

    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
}
