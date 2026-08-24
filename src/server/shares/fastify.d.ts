import type { ShareFeatureContext } from './share-feature'

declare module 'fastify' {
  interface FastifyInstance {
    shareFeature: ShareFeatureContext
  }
}
