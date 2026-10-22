import { afterEach, describe, expect, it } from 'vitest'

import type { AppDatabase } from '../db/database'
import { createTestDatabase } from '../db/testing'
import { SharePolicyService } from './policy-service'
import { ShareService } from './share-service'
import type { ShareWriteInput } from './share-types'

const calendarOne = '10000000-0000-4000-8000-000000000001'
const calendarTwo = '10000000-0000-4000-8000-000000000002'

describe('SharePolicyService', () => {
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
    seedConnection(database)
    seedCalendar(database, calendarOne, '가족')
    const policy = new SharePolicyService(database, 'Asia/Seoul', () => now)
    const shares = new ShareService(
      database,
      'https://calendar.app.hurdoo.kr',
      Buffer.alloc(32, 15).toString('base64url'),
      () => now,
    )
    return { database, policy, shares }
  }

  it('includes newly discovered calendars only for ALL scope', () => {
    const { database, policy, shares } = setup()
    const all = shares.create(writeInput({ calendarScope: 'ALL', calendarIds: [] }))
    const selected = shares.create(
      writeInput({ calendarScope: 'SELECTED', calendarIds: [calendarOne] }),
    )
    const empty = shares.create(
      writeInput({ calendarScope: 'SELECTED', calendarIds: [] }),
    )
    seedEvent(database, calendarOne, 'family-event', '가족 일정')

    seedCalendar(database, calendarTwo, '새 캘린더')
    seedEvent(database, calendarTwo, 'new-event', '새 일정')

    expect(policy.evaluate(all.share.id).events.map((event) => event.title)).toEqual([
      '가족 일정',
      '새 일정',
    ])
    expect(
      policy.evaluate(selected.share.id).events.map((event) => event.title),
    ).toEqual(['가족 일정'])
    expect(policy.evaluate(empty.share.id).events).toEqual([])
  })

  it('uses inclusive policy dates with interval-overlap boundaries', () => {
    const { database, policy, shares } = setup()
    const share = shares.create(writeInput())
    seedTimedEvent(
      database,
      calendarOne,
      'ends-at-start',
      '이전 날',
      '2026-08-24T14:00:00.000Z',
      '2026-08-24T15:00:00.000Z',
    )
    seedTimedEvent(
      database,
      calendarOne,
      'starts-at-end',
      '다음 날',
      '2026-08-25T15:00:00.000Z',
      '2026-08-25T16:00:00.000Z',
    )
    seedTimedEvent(
      database,
      calendarOne,
      'spanning',
      '경계를 가로지름',
      '2026-08-24T14:00:00.000Z',
      '2026-08-25T16:00:00.000Z',
    )
    seedAllDayEvent(
      database,
      calendarOne,
      'all-day-before',
      '종일 이전',
      '2026-08-24',
      '2026-08-25',
    )
    seedAllDayEvent(
      database,
      calendarOne,
      'all-day-inside',
      '종일 당일',
      '2026-08-25',
      '2026-08-26',
    )

    const result = policy.evaluate(share.share.id)

    expect(result.availability).toBe('AVAILABLE')
    expect(result.events.map((event) => event.title).sort()).toEqual([
      '경계를 가로지름',
      '종일 당일',
    ])
  })

  it('enforces inclusive access start, exclusive end, privacy, and revocation', () => {
    now = new Date('2026-08-25T00:00:00.000Z')
    const { database, policy, shares } = setup()
    const share = shares.create(
      writeInput({
        accessStartsAt: '2026-08-25T00:00:00.000Z',
        accessEndsAt: '2026-08-25T01:00:00.000Z',
      }),
    )
    seedPrivateEvent(database, calendarOne)

    const atStart = policy.evaluate(share.share.id)
    expect(atStart.availability).toBe('AVAILABLE')
    expect(atStart.events[0]).toMatchObject({
      title: '비공개 일정',
      location: null,
      description: null,
      isPrivate: true,
    })

    now = new Date('2026-08-25T01:00:00.000Z')
    expect(policy.evaluate(share.share.id).availability).toBe('EXPIRED')

    now = new Date('2026-08-24T23:59:59.999Z')
    expect(policy.evaluate(share.share.id).availability).toBe('NOT_STARTED')

    now = new Date('2026-08-25T00:30:00.000Z')
    shares.revoke(share.share.id)
    expect(policy.evaluate(share.share.id)).toMatchObject({
      availability: 'REVOKED',
      events: [],
    })
  })

  it('stores only token hashes and invalidates the old token on rotation', () => {
    const { database, shares } = setup()
    const created = shares.create(writeInput())
    const firstHash = database.sqlite
      .prepare('select token_hash from share_links where id = ?')
      .get(created.share.id) as { token_hash: string }
    expect(shares.get(created.share.id)?.shareUrl).toBe(created.shareUrl)

    const rotated = shares.rotateToken(created.share.id)
    const secondHash = database.sqlite
      .prepare('select token_hash from share_links where id = ?')
      .get(created.share.id) as { token_hash: string }

    expect(firstHash.token_hash).not.toContain(created.token)
    expect(secondHash.token_hash).not.toContain(rotated.token)
    expect(secondHash.token_hash).not.toBe(firstHash.token_hash)
    expect(created.shareUrl).toBe(
      `https://calendar.app.hurdoo.kr/#share=${created.token}`,
    )
    expect(shares.get(created.share.id)?.shareUrl).toBe(rotated.shareUrl)
    expect(rotated.share.shareUrl).toBe(rotated.shareUrl)
  })

  it('keeps zero-length events on the range start and drops them on the range end', () => {
    const { database, policy, shares } = setup()
    const share = shares.create(writeInput())
    seedTimedEvent(
      database,
      calendarOne,
      'point-at-start',
      '시작 시각 알림',
      '2026-08-24T15:00:00.000Z',
      '2026-08-24T15:00:00.000Z',
    )
    seedTimedEvent(
      database,
      calendarOne,
      'point-inside',
      '중간 알림',
      '2026-08-25T03:00:00.000Z',
      '2026-08-25T03:00:00.000Z',
    )
    seedTimedEvent(
      database,
      calendarOne,
      'point-at-end',
      '다음 날 알림',
      '2026-08-25T15:00:00.000Z',
      '2026-08-25T15:00:00.000Z',
    )

    expect(policy.evaluate(share.share.id).events.map((event) => event.title)).toEqual([
      '시작 시각 알림',
      '중간 알림',
    ])
  })

  it('can expose every event in the retained read model without date boundaries', () => {
    const { database, policy, shares } = setup()
    seedEvent(database, calendarOne, 'outside-selected-range', '전체 범위 일정')
    const share = shares.create(
      writeInput({
        eventDateScope: 'ALL',
        eventStartDate: null,
        eventEndDate: null,
      }),
    )

    expect(policy.evaluate(share.share.id)).toMatchObject({
      share: { eventDateScope: 'ALL', eventStartDate: null, eventEndDate: null },
      events: [{ title: '전체 범위 일정' }],
    })
  })
})

