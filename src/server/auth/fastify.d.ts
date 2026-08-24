import type { AdminAuthContext } from './admin-routes'

declare module 'fastify' {
  interface FastifyInstance {
    adminAuth: AdminAuthContext
  }
}
