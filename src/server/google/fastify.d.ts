import type { GoogleFeatureContext } from './google-feature'

declare module 'fastify' {
  interface FastifyInstance {
    googleFeature: GoogleFeatureContext
  }
}
