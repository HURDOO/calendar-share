import { ConfigurationError } from '../config'

export interface AdminAuthSecrets {
  readonly passwordVerifier: string
  readonly sessionSecret: string
}

const verifierPattern =
  /^\$scrypt\$ln=\d+,r=\d+,p=\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/

export function loadAdminAuthSecrets(
  environment: NodeJS.ProcessEnv = process.env,
): AdminAuthSecrets {
  const missingNames = ['ADMIN_PASSWORD_HASH', 'SESSION_SECRET'].filter(
    (name) => !environment[name]?.trim(),
  )

  if (missingNames.length > 0) {
    throw new ConfigurationError(
      `Missing required environment variables: ${missingNames.join(', ')}`,
    )
  }

  const passwordVerifier = environment.ADMIN_PASSWORD_HASH ?? ''
  const sessionSecret = environment.SESSION_SECRET ?? ''
  const sessionSecretBytes = Buffer.from(sessionSecret, 'base64url')

  if (!verifierPattern.test(passwordVerifier)) {
    throw new ConfigurationError('Invalid environment variables: ADMIN_PASSWORD_HASH')
  }

  if (
    !/^[A-Za-z0-9_-]+$/.test(sessionSecret) ||
    sessionSecretBytes.length < 32 ||
    sessionSecretBytes.toString('base64url') !== sessionSecret
  ) {
    throw new ConfigurationError('Invalid environment variables: SESSION_SECRET')
  }

  return { passwordVerifier, sessionSecret }
}
