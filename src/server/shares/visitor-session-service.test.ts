import { afterEach, describe, expect, it } from 'vitest'

import type { AppDatabase } from '../db/database'
import { createTestDatabase } from '../db/testing'
import { SharePolicyService } from './policy-service'
import { ShareService } from './share-service'
import { VisitorSessionService } from './visitor-session-service'

describe('VisitorSessionService', () => {
  const databases: AppDatabase[] = []
  let now = new Date('2026-08-25T00:00:00.000Z')

  afterEach(() => {
    now = new Date('2026-08-25T00:00:00.000Z')
    for (const database of databases.splice(0)) {
      database.close()
    }
  })

  function setup() {
    const database = createTestDatabase()
    databases.push(database)
    const policy = new SharePolicyService(database, 'Asia/Seoul', () => now)
    const shares = new ShareService(
      database,
      'https://calendar.app.hurdoo.kr',
      () => now,
    )
    const visitors = new VisitorSessionService(database, policy, () => now)
    return { database, shares, visitors }
  }

  it('exchanges a share token once and rechecks revocation on every request', () => {
    const { database, shares, visitors } = setup()
    const created = shares.create({
      accessEndsAt: null,
      accessStartsAt: null,
      calendarIds: [],
      calendarScope: 'SELECTED',
      eventEndDate: '2026-08-31',
      eventStartDate: '2026-08-01',
      name: '세션 테스트',
    })

    const exchanged = visitors.exchangeShareToken(created.token)
    expect(exchanged).not.toBeNull()
    expect(visitors.exchangeShareToken('x'.repeat(43))).toBeNull()
    expect(visitors.authenticate(exchanged?.token ?? '')?.shareId).toBe(
      created.share.id,
    )
    const stored = database.sqlite
      .prepare('select token_hash from visitor_sessions')
      .get() as { token_hash: string }
    expect(stored.token_hash).not.toContain(exchanged?.token)

    shares.revoke(created.share.id)
    expect(visitors.authenticate(exchanged?.token ?? '')).toBeNull()
  })

  it('enforces idle and absolute session expiration', () => {
    const { shares, visitors } = setup()
    const created = shares.create({
      accessEndsAt: null,
      accessStartsAt: null,
      calendarIds: [],
      calendarScope: 'ALL',
      eventEndDate: '2026-08-31',
      eventStartDate: '2026-08-01',
      name: '만료 테스트',
    })
    const idle = visitors.exchangeShareToken(created.token)

    now = new Date('2026-08-25T00:30:00.000Z')
    expect(visitors.authenticate(idle?.token ?? '')).toBeNull()

    now = new Date('2026-08-25T01:00:00.000Z')
    const absolute = visitors.exchangeShareToken(created.token)
    now = new Date('2026-08-25T13:00:00.000Z')
    expect(visitors.authenticate(absolute?.token ?? '')).toBeNull()
  })

  it('invalidates the old link and existing sessions when rotating a token', () => {
    const { shares, visitors } = setup()
    const created = shares.create({
      accessEndsAt: null,
      accessStartsAt: null,
      calendarIds: [],
      calendarScope: 'SELECTED',
      eventEndDate: '2026-08-31',
      eventStartDate: '2026-08-01',
      name: '회전 테스트',
    })
    const existingSession = visitors.exchangeShareToken(created.token)

    const rotated = shares.rotateToken(created.share.id)

    expect(visitors.exchangeShareToken(created.token)).toBeNull()
    expect(visitors.authenticate(existingSession?.token ?? '')).toBeNull()
    expect(visitors.exchangeShareToken(rotated.token)).not.toBeNull()
  })
})
