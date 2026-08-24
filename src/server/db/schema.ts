import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const nowInMilliseconds = sql`(unixepoch() * 1000)`

export const googleConnections = sqliteTable(
  'google_connections',
  {
    id: integer('id').primaryKey().default(1),
    status: text('status', {
      enum: ['DISCONNECTED', 'CONNECTED', 'ERROR'],
    })
      .notNull()
      .default('DISCONNECTED'),
    refreshTokenCiphertext: text('refresh_token_ciphertext'),
    scopes: text('scopes_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    connectedAt: integer('connected_at', { mode: 'timestamp_ms' }),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
    lastErrorCode: text('last_error_code'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    check('google_connections_singleton', sql`${table.id} = 1`),
    check(
      'google_connections_status',
      sql`${table.status} in ('DISCONNECTED', 'CONNECTED', 'ERROR')`,
    ),
    check(
      'google_connections_connected_token',
      sql`${table.status} <> 'CONNECTED' or ${table.refreshTokenCiphertext} is not null`,
    ),
  ],
)

export const calendars = sqliteTable(
  'calendars',
  {
    id: text('id').primaryKey(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => googleConnections.id, { onDelete: 'cascade' }),
    googleCalendarId: text('google_calendar_id').notNull(),
    displayName: text('display_name').notNull(),
    color: text('color'),
    timeZone: text('time_zone'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    syncToken: text('sync_token'),
    syncStatus: text('sync_status', {
      enum: ['NEVER', 'SYNCING', 'READY', 'ERROR'],
    })
      .notNull()
      .default('NEVER'),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
    lastSyncErrorCode: text('last_sync_error_code'),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex('calendars_connection_google_id_unique').on(
      table.connectionId,
      table.googleCalendarId,
    ),
    index('calendars_active_idx').on(table.connectionId, table.isActive),
    check(
      'calendars_sync_status',
      sql`${table.syncStatus} in ('NEVER', 'SYNCING', 'READY', 'ERROR')`,
    ),
    check('calendars_is_primary', sql`${table.isPrimary} in (0, 1)`),
    check('calendars_is_active', sql`${table.isActive} in (0, 1)`),
  ],
)

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    calendarId: text('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    googleEventId: text('google_event_id').notNull(),
    status: text('status', { enum: ['CONFIRMED', 'TENTATIVE', 'CANCELLED'] })
      .notNull()
      .default('CONFIRMED'),
    etag: text('etag'),
    googleUpdatedAt: integer('google_updated_at', { mode: 'timestamp_ms' }),
    isAllDay: integer('is_all_day', { mode: 'boolean' }).notNull(),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }),
    endsAt: integer('ends_at', { mode: 'timestamp_ms' }),
    startDate: text('start_date'),
    endDate: text('end_date'),
    startTimeZone: text('start_time_zone'),
    endTimeZone: text('end_time_zone'),
    recurringEventGoogleId: text('recurring_event_google_id'),
    originalStartsAt: integer('original_starts_at', { mode: 'timestamp_ms' }),
    originalStartDate: text('original_start_date'),
    visibility: text('visibility', {
      enum: ['DEFAULT', 'PUBLIC', 'PRIVATE', 'CONFIDENTIAL'],
    })
      .notNull()
      .default('DEFAULT'),
    title: text('title'),
    location: text('location'),
    description: text('description'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex('events_calendar_google_id_unique').on(
      table.calendarId,
      table.googleEventId,
    ),
    index('events_calendar_time_idx').on(
      table.calendarId,
      table.startsAt,
      table.endsAt,
    ),
    index('events_calendar_date_idx').on(
      table.calendarId,
      table.startDate,
      table.endDate,
    ),
    check(
      'events_status',
      sql`${table.status} in ('CONFIRMED', 'TENTATIVE', 'CANCELLED')`,
    ),
    check(
      'events_visibility',
      sql`${table.visibility} in ('DEFAULT', 'PUBLIC', 'PRIVATE', 'CONFIDENTIAL')`,
    ),
    check('events_is_all_day', sql`${table.isAllDay} in (0, 1)`),
    check(
      'events_time_shape',
      sql`(
        ${table.isAllDay} = 0
        and ${table.startsAt} is not null
        and ${table.endsAt} is not null
        and ${table.endsAt} > ${table.startsAt}
        and ${table.startDate} is null
        and ${table.endDate} is null
      ) or (
        ${table.isAllDay} = 1
        and ${table.startsAt} is null
        and ${table.endsAt} is null
        and ${table.startDate} is not null
        and ${table.endDate} is not null
        and length(${table.startDate}) = 10
        and length(${table.endDate}) = 10
        and ${table.startDate} = date(${table.startDate})
        and ${table.endDate} = date(${table.endDate})
        and ${table.endDate} > ${table.startDate}
      )`,
    ),
    check(
      'events_original_start_shape',
      sql`${table.originalStartsAt} is null or ${table.originalStartDate} is null`,
    ),
    check(
      'events_private_details',
      sql`${table.visibility} <> 'PRIVATE' or (
        ${table.title} is null
        and ${table.location} is null
        and ${table.description} is null
      )`,
    ),
  ],
)

export const shareLinks = sqliteTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    calendarScope: text('calendar_scope', { enum: ['ALL', 'SELECTED'] })
      .notNull()
      .default('ALL'),
    tokenHash: text('token_hash').notNull(),
    eventStartDate: text('event_start_date').notNull(),
    eventEndDate: text('event_end_date').notNull(),
    accessStartsAt: integer('access_starts_at', { mode: 'timestamp_ms' }),
    accessEndsAt: integer('access_ends_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex('share_links_token_hash_unique').on(table.tokenHash),
    index('share_links_access_idx').on(table.revokedAt, table.accessEndsAt),
    check('share_links_name', sql`length(trim(${table.name})) > 0`),
    check(
      'share_links_calendar_scope',
      sql`${table.calendarScope} in ('ALL', 'SELECTED')`,
    ),
    check(
      'share_links_event_date_range',
      sql`length(${table.eventStartDate}) = 10
        and length(${table.eventEndDate}) = 10
        and ${table.eventStartDate} = date(${table.eventStartDate})
        and ${table.eventEndDate} = date(${table.eventEndDate})
        and ${table.eventEndDate} >= ${table.eventStartDate}`,
    ),
    check(
      'share_links_access_range',
      sql`(
        ${table.accessStartsAt} is null and ${table.accessEndsAt} is null
      ) or (
        ${table.accessStartsAt} is not null
        and ${table.accessEndsAt} is not null
        and ${table.accessEndsAt} > ${table.accessStartsAt}
      )`,
    ),
  ],
)

