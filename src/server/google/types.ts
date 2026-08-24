export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
] as const

export interface AuthorizationRequest {
  readonly codeChallenge: string
  readonly state: string
}

export interface OAuthTokenResult {
  readonly accessToken?: string
  readonly expiresAt?: Date
  readonly refreshToken?: string
  readonly scopes: string[]
}

export interface GoogleCalendarEntry {
  readonly id: string
  readonly summary: string
  readonly backgroundColor?: string
  readonly timeZone?: string
  readonly primary: boolean
  readonly deleted: boolean
}

export interface GoogleEventDateTime {
  readonly date?: string
  readonly dateTime?: string
  readonly timeZone?: string
}

export interface GoogleEventEntry {
  readonly id: string
  readonly status?: string
  readonly etag?: string
  readonly updated?: string
  readonly start?: GoogleEventDateTime
  readonly end?: GoogleEventDateTime
  readonly recurringEventId?: string
  readonly originalStartTime?: GoogleEventDateTime
  readonly visibility?: string
  readonly summary?: string
  readonly location?: string
  readonly description?: string
}

export interface Page<T> {
  readonly items: T[]
  readonly nextPageToken?: string
  readonly nextSyncToken?: string
}

export interface ListCalendarsRequest {
  readonly pageToken?: string
  readonly syncToken?: string
}

export interface ListEventsRequest {
  readonly calendarId: string
  readonly pageToken?: string
  readonly syncToken?: string
  readonly timeMin?: string
  readonly timeMax?: string
}

export interface WatchRequest {
  readonly address: string
  readonly channelId: string
  readonly expiration: Date
  readonly token: string
}

export interface WatchResult {
  readonly expiration: Date
  readonly resourceId: string
}

export interface GoogleAdapter {
  authorizationUrl(request: AuthorizationRequest): string
  exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<OAuthTokenResult>
  revokeRefreshToken(refreshToken: string): Promise<void>
  setRefreshToken(refreshToken: string): void
  listCalendars(request: ListCalendarsRequest): Promise<Page<GoogleCalendarEntry>>
  listEvents(request: ListEventsRequest): Promise<Page<GoogleEventEntry>>
  watchCalendarList(request: WatchRequest): Promise<WatchResult>
  watchEvents(calendarId: string, request: WatchRequest): Promise<WatchResult>
  stopChannel(channelId: string, resourceId: string): Promise<void>
}

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly category: 'AUTH' | 'GONE' | 'RATE_LIMIT' | 'TRANSIENT' | 'PERMANENT',
  ) {
    super(`Google API request failed (${category})`)
    this.name = 'GoogleApiError'
  }
}
