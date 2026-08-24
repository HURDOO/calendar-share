import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'

import type { RuntimeConfig } from './config'
import type { AppDatabase } from './db/database'

interface BuildServerOptions {
  readonly database: AppDatabase
  readonly publicDir?: string
  readonly logger?: boolean
  readonly logLevel?: RuntimeConfig['logLevel']
}

export async function buildServer(options: BuildServerOptions) {
  const app = Fastify({
    logger: options.logger
      ? {
          level: options.logLevel ?? 'info',
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'req.url'],
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
