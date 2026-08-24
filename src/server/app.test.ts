import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { encodeSecretMaterial, hashPassword } from '../shared/secrets'
import { buildServer } from './app'
import { createTestDatabase } from './db/testing'
import { CONTENT_SECURITY_POLICY } from './security/response-policy'

describe('server foundation', () => {
  const apps: Awaited<ReturnType<typeof buildServer>>[] = []
  let passwordVerifier = ''

  beforeAll(async () => {
    passwordVerifier = await hashPassword('test-password', {
      n: 2 ** 10,
      r: 8,
      p: 1,
      keyLength: 32,
      saltLength: 16,
      maxmem: 8 * 1024 * 1024,
    })
  })

  async function createApp(
    options: { readonly secureCookies?: boolean; readonly trustProxy?: string } = {},
  ) {
    const app = await buildServer({
      adminAuth: {
        passwordVerifier,
        sessionSecret: encodeSecretMaterial(new Uint8Array(32).fill(4)),
      },
      appBaseUrl: 'http://localhost:8464',
      database: createTestDatabase(),
      ...options,
    })
    apps.push(app)
    return app
  }

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()))
  })

  it('exposes liveness without external dependencies', async () => {
    const app = await createApp()

    const response = await app.inject({ method: 'GET', url: '/health/live' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('reports database readiness', async () => {
    const app = await createApp()

    const response = await app.inject({ method: 'GET', url: '/health/ready' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', phase: 'database' })
  })

  it('reports the security hardening implementation phase', async () => {
    const app = await createApp()

    const response = await app.inject({ method: 'GET', url: '/api/v1/meta' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ name: '캘공', phase: 'security-hardening' })
  })

  it('applies security, indexing, and cache policy to dynamic responses', async () => {
    const app = await createApp()

    const response = await app.inject({ method: 'GET', url: '/api/v1/meta' })

    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['content-security-policy']).toBe(
      CONTENT_SECURITY_POLICY,
    )
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(response.headers['permissions-policy']).toContain('camera=()')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['strict-transport-security']).toBeUndefined()
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive')
  })

  it('adds HSTS only on the production HTTPS boundary', async () => {
    const app = await createApp({ secureCookies: true })

    const response = await app.inject({ method: 'GET', url: '/health/live' })

    expect(response.headers['strict-transport-security']).toBe('max-age=31536000')
  })

  it('caches only fingerprinted static assets', async () => {
    const app = await createApp()
    app.get('/assets/index-AbCd1234.js', async (_request, reply) =>
      reply.type('application/javascript').send('export {}'),
    )
    app.get('/asset.js', async (_request, reply) =>
      reply.type('application/javascript').send('export {}'),
    )

    const immutable = await app.inject({
      method: 'GET',
      url: '/assets/index-AbCd1234.js',
    })
    const dynamic = await app.inject({ method: 'GET', url: '/asset.js' })

    expect(immutable.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(dynamic.headers['cache-control']).toBe('no-store')
  })

  it('masks internal errors and oversized request bodies', async () => {
    const app = await createApp()
    const internalDetail = 'database-path-and-token-detail'
    app.get('/test/error', async () => {
      throw new Error(internalDetail)
    })

    const internal = await app.inject({ method: 'GET', url: '/test/error' })
    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/session',
      headers: { origin: 'http://localhost:8464' },
      payload: { password: 'x'.repeat(70 * 1024) },
    })

    expect(internal.statusCode).toBe(500)
    expect(internal.json()).toEqual({ code: 'INTERNAL_ERROR' })
    expect(internal.body).not.toContain(internalDetail)
    expect(oversized.statusCode).toBe(413)
    expect(oversized.json()).toEqual({ code: 'REQUEST_TOO_LARGE' })
  })
})
