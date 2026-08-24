import { randomUUID } from 'node:crypto'

import { generateSecret, hashSecret, secretsMatch } from '../../shared/secrets'
import type { AppDatabase } from '../db/database'
import { GoogleConnectionService } from './connection-service'
import { SyncJobQueue } from './job-queue'
import type { GoogleAdapter, WatchRequest, WatchResult } from './types'

const requestedChannelLifetimeMs = 7 * 24 * 60 * 60 * 1000
const renewalThresholdMs = 24 * 60 * 60 * 1000

interface WatchChannelRow {
  readonly channel_id: string
  readonly calendar_id: string | null
  readonly kind: 'CALENDAR_LIST' | 'EVENTS'
  readonly resource_id: string
  readonly verification_token_hash: string
  readonly expires_at: number
  readonly stopped_at: number | null
}

export interface WebhookNotification {
  readonly channelId?: string
  readonly channelToken?: string
  readonly messageNumber?: string
  readonly resourceId?: string
  readonly resourceState?: string
}

export class GoogleWatchService {
  private readonly webhookAddress: string

  constructor(
    private readonly database: AppDatabase,
    private readonly adapter: GoogleAdapter,
    private readonly connection: GoogleConnectionService,
    private readonly queue: SyncJobQueue,
    appBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.webhookAddress = new URL('/api/v1/google/webhook', appBaseUrl).toString()
  }

  watchesEnabled(): boolean {
    const url = new URL(this.webhookAddress)
    return url.protocol === 'https:' && url.hostname !== 'localhost'
  }

  async ensureWatches(): Promise<number> {
    if (!this.watchesEnabled()) {
      return 0
    }

    this.adapter.setRefreshToken(this.connection.refreshToken())
    let created = 0

    if (!(await this.hasFreshChannel('CALENDAR_LIST', null))) {
      await this.replaceChannel('CALENDAR_LIST', null, null)
      created += 1
    }

    const calendars = this.database.sqlite
      .prepare(
        `select id, google_calendar_id
         from calendars where connection_id = 1 and is_active = 1`,
      )
      .all() as { id: string; google_calendar_id: string }[]

    for (const calendar of calendars) {
      if (!(await this.hasFreshChannel('EVENTS', calendar.id))) {
        await this.replaceChannel('EVENTS', calendar.id, calendar.google_calendar_id)
        created += 1
      }
    }

    return created
  }

  acceptNotification(notification: WebhookNotification): boolean {
    if (
      !notification.channelId ||
      !notification.channelToken ||
      !notification.resourceId ||
      !notification.messageNumber ||
      !notification.resourceState ||
      !['sync', 'exists', 'not_exists'].includes(notification.resourceState)
    ) {
      return false
    }

    const channel = this.database.sqlite
      .prepare(
        `select channel_id, calendar_id, kind, resource_id,
                verification_token_hash, expires_at, stopped_at
         from watch_channels where channel_id = ?`,
      )
      .get(notification.channelId) as WatchChannelRow | undefined

    if (
      !channel ||
      channel.stopped_at ||
      channel.expires_at <= this.now().getTime() ||
      channel.resource_id !== notification.resourceId ||
      !secretsMatch(
        channel.verification_token_hash,
        hashSecret(notification.channelToken),
      )
    ) {
      return false
    }

    this.database.sqlite
      .prepare(
        'update watch_channels set last_message_number = ?, updated_at = ? where channel_id = ?',
      )
      .run(notification.messageNumber, this.now().getTime(), channel.channel_id)

    if (channel.kind === 'CALENDAR_LIST') {
      this.queue.enqueue('CALENDAR_LIST_SYNC', 'calendar-list')
    } else if (channel.calendar_id) {
      this.queue.enqueue(
        'CALENDAR_EVENTS_SYNC',
        `calendar-events:${channel.calendar_id}`,
        channel.calendar_id,
      )
    }

    return true
  }

  async stopAll(): Promise<void> {
    const activeChannels = this.activeChannels()

    if (activeChannels.length > 0) {
      this.adapter.setRefreshToken(this.connection.refreshToken())
    }

    for (const channel of activeChannels) {
      await this.adapter.stopChannel(channel.channel_id, channel.resource_id)
      this.markStopped(channel.channel_id)
    }
  }

  private async hasFreshChannel(
    kind: WatchChannelRow['kind'],
    calendarId: string | null,
  ): Promise<boolean> {
    const threshold = this.now().getTime() + renewalThresholdMs
    const row = this.database.sqlite
      .prepare(`
        select 1 from watch_channels
        where kind = ?
          and ((calendar_id = ?) or (calendar_id is null and ? is null))
          and stopped_at is null
          and expires_at > ?
        limit 1
      `)
      .get(kind, calendarId, calendarId, threshold)

    return Boolean(row)
  }

  private async replaceChannel(
    kind: WatchChannelRow['kind'],
    calendarId: string | null,
    googleCalendarId: string | null,
  ): Promise<void> {
    const previous = this.database.sqlite
      .prepare(`
        select channel_id, calendar_id, kind, resource_id,
               verification_token_hash, expires_at, stopped_at
        from watch_channels
        where kind = ?
          and ((calendar_id = ?) or (calendar_id is null and ? is null))
          and stopped_at is null
        order by expires_at desc
        limit 1
      `)
      .get(kind, calendarId, calendarId) as WatchChannelRow | undefined
    const token = generateSecret()
    const request: WatchRequest = {
      address: this.webhookAddress,
      channelId: randomUUID(),
      expiration: new Date(this.now().getTime() + requestedChannelLifetimeMs),
      token,
    }
    const result =
      kind === 'CALENDAR_LIST'
        ? await this.adapter.watchCalendarList(request)
        : await this.adapter.watchEvents(assertGoogleCalendarId(googleCalendarId), request)

    this.storeChannel(kind, calendarId, request, result)

    if (previous) {
      await this.adapter.stopChannel(previous.channel_id, previous.resource_id)
      this.markStopped(previous.channel_id)
    }
  }

  private storeChannel(
    kind: WatchChannelRow['kind'],
    calendarId: string | null,
    request: WatchRequest,
    result: WatchResult,
  ): void {
    const now = this.now()
    this.database.sqlite
      .prepare(`
        insert into watch_channels (
          channel_id, connection_id, calendar_id, kind, resource_id,
          verification_token_hash, expires_at, created_at, updated_at
        ) values (?, 1, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        request.channelId,
        calendarId,
        kind,
        result.resourceId,
        hashSecret(request.token),
        result.expiration.getTime(),
        now.getTime(),
        now.getTime(),
      )
  }

  private activeChannels(): WatchChannelRow[] {
    return this.database.sqlite
      .prepare(`
        select channel_id, calendar_id, kind, resource_id,
               verification_token_hash, expires_at, stopped_at
        from watch_channels where stopped_at is null
      `)
      .all() as WatchChannelRow[]
  }

  private markStopped(channelId: string): void {
    const now = this.now().getTime()
    this.database.sqlite
      .prepare(
        'update watch_channels set stopped_at = ?, updated_at = ? where channel_id = ?',
      )
      .run(now, now, channelId)
  }
}

function assertGoogleCalendarId(value: string | null): string {
  if (!value) {
    throw new Error('GOOGLE_CALENDAR_ID_MISSING')
  }
  return value
}
