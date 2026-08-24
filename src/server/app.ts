import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'

import { registerAdminAuth, type RegisterAdminAuthOptions } from './auth/admin-routes'
import type { RuntimeConfig } from './config'
import type { AppDatabase } from './db/database'

export const LOGGER_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.x-csrf-token',
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
}

export async function buildServer(options: BuildServerOptions) {
  const app = Fastify({
    logger: options.logger
      ? {
          level: options.logLevel ?? 'info',
          redact: {
            paths: [...LOGGER_REDACTION_PATHS],
            censor: '[Redacted]',
          },
        }
      : false,
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
    phase: 'database',
  }))

  await registerAdminAuth(app, {
    ...options.adminAuth,
    appBaseUrl: options.appBaseUrl,
    secureCookie: options.secureCookies ?? false,
  })

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
