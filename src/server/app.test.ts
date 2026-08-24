import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { encodeSecretMaterial, hashPassword } from '../shared/secrets'
import { buildServer } from './app'
import { createTestDatabase } from './db/testing'

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

  async function createApp() {
    const app = await buildServer({
      adminAuth: {
        passwordVerifier,
        sessionSecret: encodeSecretMaterial(new Uint8Array(32).fill(4)),
      },
      appBaseUrl: 'http://localhost:8464',
      database: createTestDatabase(),
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

  it('reports the visitor calendar implementation phase', async () => {
    const app = await createApp()

    const response = await app.inject({ method: 'GET', url: '/api/v1/meta' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ name: '캘공', phase: 'visitor-calendar' })
  })
})
