import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

export interface ScryptParameters {
  readonly n: number
  readonly r: number
  readonly p: number
  readonly keyLength: number
  readonly saltLength: number
  readonly maxmem: number
}

export const DEFAULT_SCRYPT_PARAMETERS: ScryptParameters = {
  n: 2 ** 17,
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16,
  maxmem: 256 * 1024 * 1024,
}

function deriveKey(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      parameters.keyLength,
      {
        N: parameters.n,
        r: parameters.r,
        p: parameters.p,
        maxmem: parameters.maxmem,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }

        resolve(derivedKey)
      },
    )
  })
}

function parseVerifier(verifier: string): {
  readonly parameters: ScryptParameters
  readonly salt: Buffer
  readonly expected: Buffer
} | null {
  const match =
    /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(
      verifier,
    )

  if (!match) {
    return null
  }

  const logN = Number(match[1])
  const r = Number(match[2])
  const p = Number(match[3])

  if (!Number.isInteger(logN) || logN < 10 || logN > 17) {
    return null
  }

  if (!Number.isInteger(r) || r < 1 || r > 8 || !Number.isInteger(p) || p < 1 || p > 4) {
    return null
  }

  const salt = Buffer.from(match[4] ?? '', 'base64url')
  const expected = Buffer.from(match[5] ?? '', 'base64url')

  if (salt.length < 16 || expected.length < 32) {
    return null
  }

  return {
    parameters: {
      n: 2 ** logN,
      r,
      p,
      keyLength: expected.length,
      saltLength: salt.length,
      maxmem: DEFAULT_SCRYPT_PARAMETERS.maxmem,
    },
    salt,
    expected,
  }
}

export async function hashPassword(
  password: string,
  parameters: ScryptParameters = DEFAULT_SCRYPT_PARAMETERS,
): Promise<string> {
  const logN = Math.log2(parameters.n)

  if (!Number.isInteger(logN)) {
    throw new Error('scrypt N must be a power of two')
  }

  const salt = randomBytes(parameters.saltLength)
  const derivedKey = await deriveKey(password, salt, parameters)

  return [
    '$scrypt',
    `ln=${logN},r=${parameters.r},p=${parameters.p}`,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(password: string, verifier: string): Promise<boolean> {
  const parsed = parseVerifier(verifier)

  if (!parsed) {
    return false
  }

  const actual = await deriveKey(password, parsed.salt, parsed.parameters)

  return actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected)
}

export function encodeSecretMaterial(material: Uint8Array): string {
  return Buffer.from(material).toString('base64url')
}

export function generateSecret(): string {
  return encodeSecretMaterial(randomBytes(32))
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('base64url')
}

export function secretsMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')

  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  )
}
