import type { AppDatabase } from './database'

declare module 'fastify' {
  interface FastifyInstance {
    database: AppDatabase
  }
}
