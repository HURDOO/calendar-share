import { ConfigurationError } from '../config'

export interface ShareSecrets {
  readonly linkSecret: string
}

export function loadShareSecrets(
  environment: NodeJS.ProcessEnv = process.env,
): ShareSecrets {
  const linkSecret = environment.SHARE_LINK_SECRET?.trim() ?? ''
  const keyBytes = Buffer.from(linkSecret, 'base64url')

  if (!linkSecret) {
    throw new ConfigurationError(
      'Missing required environment variables: SHARE_LINK_SECRET',
    )
  }

  if (
    !/^[A-Za-z0-9_-]+$/.test(linkSecret) ||
    keyBytes.length !== 32 ||
    keyBytes.toString('base64url') !== linkSecret
  ) {
    throw new ConfigurationError('Invalid environment variables: SHARE_LINK_SECRET')
  }

  return { linkSecret }
}