function writeInput(
  overrides: Partial<ShareWriteInput> = {},
): ShareWriteInput {
  return {
    accessEndsAt: null,
    accessStartsAt: null,
    calendarIds: [],
    calendarScope: 'ALL',
    eventDateScope: 'SELECTED',
    eventEndDate: '2026-08-25',
    eventStartDate: '2026-08-25',
    name: '가족 공유',
    ...overrides,
  }
}

function seedConnection(database: AppDatabase): void {
  database.sqlite
    .prepare("insert into google_connections (id, status) values (1, 'DISCONNECTED')")
    .run()
}

function seedCalendar(database: AppDatabase, id: string, name: string): void {
  database.sqlite
    .prepare(`
      insert into calendars (id, connection_id, google_calendar_id, display_name)
      values (?, 1, ?, ?)
    `)
    .run(id, `google-${id}`, name)
}

function seedEvent(
  database: AppDatabase,
  calendarId: string,
  id: string,
  title: string,
): void {
  seedTimedEvent(
    database,
    calendarId,
    id,
    title,
    '2026-08-25T00:00:00.000Z',
    '2026-08-25T01:00:00.000Z',
  )
}

function seedTimedEvent(
  database: AppDatabase,
  calendarId: string,
  id: string,
  title: string,
  startsAt: string,
  endsAt: string,
): void {
  database.sqlite
    .prepare(`
      insert into events (
        id, calendar_id, google_event_id, is_all_day, starts_at, ends_at, title
      ) values (?, ?, ?, 0, ?, ?, ?)
    `)
    .run(id, calendarId, `google-${id}`, Date.parse(startsAt), Date.parse(endsAt), title)
}

function seedAllDayEvent(
  database: AppDatabase,
  calendarId: string,
  id: string,
  title: string,
  startDate: string,
  endDate: string,
): void {
  database.sqlite
    .prepare(`
      insert into events (
        id, calendar_id, google_event_id, is_all_day,
        start_date, end_date, title
      ) values (?, ?, ?, 1, ?, ?, ?)
    `)
    .run(id, calendarId, `google-${id}`, startDate, endDate, title)
}

function seedPrivateEvent(database: AppDatabase, calendarId: string): void {
  database.sqlite
    .prepare(`
      insert into events (
        id, calendar_id, google_event_id, is_all_day, starts_at, ends_at,
        visibility, title, location, description
      ) values (
        'private-event', ?, 'google-private-event', 0, ?, ?, 'PRIVATE', null, null, null
      )
    `)
    .run(
      calendarId,
      Date.parse('2026-08-25T00:00:00.000Z'),
      Date.parse('2026-08-25T01:00:00.000Z'),
    )
}
