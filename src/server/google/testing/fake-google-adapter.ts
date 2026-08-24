import type {
  GoogleAdapter,
  GoogleCalendarEntry,
  GoogleEventEntry,
  Page,
  WatchResult,
} from '../types'

export function createFakeGoogleAdapter(
  overrides: Partial<GoogleAdapter> = {},
): GoogleAdapter {
  return {
    authorizationUrl: () => 'https://accounts.google.test/authorize',
    exchangeAuthorizationCode: async () => ({
      refreshToken: 'fixture-refresh-token',
      scopes: [],
    }),
    revokeRefreshToken: async () => undefined,
    setRefreshToken: () => undefined,
    listCalendars: async (): Promise<Page<GoogleCalendarEntry>> => ({
      items: [],
      nextSyncToken: 'calendar-sync-token',
    }),
    listEvents: async (): Promise<Page<GoogleEventEntry>> => ({
      items: [],
      nextSyncToken: 'event-sync-token',
    }),
    watchCalendarList: async (): Promise<WatchResult> => ({
      expiration: new Date('2026-08-26T00:00:00.000Z'),
      resourceId: 'calendar-list-resource',
    }),
    watchEvents: async (): Promise<WatchResult> => ({
      expiration: new Date('2026-08-26T00:00:00.000Z'),
      resourceId: 'events-resource',
    }),
    stopChannel: async () => undefined,
    ...overrides,
  }
}
