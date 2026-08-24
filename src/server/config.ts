import { isIP } from 'node:net'

import { z } from 'zod'

export const REQUIRED_SECRET_NAMES = [
  'ADMIN_PASSWORD_HASH',
  'SESSION_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
] as const

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8465),
  APP_BASE_URL: z.string().url().default('http://localhost:8464'),
  APP_TIME_ZONE: z.string().min(1).default('Asia/Seoul'),
  STORAGE_DIR: z.string().min(1).default('./data'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TRUST_PROXY: z
    .string()
    .trim()
    .min(1)
    .refine(isTrustedProxyList)
    .default('127.0.0.1,::1'),
})

export class ConfigurationError extends Error {
  readonly code = 'INVALID_CONFIGURATION'

  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

export interface RuntimeConfig {
  readonly nodeEnv: 'development' | 'test' | 'production'
  readonly host: string
  readonly port: number
  readonly appBaseUrl: string
  readonly appTimeZone: string
  readonly storageDir: string
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  readonly trustProxy: string
}

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const result = environmentSchema.safeParse(environment)

  if (!result.success) {
    const invalidNames = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? 'environment'))),
    ].sort()

    throw new ConfigurationError(
      `Invalid environment variables: ${invalidNames.join(', ')}`,
    )
  }

  if (result.data.NODE_ENV === 'production') {
    const missingSecrets = REQUIRED_SECRET_NAMES.filter(
      (name) => !environment[name]?.trim(),
    )

    if (missingSecrets.length > 0) {
      throw new ConfigurationError(
        `Missing required environment variables: ${missingSecrets.join(', ')}`,
      )
    }
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    host: result.data.HOST,
    port: result.data.PORT,
    appBaseUrl: result.data.APP_BASE_URL,
    appTimeZone: result.data.APP_TIME_ZONE,
    storageDir: result.data.STORAGE_DIR,
    logLevel: result.data.LOG_LEVEL,
    trustProxy: result.data.TRUST_PROXY,
  }
}

function isTrustedProxyList(value: string): boolean {
  return value.split(',').every((rawEntry) => {
    const [address = '', prefix, ...extra] = rawEntry.trim().split('/')
    const version = isIP(address)
    if (version === 0 || extra.length > 0) {
      return false
    }
    if (prefix === undefined) {
      return true
    }
    if (!/^\d+$/.test(prefix)) {
      return false
    }
    const bits = Number(prefix)
    return bits >= 0 && bits <= (version === 4 ? 32 : 128)
  })
}
