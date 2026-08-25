import type { FastifyInstance } from 'fastify'

import type { AppDatabase } from '../db/database'
import { SharePolicyService } from './policy-service'
import { ShareRealtimeBroker } from './realtime-broker'
import { registerShareRoutes } from './share-routes'
import { ShareService } from './share-service'
import { VisitorSessionService } from './visitor-session-service'

export interface ShareFeatureContext {
  readonly policy: SharePolicyService
  readonly realtime: ShareRealtimeBroker
  readonly shares: ShareService
  readonly visitors: VisitorSessionService
}

interface RegisterShareFeatureOptions {
  readonly appBaseUrl: string
  readonly database: AppDatabase
  readonly linkSecret: string
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
  const realtime = new ShareRealtimeBroker()
  const shares = new ShareService(
    options.database,
    options.appBaseUrl,
    options.linkSecret,
    now,
  )
  const visitors = new VisitorSessionService(options.database, policy, now)
  app.decorate('shareFeature', { policy, realtime, shares, visitors })
  await registerShareRoutes(app, { secureCookie: options.secureCookie })
}