export const shareCalendars = sqliteTable(
  'share_calendars',
  {
    shareId: text('share_id')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade' }),
    calendarId: text('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    primaryKey({
      columns: [table.shareId, table.calendarId],
      name: 'share_calendars_primary_key',
    }),
    index('share_calendars_calendar_idx').on(table.calendarId),
  ],
)

export const adminSessions = sqliteTable(
  'admin_sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex('admin_sessions_token_hash_unique').on(table.tokenHash),
    index('admin_sessions_expiry_idx').on(table.expiresAt, table.revokedAt),
    check('admin_sessions_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'admin_sessions_last_used',
      sql`${table.lastUsedAt} >= ${table.createdAt} and ${table.lastUsedAt} <= ${table.expiresAt}`,
    ),
    check(
      'admin_sessions_revoked',
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
)

export const visitorSessions = sqliteTable(
  'visitor_sessions',
  {
    id: text('id').primaryKey(),
    shareId: text('share_id')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex('visitor_sessions_token_hash_unique').on(table.tokenHash),
    index('visitor_sessions_share_idx').on(table.shareId),
    index('visitor_sessions_expiry_idx').on(table.expiresAt, table.revokedAt),
    check('visitor_sessions_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'visitor_sessions_last_used',
      sql`${table.lastUsedAt} >= ${table.createdAt} and ${table.lastUsedAt} <= ${table.expiresAt}`,
    ),
    check(
      'visitor_sessions_revoked',
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
)

export const watchChannels = sqliteTable(
  'watch_channels',
  {
    channelId: text('channel_id').primaryKey(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => googleConnections.id, { onDelete: 'cascade' }),
    calendarId: text('calendar_id').references(() => calendars.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind', { enum: ['CALENDAR_LIST', 'EVENTS'] }).notNull(),
    resourceId: text('resource_id').notNull(),
    verificationTokenHash: text('verification_token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastMessageNumber: text('last_message_number'),
    stoppedAt: integer('stopped_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index('watch_channels_resource_idx').on(table.resourceId),
    index('watch_channels_expiry_idx').on(table.stoppedAt, table.expiresAt),
    check(
      'watch_channels_kind',
      sql`${table.kind} in ('CALENDAR_LIST', 'EVENTS')`,
    ),
    check(
      'watch_channels_target',
      sql`(${table.kind} = 'CALENDAR_LIST' and ${table.calendarId} is null)
        or (${table.kind} = 'EVENTS' and ${table.calendarId} is not null)`,
    ),
    check('watch_channels_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)

export const syncJobs = sqliteTable(
  'sync_jobs',
  {
    id: text('id').primaryKey(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => googleConnections.id, { onDelete: 'cascade' }),
    calendarId: text('calendar_id').references(() => calendars.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind', {
      enum: [
        'CALENDAR_LIST_SYNC',
        'CALENDAR_EVENTS_SYNC',
        'CALENDAR_WINDOW_SYNC',
        'WATCH_RENEWAL',
        'RECOVERY_SYNC',
      ],
    }).notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status', {
      enum: ['PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED'],
    })
      .notNull()
      .default('PENDING'),
    payload: text('payload_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }).notNull(),
    lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    lastErrorCategory: text('last_error_category'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex('sync_jobs_active_dedupe_unique')
      .on(table.dedupeKey)
      .where(sql`${table.status} in ('PENDING', 'RUNNING', 'RETRY')`),
    index('sync_jobs_dequeue_idx').on(table.status, table.nextAttemptAt),
    index('sync_jobs_calendar_idx').on(table.calendarId),
    check(
      'sync_jobs_kind',
      sql`${table.kind} in (
        'CALENDAR_LIST_SYNC',
        'CALENDAR_EVENTS_SYNC',
        'CALENDAR_WINDOW_SYNC',
        'WATCH_RENEWAL',
        'RECOVERY_SYNC'
      )`,
    ),
    check(
      'sync_jobs_status',
      sql`${table.status} in ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED')`,
    ),
    check(
      'sync_jobs_attempts',
      sql`${table.attemptCount} >= 0
        and ${table.maxAttempts} > 0
        and ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
    check(
      'sync_jobs_locked_state',
      sql`(${table.status} = 'RUNNING' and ${table.lockedAt} is not null)
        or (${table.status} <> 'RUNNING')`,
    ),
    check(
      'sync_jobs_finished_state',
      sql`(${table.status} in ('SUCCEEDED', 'FAILED') and ${table.finishedAt} is not null)
        or (${table.status} not in ('SUCCEEDED', 'FAILED') and ${table.finishedAt} is null)`,
    ),
  ],
)

export const databaseSchema = {
  adminSessions,
  calendars,
  events,
  googleConnections,
  shareCalendars,
  shareLinks,
  syncJobs,
  visitorSessions,
  watchChannels,
}
