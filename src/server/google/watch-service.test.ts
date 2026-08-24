import { afterEach, describe, expect, it, vi } from 'vitest'

import { encodeSecretMaterial, hashSecret } from '../../shared/secrets'
import type { AppDatabase } from '../db/database'
import { createTestDatabase } from '../db/testing'
import { GoogleConnectionService } from './connection-service'
import { SyncJobQueue } from './job-queue'
import { createFakeGoogleAdapter } from './testing/fake-google-adapter'
import { TokenCipher } from './token-cipher'
import { GOOGLE_CALENDAR_SCOPES, type GoogleAdapter } from './types'
import { GoogleWatchService } from './watch-service'

const now = new Date('2026-08-25T00:00:00.000Z')

describe('GoogleWatchService', () => {
  const databases: AppDatabase[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  function setup(adapter: GoogleAdapter) {
    const database = createTestDatabase()
    databases.push(database)
    const connection = new GoogleConnectionService(
      database,
      new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(17))),
      () => now,
    )
    connection.connect('fixture-refresh-token', [...GOOGLE_CALENDAR_SCOPES])
    const queue = new SyncJobQueue(database, () => now)
    const service = new GoogleWatchService(
      database,
      adapter,
      connection,
      queue,
      'https://calendar.app.hurdoo.kr',
      () => now,
    )
    return { database, queue, service }
  }

  it('renews expiring channels by creating the replacement before stopping the old one', async () => {
    const calls: string[] = []
    const watchCalendarList = vi.fn<GoogleAdapter['watchCalendarList']>(
      async (request) => {
        calls.push('create')
        return {
          expiration: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          resourceId: `new-resource-${request.channelId}`,
        }
      },
    )
    const stopChannel = vi.fn<GoogleAdapter['stopChannel']>(async () => {
      calls.push('stop')
    })
    const { database, service } = setup(
      createFakeGoogleAdapter({ stopChannel, watchCalendarList }),
    )
    database.sqlite
      .prepare(`
        insert into watch_channels (
          channel_id, connection_id, kind, resource_id,
          verification_token_hash, expires_at, created_at, updated_at
        ) values ('old-channel', 1, 'CALENDAR_LIST', 'old-resource', ?, ?, ?, ?)
      `)
      .run(
        hashSecret('old-token'),
        now.getTime() + 60_000,
        now.getTime() - 60_000,
        now.getTime() - 60_000,
      )

    await service.ensureWatches()

    expect(calls).toEqual(['create', 'stop'])
    expect(
      database.sqlite
        .prepare('select stopped_at from watch_channels where channel_id = ?')
        .get('old-channel'),
    ).toEqual({ stopped_at: now.getTime() })
  })

  it('validates webhook headers and deduplicates queued sync work', () => {
    const { database, queue, service } = setup(createFakeGoogleAdapter())
    database.sqlite
      .prepare(`
        insert into watch_channels (
          channel_id, connection_id, kind, resource_id,
          verification_token_hash, expires_at, created_at, updated_at
        ) values ('channel-1', 1, 'CALENDAR_LIST', 'resource-1', ?, ?, ?, ?)
      `)
      .run(
        hashSecret('verification-token'),
        now.getTime() + 60_000,
        now.getTime(),
        now.getTime(),
      )
    const notification = {
      channelId: 'channel-1',
      channelToken: 'verification-token',
      messageNumber: '10',
      resourceId: 'resource-1',
      resourceState: 'exists',
    }

    expect(service.acceptNotification(notification)).toBe(true)
    expect(service.acceptNotification(notification)).toBe(true)
    expect(queue.counts()).toEqual({ PENDING: 1 })
    expect(
      service.acceptNotification({
        ...notification,
        channelToken: 'wrong-token',
      }),
    ).toBe(false)
  })

  it('does not request Google watch channels for local HTTP development', async () => {
    const watchCalendarList = vi.fn<GoogleAdapter['watchCalendarList']>()
    const adapter = createFakeGoogleAdapter({ watchCalendarList })
    const database = createTestDatabase()
    databases.push(database)
    const connection = new GoogleConnectionService(
      database,
      new TokenCipher(encodeSecretMaterial(new Uint8Array(32).fill(18))),
    )
    connection.connect('fixture-refresh-token', [...GOOGLE_CALENDAR_SCOPES])
    const service = new GoogleWatchService(
      database,
      adapter,
      connection,
      new SyncJobQueue(database),
      'http://localhost:8464',
    )

    expect(await service.ensureWatches()).toBe(0)
    expect(watchCalendarList).not.toHaveBeenCalled()
  })
})
