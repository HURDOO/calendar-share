import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z, ZodError } from 'zod'

import type { AuthenticatedAdminSession } from '../auth/admin-service'
import { shareIdParamsSchema, shareWriteSchema } from './share-types'
import { ShareServiceError } from './share-service'

export const VISITOR_SESSION_COOKIE = 'calendar_visitor_session'

const shareTokenParamsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})

interface ShareRoutesOptions {
  readonly secureCookie: boolean
}

export async function registerShareRoutes(
  app: FastifyInstance,
  options: ShareRoutesOptions,
): Promise<void> {
  app.get('/api/v1/admin/calendars', async (request, reply) => {
    setPrivateHeaders(reply)
    if (!app.adminAuth.requireSession(request, reply)) {
      return reply
    }
    const rows = app.database.sqlite
      .prepare(`
        select id, display_name, color, time_zone, is_primary, sync_status
        from calendars where is_active = 1 order by is_primary desc, display_name, id
      `)
      .all() as Array<{
      id: string
      display_name: string
      color: string | null
      time_zone: string | null
      is_primary: 0 | 1
      sync_status: string
    }>
    return {
      calendars: rows.map((row) => ({
        id: row.id,
        name: row.display_name,
        color: row.color,
        timeZone: row.time_zone,
        isPrimary: row.is_primary === 1,
        syncStatus: row.sync_status,
      })),
    }
  })

  app.get('/api/v1/admin/shares', async (request, reply) => {
    setPrivateHeaders(reply)
    if (!app.adminAuth.requireSession(request, reply)) {
      return reply
    }
    return { shares: app.shareFeature.shares.list() }
  })

  app.post('/api/v1/admin/shares', async (request, reply) => {
    setPrivateHeaders(reply)
    const session = requireAdminMutation(app, request, reply)
    if (!session) {
      return reply
    }
    const parsed = shareWriteSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' })
    }

    try {
      return reply.code(201).send(app.shareFeature.shares.create(parsed.data))
    } catch (error) {
      return sendShareError(error, reply)
    }
  })

  app.get('/api/v1/admin/shares/:id', async (request, reply) => {
    setPrivateHeaders(reply)
    if (!app.adminAuth.requireSession(request, reply)) {
      return reply
    }
    const parsed = shareIdParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' })
    }
    const share = app.shareFeature.shares.get(parsed.data.id)
    return share
      ? reply.send({ share })
      : reply.code(404).send({ code: 'SHARE_NOT_FOUND' })
  })

  app.put('/api/v1/admin/shares/:id', async (request, reply) => {
    setPrivateHeaders(reply)
    const session = requireAdminMutation(app, request, reply)
    if (!session) {
      return reply
    }
    const parsedParams = shareIdParamsSchema.safeParse(request.params)
    const parsedBody = shareWriteSchema.safeParse(request.body)
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' })
    }
    try {
      return { share: app.shareFeature.shares.update(parsedParams.data.id, parsedBody.data) }
    } catch (error) {
      return sendShareError(error, reply)
    }
  })

  app.delete('/api/v1/admin/shares/:id', async (request, reply) => {
    setPrivateHeaders(reply)
    const session = requireAdminMutation(app, request, reply)
    if (!session) {
      return reply
    }
    const parsed = shareIdParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' })
    }
    try {
      app.shareFeature.shares.revoke(parsed.data.id)
      return reply.code(204).send()
    } catch (error) {
      return sendShareError(error, reply)
    }
  })

  app.post('/api/v1/admin/shares/:id/rotate-token', async (request, reply) => {
    setPrivateHeaders(reply)
    const session = requireAdminMutation(app, request, reply)
    if (!session) {
      return reply
    }
    const parsed = shareIdParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' })
    }
    try {
      return app.shareFeature.shares.rotateToken(parsed.data.id)
    } catch (error) {
      return sendShareError(error, reply)
    }
  })

  app.get('/api/v1/admin/shares/:id/preview', async (request, reply) => {
    setPrivateHeaders(reply)
    if (!app.adminAuth.requireSession(request, reply)) {
      return reply
    }
    const parsed = shareIdParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' })
    }
    const result = app.shareFeature.policy.evaluate(parsed.data.id)
    return result.availability === 'NOT_FOUND'
      ? reply.code(404).send({ code: 'SHARE_NOT_FOUND' })
      : reply.send(result)
  })

  app.get('/s/:token', async (request, reply) => {
    setExchangeHeaders(reply)
    const parsed = shareTokenParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      clearVisitorCookie(reply, options.secureCookie)
      return reply.redirect('/share/unavailable')
    }
    const exchanged = app.shareFeature.visitors.exchangeShareToken(
      parsed.data.token,
    )
    if (!exchanged) {
      clearVisitorCookie(reply, options.secureCookie)
      return reply.redirect('/share/unavailable')
    }

    reply.setCookie(VISITOR_SESSION_COOKIE, exchanged.token, {
      expires: exchanged.session.expiresAt,
      httpOnly: true,
      maxAge: exchanged.maxAgeSeconds,
      path: '/',
      priority: 'high',
      sameSite: 'lax',
      secure: options.secureCookie,
    })
    return reply.redirect(`/share/${exchanged.session.shareId}`)
  })

  app.get('/api/v1/public/events', async (request, reply) => {
    setPrivateHeaders(reply)
    const token = request.cookies[VISITOR_SESSION_COOKIE]
    const session = token
      ? app.shareFeature.visitors.authenticate(token)
      : null
    if (!session) {
      clearVisitorCookie(reply, options.secureCookie)
      return reply.code(401).send({ code: 'SHARE_ACCESS_UNAVAILABLE' })
    }
    const result = app.shareFeature.policy.evaluate(session.shareId)
    if (result.availability !== 'AVAILABLE') {
      clearVisitorCookie(reply, options.secureCookie)
      return reply.code(403).send({ code: 'SHARE_ACCESS_UNAVAILABLE' })
    }
    return result
  })
}

function requireAdminMutation(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): AuthenticatedAdminSession | null {
  const session = app.adminAuth.requireSession(request, reply)
  if (!session) {
    return null
  }
  if (!app.adminAuth.verifyMutation(request, session)) {
    void reply.code(403).send({ code: 'CSRF_REJECTED' })
    return null
  }
  return session
}

function sendShareError(error: unknown, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.code(400).send({ code: 'INVALID_REQUEST' })
  }
  if (error instanceof ShareServiceError) {
    switch (error.code) {
      case 'SHARE_NOT_FOUND':
        return reply.code(404).send({ code: error.code })
      case 'SHARE_REVOKED':
      case 'CALENDAR_INVALID':
        return reply.code(409).send({ code: error.code })
    }
  }
  throw error
}

function setPrivateHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store')
  reply.header('Vary', 'Cookie')
}

function setExchangeHeaders(reply: FastifyReply): void {
  setPrivateHeaders(reply)
  reply.header('Referrer-Policy', 'no-referrer')
  reply.header('X-Robots-Tag', 'noindex, nofollow')
}

function clearVisitorCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(VISITOR_SESSION_COOKIE, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure,
  })
}
