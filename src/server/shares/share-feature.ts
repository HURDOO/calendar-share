import type { FastifyInstance } from 'fastify'

import type { AppDatabase } from '../db/database'
import { SharePolicyService } from './policy-service'
import { registerShareRoutes } from './share-routes'
import { ShareService } from './share-service'
import { VisitorSessionService } from './visitor-session-service'

export interface ShareFeatureContext {
  readonly policy: SharePolicyService
  readonly shares: ShareService
  readonly visitors: VisitorSessionService
}

interface RegisterShareFeatureOptions {
  readonly appBaseUrl: string
  readonly database: AppDatabase
  readonly secureCookie: boolean
  readonly timeZone: string
  readonly now?: () => Date
}

export async function registerShareFeature(
  app: FastifyInstance,
  options: RegisterShareFeatureOptions,
): Promise<void> {
  const now = options.now ?? (() => new Date())
  const policy = new SharePolicyService(options.database, options.timeZone, now)
  const shares = new ShareService(options.database, options.appBaseUrl, now)
  const visitors = new VisitorSessionService(options.database, policy, now)
  app.decorate('shareFeature', { policy, shares, visitors })
  await registerShareRoutes(app, { secureCookie: options.secureCookie })
}
