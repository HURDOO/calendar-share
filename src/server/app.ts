import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'

import { registerAdminAuth, type RegisterAdminAuthOptions } from './auth/admin-routes'
import type { RuntimeConfig } from './config'
import type { AppDatabase } from './db/database'
import {
  registerGoogleFeature,
  type RegisterGoogleFeatureOptions,
} from './google/google-feature'
import { registerResponsePolicy } from './security/response-policy'
import { registerShareFeature } from './shares/share-feature'

export const LOGGER_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.x-csrf-token',
  'req.headers.x-goog-channel-token',
  'req.headers.x-goog-resource-id',
  'req.body.code',
  'req.body.password',
  'req.body.token',
  'req.originalUrl',
  'req.params.token',
  'req.query.code',
  'req.query.state',
  'req.raw.url',
  'req.url',
  'res.headers.set-cookie',
] as const

interface BuildServerOptions {
  readonly adminAuth: Omit<RegisterAdminAuthOptions, 'appBaseUrl' | 'secureCookie'>
  readonly appBaseUrl: string
  readonly database: AppDatabase
  readonly publicDir?: string
  readonly logger?: boolean
  readonly logLevel?: RuntimeConfig['logLevel']
  readonly secureCookies?: boolean
  readonly timeZone?: string
  readonly trustProxy?: string
  readonly google?: Omit<
    RegisterGoogleFeatureOptions,
    'appBaseUrl' | 'database' | 'secureCookie'
  >
}

export async function buildServer(options: BuildServerOptions) {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: options.logger
      ? {
          level: options.logLevel ?? 'info',
          redact: {
            paths: [...LOGGER_REDACTION_PATHS],
            censor: '[Redacted]',
          },
        }
      : false,
    requestTimeout: 15_000,
    trustProxy: options.trustProxy ?? false,
  })

  registerResponsePolicy(app, {
    secureTransport: options.secureCookies ?? false,
  })

  app.setErrorHandler((error, request, reply) => {
    const statusCode = safeStatusCode(error)
    if (statusCode >= 500) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Request failed without exposing internal details',
      )
      return reply.code(500).send({ code: 'INTERNAL_ERROR' })
    }
    return reply
      .code(statusCode)
      .send({ code: statusCode === 413 ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST' })
  })

  app.decorate('database', options.database)
  app.addHook('onClose', async () => {
    options.database.close()
  })

  app.get('/health/live', async () => ({ status: 'ok' }))
  app.get('/health/ready', async (_request, reply) => {
    try {
      app.database.assertReady()
      return { status: 'ok', phase: 'database' }
    } catch {
      return reply.code(503).send({ status: 'unavailable' })
    }
  })
  app.get('/api/v1/meta', async () => ({
    name: '캘공',
    phase: 'security-hardening',
  }))

  await registerAdminAuth(app, {
    ...options.adminAuth,
    appBaseUrl: options.appBaseUrl,
    secureCookie: options.secureCookies ?? false,
  })

  await registerShareFeature(app, {
    appBaseUrl: options.appBaseUrl,
    database: options.database,
    ...(options.adminAuth.now ? { now: options.adminAuth.now } : {}),
    secureCookie: options.secureCookies ?? false,
    timeZone: options.timeZone ?? 'Asia/Seoul',
  })

  if (options.google) {
    await registerGoogleFeature(app, {
      ...options.google,
      appBaseUrl: options.appBaseUrl,
      database: options.database,
      onEventsChanged: () => app.shareFeature.realtime.publishAll(),
      secureCookie: options.secureCookies ?? false,
    })
  }

  if (options.publicDir) {
    await app.register(fastifyStatic, {
      root: options.publicDir,
      prefix: '/',
    })

    app.setNotFoundHandler(async (request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/health/')
      ) {
        return reply.sendFile('index.html')
      }

      return reply.code(404).send({ code: 'NOT_FOUND' })
    })
  }

  return app
}

function safeStatusCode(error: unknown): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return error.statusCode
  }
  return 500
}
