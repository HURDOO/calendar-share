import { afterEach, describe, expect, it } from 'vitest'

import { buildServer } from './app'
import { createTestDatabase } from './db/testing'

describe('server foundation', () => {
  const apps: Awaited<ReturnType<typeof buildServer>>[] = []

  async function createApp() {
    const app = await buildServer({ database: createTestDatabase() })
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

  it('reports the database implementation phase', async () => {
    const app = await createApp()

    const response = await app.inject({ method: 'GET', url: '/api/v1/meta' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ name: '캘공', phase: 'database' })
  })
})
