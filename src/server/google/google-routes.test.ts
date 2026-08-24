import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { encodeSecretMaterial, hashPassword } from '../../shared/secrets'
import { buildServer } from '../app'
import { ADMIN_SESSION_COOKIE, CSRF_HEADER } from '../auth/admin-routes'
import { createTestDatabase } from '../db/testing'
import { GOOGLE_OAUTH_TRANSACTION_COOKIE } from './google-routes'
import { createFakeGoogleAdapter } from './testing/fake-google-adapter'
import { GOOGLE_CALENDAR_SCOPES } from './types'

const appOrigin = 'https://calendar.app.hurdoo.kr'
const password = 'google-route-password'
const refreshToken = 'raw-refresh-token-must-not-be-stored'

describe('Google administrator routes', () => {
  const apps: FastifyInstance[] = []
  let passwordVerifier = ''

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
    await Promise.all(apps.splice(0).map(async (app) => app.close()))
  })

  async function createApp() {
    const exchangeAuthorizationCode = vi.fn(async () => ({
      refreshToken,
      scopes: [...GOOGLE_CALENDAR_SCOPES],
    }))
    const adapter = createFakeGoogleAdapter({
      authorizationUrl: ({ codeChallenge, state }) => {
        const url = new URL('https://accounts.google.test/authorize')
        url.searchParams.set('code_challenge', codeChallenge)
        url.searchParams.set('state', state)
        return url.toString()
      },
      exchangeAuthorizationCode,
    })
    const app = await buildServer({
      adminAuth: {
        passwordVerifier,
        sessionSecret: encodeSecretMaterial(new Uint8Array(32).fill(8)),
      },
      appBaseUrl: appOrigin,
      database: createTestDatabase(),
      google: {
        adapter,
        clientId: 'fixture-client-id',
        clientSecret: 'fixture-client-secret',
        schedulerEnabled: false,
        timeZone: 'Asia/Seoul',
        tokenEncryptionKey: encodeSecretMaterial(new Uint8Array(32).fill(9)),
      },
      secureCookies: true,
    })
    apps.push(app)
    return { app, exchangeAuthorizationCode }
  }

  it('binds OAuth to the admin session and stores only encrypted refresh tokens', async () => {
    const { app, exchangeAuthorizationCode } = await createApp()
    const authenticated = await login(app)
    const adminCookie = cookieByName(authenticated, ADMIN_SESSION_COOKIE)
    const { csrfToken } = authenticated.json<{ csrfToken: string }>()

    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/google/connect',
      headers: {
        cookie: adminCookie,
        origin: appOrigin,
        [CSRF_HEADER]: csrfToken,
      },
    })
    const { authorizationUrl } = started.json<{ authorizationUrl: string }>()
    const authorization = new URL(authorizationUrl)
    const oauthCookie = cookieByName(started, GOOGLE_OAUTH_TRANSACTION_COOKIE)

    expect(started.statusCode).toBe(200)
    expect(authorization.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorization.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    )
    expect(allSetCookies(started).join(';')).toContain('HttpOnly')
    expect(allSetCookies(started).join(';')).toContain('Secure')

    const completed = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/google/callback?code=fixture-code&state=${authorization.searchParams.get('state')}`,
      headers: { cookie: `${adminCookie}; ${oauthCookie}` },
    })

    expect(completed.statusCode).toBe(302)
    expect(completed.headers.location).toBe('/admin?google=connected')
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      'fixture-code',
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    )

    const connection = app.database.sqlite
      .prepare('select refresh_token_ciphertext from google_connections where id = 1')
      .get() as { refresh_token_ciphertext: string }
    const queued = app.database.sqlite
      .prepare("select kind, status from sync_jobs where kind = 'CALENDAR_LIST_SYNC'")
      .get()
    expect(connection.refresh_token_ciphertext).not.toContain(refreshToken)
    expect(connection.refresh_token_ciphertext).toMatch(/^v1\./)
    expect(queued).toEqual({ kind: 'CALENDAR_LIST_SYNC', status: 'PENDING' })
  })

  it('rejects mutation requests without valid CSRF and protects status', async () => {
    const { app } = await createApp()
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/google/status',
    })
    const authenticated = await login(app)
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/google/connect',
      headers: {
        cookie: cookieByName(authenticated, ADMIN_SESSION_COOKIE),
        origin: appOrigin,
      },
    })

    expect(anonymous.statusCode).toBe(401)
    expect(rejected.statusCode).toBe(403)
    expect(rejected.json()).toEqual({ code: 'CSRF_REJECTED' })
  })

  it('queues manual recovery and removes local Google data on disconnect', async () => {
    const { app } = await createApp()
    app.googleFeature.connection.connect(refreshToken, [...GOOGLE_CALENDAR_SCOPES])
    const authenticated = await login(app)
    const cookie = cookieByName(authenticated, ADMIN_SESSION_COOKIE)
    const { csrfToken } = authenticated.json<{ csrfToken: string }>()
    const headers = { cookie, origin: appOrigin, [CSRF_HEADER]: csrfToken }

    const queued = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/google/sync',
      headers,
    })
    const disconnected = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/google/connection',
      headers,
    })

    expect(queued.statusCode).toBe(202)
    expect(disconnected.statusCode).toBe(204)
    expect(app.googleFeature.connection.status().connected).toBe(false)
    expect(
      app.database.sqlite.prepare('select count(*) as count from sync_jobs').get(),
    ).toEqual({ count: 0 })
  })

  it('returns a uniform empty response for untrusted webhook notifications', async () => {
    const { app } = await createApp()
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/google/webhook',
    })
    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/google/webhook',
      headers: {
        'x-goog-channel-id': 'unknown',
        'x-goog-channel-token': 'secret-that-must-not-be-reflected',
        'x-goog-message-number': '7',
        'x-goog-resource-id': 'unknown',
        'x-goog-resource-state': 'exists',
      },
    })

    expect(missing.statusCode).toBe(204)
    expect(forged.statusCode).toBe(204)
    expect(missing.body).toBe('')
    expect(forged.body).toBe('')
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

function allSetCookies(
  response: Awaited<ReturnType<FastifyInstance['inject']>>,
): string[] {
  const value = response.headers['set-cookie']
  return Array.isArray(value) ? value : value ? [String(value)] : []
}

function cookieByName(
  response: Awaited<ReturnType<FastifyInstance['inject']>>,
  name: string,
): string {
  const cookie = allSetCookies(response).find((value) => value.startsWith(`${name}=`))
  if (!cookie) {
    throw new Error(`Missing test cookie: ${name}`)
  }
  return cookie.split(';')[0] ?? ''
}
