import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { encodeSecretMaterial, hashPassword } from '../../shared/secrets'
import { buildServer, LOGGER_REDACTION_PATHS } from '../app'
import { createTestDatabase } from '../db/testing'
import { ADMIN_SESSION_COOKIE, CSRF_HEADER } from './admin-routes'
import {
  ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS,
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
} from './admin-service'

const appOrigin = 'https://calendar.app.hurdoo.kr'
const password = 'correct-test-password'

describe('administrator authentication routes', () => {
  const apps: FastifyInstance[] = []
  let passwordVerifier = ''
  let now = new Date('2026-08-25T00:00:00.000Z')

  beforeAll(async () => {
    passwordVerifier = await hashPassword(password, {
      n: 2 ** 10,
      r: 8,
      p: 1,
      keyLength: 32,
      saltLength: 16,
      maxmem: 8 * 1024 * 1024,
    })
  })

  afterEach(async () => {
    now = new Date('2026-08-25T00:00:00.000Z')
    await Promise.all(apps.splice(0).map(async (app) => app.close()))
  })

  async function createApp() {
    const app = await buildServer({
      adminAuth: {
        now: () => now,
        passwordVerifier,
        sessionSecret: encodeSecretMaterial(new Uint8Array(32).fill(5)),
      },
      appBaseUrl: appOrigin,
      database: createTestDatabase(),
      secureCookies: true,
    })
    apps.push(app)
    return app
  }

  it('creates a hashed server session with hardened cookie attributes', async () => {
    const app = await createApp()
    const response = await login(app)
    const body = response.json<{ csrfToken: string }>()
    const setCookie = String(response.headers['set-cookie'])

    expect(response.statusCode).toBe(201)
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).not.toContain('Domain=')

    const stored = app.database.sqlite
      .prepare('select token_hash from admin_sessions')
      .get() as { token_hash: string }
    const rawCookieToken = cookiePair(response).split('=')[1] ?? ''

    expect(stored.token_hash).not.toBe(rawCookieToken)
    expect(stored.token_hash).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('rejects invalid credentials and exact-origin mismatches without reflecting secrets', async () => {
    const app = await createApp()
    const invalidPassword = 'do-not-reflect-this-password'
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/session',
      headers: { origin: appOrigin },
      payload: { password: invalidPassword },
    })
    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/session',
      headers: { origin: 'https://calendar.app.hurdoo.kr.attacker.example' },
      payload: { password },
    })

    expect(invalid.statusCode).toBe(401)
    expect(invalid.json()).toEqual({ code: 'INVALID_CREDENTIALS' })
    expect(invalid.body).not.toContain(invalidPassword)
    expect(invalid.headers['set-cookie']).toBeUndefined()
    expect(wrongOrigin.statusCode).toBe(403)
    expect(wrongOrigin.json()).toEqual({ code: 'ORIGIN_REJECTED' })
  })

  it('rate limits repeated failed logins by client address', async () => {
    const app = await createApp()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        headers: { origin: appOrigin },
        payload: { password: 'wrong-password' },
      })
      expect(response.statusCode).toBe(401)
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/session',
      headers: { origin: appOrigin },
      payload: { password },
    })

    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toEqual({ code: 'LOGIN_RATE_LIMITED' })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('requires both the expected origin and session-bound CSRF token for logout', async () => {
    const app = await createApp()
    const loggedIn = await login(app)
    const cookie = cookiePair(loggedIn)
    const { csrfToken } = loggedIn.json<{ csrfToken: string }>()

    const missingCsrf = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/session',
      headers: { cookie, origin: appOrigin },
    })
    const wrongOrigin = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/session',
      headers: {
        cookie,
        origin: 'https://attacker.example',
        [CSRF_HEADER]: csrfToken,
      },
    })
    const loggedOut = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/session',
      headers: { cookie, origin: appOrigin, [CSRF_HEADER]: csrfToken },
    })
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/status',
      headers: { cookie },
    })

    expect(missingCsrf.statusCode).toBe(403)
    expect(wrongOrigin.statusCode).toBe(403)
    expect(loggedOut.statusCode).toBe(204)
    expect(String(loggedOut.headers['set-cookie'])).toContain(`${ADMIN_SESSION_COOKIE}=`)
    expect(afterLogout.statusCode).toBe(401)
  })

  it('enforces idle and absolute expiration on the server', async () => {
    const idleApp = await createApp()
    const idleLogin = await login(idleApp)
    const idleCookie = cookiePair(idleLogin)

    now = new Date(now.getTime() + ADMIN_SESSION_IDLE_TIMEOUT_MS)
    const idleExpired = await idleApp.inject({
      method: 'GET',
      url: '/api/v1/admin/status',
      headers: { cookie: idleCookie },
    })

    expect(idleExpired.statusCode).toBe(401)

    now = new Date('2026-08-25T00:00:00.000Z')
    const absoluteApp = await createApp()
    const absoluteLogin = await login(absoluteApp)
    const absoluteCookie = cookiePair(absoluteLogin)
    const lastActivity = new Date(
      now.getTime() + ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS - 5 * 60 * 1000,
    )
    absoluteApp.database.sqlite
      .prepare('update admin_sessions set last_used_at = ?')
      .run(lastActivity.getTime())
    now = new Date(now.getTime() + ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS)

    const absoluteExpired = await absoluteApp.inject({
      method: 'GET',
      url: '/api/v1/admin/status',
      headers: { cookie: absoluteCookie },
    })

    expect(absoluteExpired.statusCode).toBe(401)
  })

  it('redacts authentication material from structured logs', () => {
    expect(LOGGER_REDACTION_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-csrf-token',
        'res.headers.set-cookie',
      ]),
    )
  })
})

async function login(app: FastifyInstance) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/admin/session',
    headers: { origin: appOrigin },
    payload: { password },
  })
}

function cookiePair(response: Awaited<ReturnType<FastifyInstance['inject']>>): string {
  return String(response.headers['set-cookie']).split(';')[0] ?? ''
}
