import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'

import { OAUTH_TRANSACTION_TIMEOUT_MS } from './oauth-service'

export const GOOGLE_OAUTH_TRANSACTION_COOKIE = 'calendar_google_oauth'

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(512).optional(),
  state: z.string().min(1).max(512).optional(),
})
const syncJobParamsSchema = z.object({ jobId: z.string().uuid() })

interface GoogleRoutesOptions {
  readonly secureCookie: boolean
}

export async function registerGoogleRoutes(
  app: FastifyInstance,
  options: GoogleRoutesOptions,
): Promise<void> {
  app.post('/api/v1/admin/google/connect', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    const session = app.adminAuth.requireSession(request, reply)
    if (!session) {
      return reply
    }
    if (!app.adminAuth.verifyMutation(request, session)) {
      return reply.code(403).send({ code: 'CSRF_REJECTED' })
    }

    const result = app.googleFeature.oauth.begin(session.id)
    reply.setCookie(GOOGLE_OAUTH_TRANSACTION_COOKIE, result.transaction, {
      httpOnly: true,
      maxAge: OAUTH_TRANSACTION_TIMEOUT_MS / 1000,
      path: '/api/v1/admin/google/callback',
      priority: 'high',
      sameSite: 'lax',
      secure: options.secureCookie,
    })
    return { authorizationUrl: result.authorizationUrl }
  })

  app.get('/api/v1/admin/google/callback', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    const session = app.adminAuth.authenticate(request)
    const parsed = callbackQuerySchema.safeParse(request.query)
    const transaction = request.cookies[GOOGLE_OAUTH_TRANSACTION_COOKIE]
    clearOAuthCookie(reply, options.secureCookie)

    if (
      !session ||
      !parsed.success ||
      parsed.data.error ||
      !parsed.data.code ||
      !parsed.data.state ||
      !transaction
    ) {
      return reply.redirect('/admin?google=error')
    }

    try {
      await app.googleFeature.oauth.complete(
        transaction,
        parsed.data.state,
        parsed.data.code,
        session.id,
      )
      app.googleFeature.queue.enqueue('CALENDAR_LIST_SYNC', 'calendar-list')
      return reply.redirect('/admin?google=connected')
    } catch (error) {
      request.log.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Google OAuth callback rejected',
      )
      return reply.redirect('/admin?google=error')
    }
  })

  app.get('/api/v1/admin/google/status', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    if (!app.adminAuth.requireSession(request, reply)) {
      return reply
    }
    return app.googleFeature.status()
  })

  app.post('/api/v1/admin/google/sync', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    const session = app.adminAuth.requireSession(request, reply)
    if (!session) {
      return reply
    }
    if (!app.adminAuth.verifyMutation(request, session)) {
      return reply.code(403).send({ code: 'CSRF_REJECTED' })
    }
    if (!app.googleFeature.connection.status().connected) {
      return reply.code(409).send({ code: 'GOOGLE_NOT_CONNECTED' })
    }

    const job = app.googleFeature.queue.enqueueTracked(
      'RECOVERY_SYNC',
      'recovery-sync',
    )
    return reply.code(202).send({
      jobId: job.id,
      queued: job.enqueued,
    })
  })

  app.get('/api/v1/admin/google/sync/:jobId', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    if (!app.adminAuth.requireSession(request, reply)) {
      return reply
    }
    const parsed = syncJobParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' })
    }
    const job = app.googleFeature.queue.status(parsed.data.jobId)
    if (!job || job.kind !== 'RECOVERY_SYNC') {
      return reply.code(404).send({ code: 'SYNC_JOB_NOT_FOUND' })
    }
    return {
      ...job,
      lastSyncedAt: app.googleFeature.status().lastSyncedAt,
    }
  })

  app.delete('/api/v1/admin/google/connection', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    const session = app.adminAuth.requireSession(request, reply)
    if (!session) {
      return reply
    }
    if (!app.adminAuth.verifyMutation(request, session)) {
      return reply.code(403).send({ code: 'CSRF_REJECTED' })
    }

    await app.googleFeature.disconnect()
    return reply.code(204).send()
  })

  app.post('/api/v1/google/webhook', async (request, reply) => {
    const headers = {
      channelId: singleHeader(request.headers['x-goog-channel-id']),
      channelToken: singleHeader(request.headers['x-goog-channel-token']),
      messageNumber: singleHeader(request.headers['x-goog-message-number']),
      resourceId: singleHeader(request.headers['x-goog-resource-id']),
      resourceState: singleHeader(request.headers['x-goog-resource-state']),
    }
    app.googleFeature.watch.acceptNotification(
      Object.fromEntries(
        Object.entries(headers).filter((entry) => entry[1] !== undefined),
      ),
    )
    return reply.code(204).send()
  })
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function setPrivateResponseHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store')
  reply.header('Vary', 'Cookie')
}

function clearOAuthCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(GOOGLE_OAUTH_TRANSACTION_COOKIE, {
    httpOnly: true,
    path: '/api/v1/admin/google/callback',
    sameSite: 'lax',
    secure,
  })
}
