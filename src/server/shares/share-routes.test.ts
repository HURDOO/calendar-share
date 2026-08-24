import type { FastifyInstance } from 'fastify'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { encodeSecretMaterial, hashPassword } from '../../shared/secrets'
import { buildServer } from '../app'
import { ADMIN_SESSION_COOKIE, CSRF_HEADER } from '../auth/admin-routes'
import { createTestDatabase } from '../db/testing'
import { VISITOR_SESSION_COOKIE } from './share-routes'

const appOrigin = 'https://calendar.app.hurdoo.kr'
const password = 'share-route-password'
const calendarId = '20000000-0000-4000-8000-000000000001'

describe('share routes', () => {
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
    const now = new Date('2026-08-25T00:00:00.000Z')
    const app = await buildServer({
      adminAuth: {
        now: () => now,
        passwordVerifier,
        sessionSecret: encodeSecretMaterial(new Uint8Array(32).fill(11)),
      },
      appBaseUrl: appOrigin,
      database: createTestDatabase(),
      secureCookies: true,
      timeZone: 'Asia/Seoul',
    })
    app.database.sqlite
      .prepare("insert into google_connections (id, status) values (1, 'DISCONNECTED')")
      .run()
    app.database.sqlite
      .prepare(`
        insert into calendars (
          id, connection_id, google_calendar_id, display_name, sync_status
        ) values (?, 1, 'google-route-calendar', '공유 캘린더', 'READY')
      `)
      .run(calendarId)
    app.database.sqlite
      .prepare(`
        insert into events (
          id, calendar_id, google_event_id, is_all_day, starts_at, ends_at,
          title, location, description
        ) values (
          'route-event', ?, 'google-route-event', 0, ?, ?,
          '공개 일정', '공개 장소', '공개 설명'
        )
      `)
      .run(
        calendarId,
        Date.parse('2026-08-25T00:00:00.000Z'),
        Date.parse('2026-08-25T01:00:00.000Z'),
      )
    apps.push(app)
    return app
  }

  it('creates, exchanges, reads, and immediately revokes a share', async () => {
    const app = await createApp()
    const authenticated = await login(app)
    const adminCookie = cookieByName(authenticated, ADMIN_SESSION_COOKIE)
    const { csrfToken } = authenticated.json<{ csrfToken: string }>()
    const mutationHeaders = {
      cookie: adminCookie,
      origin: appOrigin,
      [CSRF_HEADER]: csrfToken,
    }
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/shares',
      headers: mutationHeaders,
      payload: shareInput(),
    })
    const body = created.json<{
      share: { id: string; name: string }
      token: string
      shareUrl: string
    }>()

    expect(created.statusCode).toBe(201)
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.shareUrl).toBe(`${appOrigin}/s/${body.token}`)
    const stored = app.database.sqlite
      .prepare('select token_hash from share_links where id = ?')
      .get(body.share.id) as { token_hash: string }
    expect(stored.token_hash).not.toContain(body.token)

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/shares',
      headers: { cookie: adminCookie },
    })
    expect(list.body).not.toContain(body.token)
    expect(list.json<{ shares: unknown[] }>().shares).toHaveLength(1)

    const exchanged = await app.inject({
      method: 'GET',
      url: `/s/${body.token}`,
    })
    const visitorCookie = cookieByName(exchanged, VISITOR_SESSION_COOKIE)
    expect(exchanged.statusCode).toBe(302)
    expect(exchanged.headers.location).toBe(`/share/${body.share.id}`)
    expect(allSetCookies(exchanged).join(';')).toContain('HttpOnly')
    expect(allSetCookies(exchanged).join(';')).toContain('Secure')
    expect(exchanged.headers['referrer-policy']).toBe('no-referrer')

    const events = await app.inject({
      method: 'GET',
      url: '/api/v1/public/events',
      headers: { cookie: visitorCookie },
    })
    expect(events.statusCode).toBe(200)
    expect(events.json()).toMatchObject({
      availability: 'AVAILABLE',
      events: [
        {
          title: '공개 일정',
          location: '공개 장소',
          description: '공개 설명',
        },
      ],
    })

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/shares/${body.share.id}`,
      headers: mutationHeaders,
    })
    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/api/v1/public/events',
      headers: { cookie: visitorCookie },
    })
    expect(revoked.statusCode).toBe(204)
    expect(afterRevoke.statusCode).toBe(401)
    expect(afterRevoke.json()).toEqual({ code: 'SHARE_ACCESS_UNAVAILABLE' })
  })

  it('requires CSRF for writes and returns uniform clean redirects for invalid tokens', async () => {
    const app = await createApp()
    const authenticated = await login(app)
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/shares',
      headers: {
        cookie: cookieByName(authenticated, ADMIN_SESSION_COOKIE),
        origin: appOrigin,
      },
      payload: shareInput(),
    })
    const invalidToken = 'A'.repeat(43)
    const invalid = await app.inject({
      method: 'GET',
      url: `/s/${invalidToken}`,
    })

    expect(rejected.statusCode).toBe(403)
    expect(rejected.json()).toEqual({ code: 'CSRF_REJECTED' })
    expect(invalid.statusCode).toBe(302)
    expect(invalid.headers.location).toBe('/share/unavailable')
    expect(invalid.body).not.toContain(invalidToken)
  })

  it('uses the same policy result for administrator preview', async () => {
    const app = await createApp()
    const authenticated = await login(app)
    const adminCookie = cookieByName(authenticated, ADMIN_SESSION_COOKIE)
    const { csrfToken } = authenticated.json<{ csrfToken: string }>()
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/shares',
      headers: {
        cookie: adminCookie,
        origin: appOrigin,
        [CSRF_HEADER]: csrfToken,
      },
      payload: shareInput(),
    })
    const { share } = created.json<{ share: { id: string } }>()

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/shares/${share.id}`,
      headers: {
        cookie: adminCookie,
        origin: appOrigin,
        [CSRF_HEADER]: csrfToken,
      },
      payload: {
        ...shareInput(),
        calendarIds: [calendarId],
        calendarScope: 'SELECTED',
        name: '수정된 공유',
      },
    })
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/shares/${share.id}`,
      headers: { cookie: adminCookie },
    })
    const rotated = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/shares/${share.id}/rotate-token`,
      headers: {
        cookie: adminCookie,
        origin: appOrigin,
        [CSRF_HEADER]: csrfToken,
      },
    })

    const preview = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/shares/${share.id}/preview`,
      headers: { cookie: adminCookie },
    })

    expect(updated.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      share: {
        name: '수정된 공유',
        calendarScope: 'SELECTED',
        calendarIds: [calendarId],
      },
    })
    expect(rotated.json<{ token: string }>().token).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    )
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      availability: 'AVAILABLE',
      events: [{ id: 'route-event', title: '공개 일정' }],
    })
  })

  it('authenticates an SSE stream and emits only a refetch signal', async () => {
    const app = await createApp()
    const created = app.shareFeature.shares.create({
      accessEndsAt: null,
      accessStartsAt: null,
      calendarIds: [],
      calendarScope: 'SELECTED',
      eventEndDate: '2026-08-25',
      eventStartDate: '2026-08-25',
      name: '실시간 공유',
    })
    const exchanged = app.shareFeature.visitors.exchangeShareToken(created.token)
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address() as AddressInfo

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/public/stream`,
      {
        headers: {
          cookie: `${VISITOR_SESSION_COOKIE}=${exchanged?.token ?? ''}`,
        },
      },
    )
    const reader = response.body?.getReader()
    const first = await reader?.read()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(new TextDecoder().decode(first?.value)).toBe(': connected\n\n')

    app.shareFeature.realtime.publish(created.share.id)
    const changed = await reader?.read()
    expect(new TextDecoder().decode(changed?.value)).toBe(
      'event: changed\ndata: {}\n\n',
    )
    await reader?.cancel()
  })
})

function shareInput() {
  return {
    accessEndsAt: null,
    accessStartsAt: null,
    calendarIds: [],
    calendarScope: 'ALL',
    eventEndDate: '2026-08-25',
    eventStartDate: '2026-08-25',
    name: '라우트 공유',
  }
}

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
