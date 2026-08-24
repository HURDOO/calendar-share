import cookie from '@fastify/cookie'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { AdminAuthSecrets } from './config'
import {
  ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS,
  type AuthenticatedAdminSession,
  AdminSessionService,
} from './admin-service'
import { LoginRateLimiter } from './rate-limiter'

export const ADMIN_SESSION_COOKIE = 'calendar_admin_session'
export const CSRF_HEADER = 'x-csrf-token'

const loginBodySchema = z.object({
  password: z.string().min(1).max(1024),
})

export interface AdminAuthContext {
  readonly expectedOrigin: string
  readonly service: AdminSessionService
  authenticate(request: FastifyRequest): AuthenticatedAdminSession | null
  requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): AuthenticatedAdminSession | null
  verifyMutation(
    request: FastifyRequest,
    session: AuthenticatedAdminSession,
  ): boolean
}

export interface RegisterAdminAuthOptions extends AdminAuthSecrets {
  readonly appBaseUrl: string
  readonly secureCookie: boolean
  readonly now?: () => Date
  readonly rateLimiter?: LoginRateLimiter
}

export async function registerAdminAuth(
  app: FastifyInstance,
  options: RegisterAdminAuthOptions,
): Promise<void> {
  await app.register(cookie)

  const expectedOrigin = new URL(options.appBaseUrl).origin
  const service = new AdminSessionService({
    database: app.database,
    passwordVerifier: options.passwordVerifier,
    sessionSecret: options.sessionSecret,
    ...(options.now ? { now: options.now } : {}),
  })
  const rateLimiter =
    options.rateLimiter ??
    new LoginRateLimiter({
      maxFailures: 5,
      windowMs: 15 * 60 * 1000,
      ...(options.now ? { now: () => options.now?.().getTime() ?? Date.now() } : {}),
    })

  const context: AdminAuthContext = {
    expectedOrigin,
    service,
    authenticate(request) {
      const token = request.cookies[ADMIN_SESSION_COOKIE]
      return token ? service.authenticate(token) : null
    },
    requireSession(request, reply) {
      const session = this.authenticate(request)

      if (!session) {
        clearSessionCookie(reply, options.secureCookie)
        void reply.code(401).send({ code: 'AUTHENTICATION_REQUIRED' })
        return null
      }

      return session
    },
    verifyMutation(request, session) {
      return (
        request.headers.origin === expectedOrigin &&
        service.verifyCsrf(session.id, request.headers[CSRF_HEADER] as string | undefined)
      )
    },
  }

  app.decorate('adminAuth', context)

  app.post('/api/v1/admin/session', async (request, reply) => {
    setPrivateResponseHeaders(reply)

    if (request.headers.origin !== expectedOrigin) {
      return reply.code(403).send({ code: 'ORIGIN_REJECTED' })
    }

    const rateLimit = rateLimiter.check(request.ip)
    if (rateLimit.blocked) {
      return reply
        .header('Retry-After', String(rateLimit.retryAfterSeconds))
        .code(429)
        .send({ code: 'LOGIN_RATE_LIMITED' })
    }

    const parsedBody = loginBodySchema.safeParse(request.body)
    if (!parsedBody.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' })
    }

    const isValid = await service.verifyCredentials(parsedBody.data.password)
    if (!isValid) {
      rateLimiter.recordFailure(request.ip)
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS' })
    }

    rateLimiter.reset(request.ip)
    const { token, session } = service.createSession()
    const expiresAt = session.expiresAt

    reply.setCookie(ADMIN_SESSION_COOKIE, token, {
      expires: expiresAt,
      httpOnly: true,
      maxAge: ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS / 1000,
      path: '/',
      priority: 'high',
      sameSite: 'lax',
      secure: options.secureCookie,
    })

    return reply.code(201).send({
      authenticated: true,
      csrfToken: session.csrfToken,
      expiresAt: expiresAt.toISOString(),
    })
  })

  app.get('/api/v1/admin/session', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    const session = context.requireSession(request, reply)

    if (!session) {
      return reply
    }

    return {
      authenticated: true,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt.toISOString(),
    }
  })

  app.delete('/api/v1/admin/session', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    const session = context.requireSession(request, reply)

    if (!session) {
      return reply
    }

    if (!context.verifyMutation(request, session)) {
      return reply.code(403).send({ code: 'CSRF_REJECTED' })
    }

    service.revoke(session.id)
    clearSessionCookie(reply, options.secureCookie)
    return reply.code(204).send()
  })

  app.get('/api/v1/admin/status', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    const session = context.requireSession(request, reply)

    if (!session) {
      return reply
    }

    return { authenticated: true }
  })
}

function setPrivateResponseHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store')
  reply.header('Vary', 'Cookie')
}

function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(ADMIN_SESSION_COOKIE, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure,
  })
}
