import type { FastifyInstance, FastifyReply } from 'fastify'

import type { AppDatabase } from '../db/database'
import type { OperationsMetrics } from './metrics'

interface RegisterOperationsRoutesOptions {
  readonly database: AppDatabase
  readonly metrics: OperationsMetrics
}

export async function registerOperationsRoutes(
  app: FastifyInstance,
  options: RegisterOperationsRoutesOptions,
): Promise<void> {
  app.get('/api/v1/admin/operations', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    if (!app.adminAuth.requireSession(request, reply)) {
      return reply
    }
    return options.metrics.snapshot(options.database)
  })
}

function setPrivateResponseHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store')
  reply.header('Vary', 'Cookie')
}
