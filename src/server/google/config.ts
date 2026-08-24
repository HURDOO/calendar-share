import { ConfigurationError } from '../config'

export interface GoogleSecrets {
  readonly clientId: string
  readonly clientSecret: string
  readonly tokenEncryptionKey: string
}

export function loadGoogleSecrets(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleSecrets {
  const names = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_TOKEN_ENCRYPTION_KEY',
  ] as const
  const missingNames = names.filter((name) => !environment[name]?.trim())

  if (missingNames.length > 0) {
    throw new ConfigurationError(
      `Missing required environment variables: ${missingNames.join(', ')}`,
    )
  }

  const clientId = environment.GOOGLE_CLIENT_ID ?? ''
  const clientSecret = environment.GOOGLE_CLIENT_SECRET ?? ''
  const tokenEncryptionKey = environment.GOOGLE_TOKEN_ENCRYPTION_KEY ?? ''
  const keyBytes = Buffer.from(tokenEncryptionKey, 'base64url')

  if (
    !/^[A-Za-z0-9_-]+$/.test(tokenEncryptionKey) ||
    keyBytes.length !== 32 ||
    keyBytes.toString('base64url') !== tokenEncryptionKey
  ) {
    throw new ConfigurationError(
      'Invalid environment variables: GOOGLE_TOKEN_ENCRYPTION_KEY',
    )
  }

  return { clientId, clientSecret, tokenEncryptionKey }
}
