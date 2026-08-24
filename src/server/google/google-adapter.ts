import { CodeChallengeMethod } from 'google-auth-library'
import { google } from 'googleapis'

import {
  type AuthorizationRequest,
  type GoogleAdapter,
  GoogleApiError,
  type GoogleCalendarEntry,
  type GoogleEventEntry,
  GOOGLE_CALENDAR_SCOPES,
  type ListCalendarsRequest,
  type ListEventsRequest,
  type OAuthTokenResult,
  type Page,
  type WatchRequest,
  type WatchResult,
} from './types'

interface GoogleApiAdapterOptions {
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
}

export class GoogleApiAdapter implements GoogleAdapter {
  private readonly oauthClient
  private readonly calendarClient

  constructor({ clientId, clientSecret, redirectUri }: GoogleApiAdapterOptions) {
    this.oauthClient = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
    this.calendarClient = google.calendar({ version: 'v3', auth: this.oauthClient })
  }

  authorizationUrl({ codeChallenge, state }: AuthorizationRequest): string {
    return this.oauthClient.generateAuthUrl({
      access_type: 'offline',
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      include_granted_scopes: true,
      prompt: 'consent',
      scope: [...GOOGLE_CALENDAR_SCOPES],
      state,
    })
  }

  async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<OAuthTokenResult> {
    try {
      const { tokens } = await this.oauthClient.getToken({ code, codeVerifier })
      return {
        ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
        ...(tokens.expiry_date ? { expiresAt: new Date(tokens.expiry_date) } : {}),
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        scopes: tokens.scope?.split(' ').filter(Boolean) ?? [],
      }
    } catch (error) {
      throw toGoogleApiError(error)
    }
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
      await this.oauthClient.revokeToken(refreshToken)
    } catch (error) {
      throw toGoogleApiError(error)
    }
  }

  setRefreshToken(refreshToken: string): void {
    this.oauthClient.setCredentials({ refresh_token: refreshToken })
  }

  async listCalendars(
    request: ListCalendarsRequest,
  ): Promise<Page<GoogleCalendarEntry>> {
    try {
      const response = await this.calendarClient.calendarList.list({
        fields:
          'items(id,summary,backgroundColor,timeZone,primary,deleted),nextPageToken,nextSyncToken',
        maxResults: 250,
        showDeleted: true,
        ...(request.pageToken ? { pageToken: request.pageToken } : {}),
        ...(request.syncToken ? { syncToken: request.syncToken } : {}),
      })

      return {
        items: (response.data.items ?? []).flatMap((item) =>
          item.id
            ? [
                {
                  id: item.id,
                  summary: item.summary ?? item.id,
                  ...(item.backgroundColor
                    ? { backgroundColor: item.backgroundColor }
                    : {}),
                  ...(item.timeZone ? { timeZone: item.timeZone } : {}),
                  primary: item.primary ?? false,
                  deleted: item.deleted ?? false,
                },
              ]
            : [],
        ),
        ...(response.data.nextPageToken
          ? { nextPageToken: response.data.nextPageToken }
          : {}),
        ...(response.data.nextSyncToken
          ? { nextSyncToken: response.data.nextSyncToken }
          : {}),
      }
    } catch (error) {
      throw toGoogleApiError(error)
    }
  }

  async listEvents(request: ListEventsRequest): Promise<Page<GoogleEventEntry>> {
    try {
      const response = await this.calendarClient.events.list({
        calendarId: request.calendarId,
        fields:
          'items(id,status,etag,updated,start,end,recurringEventId,originalStartTime,visibility,summary,location,description),nextPageToken,nextSyncToken',
        maxResults: 2500,
        showDeleted: true,
        singleEvents: true,
        ...(request.pageToken ? { pageToken: request.pageToken } : {}),
        ...(request.syncToken ? { syncToken: request.syncToken } : {}),
        ...(request.timeMin ? { timeMin: request.timeMin } : {}),
        ...(request.timeMax ? { timeMax: request.timeMax } : {}),
      })

      return {
        items: (response.data.items ?? []).flatMap((item) =>
          item.id ? [toEventEntry(item)] : [],
        ),
        ...(response.data.nextPageToken
          ? { nextPageToken: response.data.nextPageToken }
          : {}),
        ...(response.data.nextSyncToken
          ? { nextSyncToken: response.data.nextSyncToken }
          : {}),
      }
    } catch (error) {
      throw toGoogleApiError(error)
    }
  }

  async watchCalendarList(request: WatchRequest): Promise<WatchResult> {
    try {
      const response = await this.calendarClient.calendarList.watch({
        requestBody: watchBody(request),
      })
      return watchResult(response.data.resourceId, response.data.expiration)
    } catch (error) {
      throw toGoogleApiError(error)
    }
  }

  async watchEvents(
    calendarId: string,
    request: WatchRequest,
  ): Promise<WatchResult> {
    try {
      const response = await this.calendarClient.events.watch({
        calendarId,
        requestBody: watchBody(request),
      })
      return watchResult(response.data.resourceId, response.data.expiration)
    } catch (error) {
      throw toGoogleApiError(error)
    }
  }

  async stopChannel(channelId: string, resourceId: string): Promise<void> {
    try {
      await this.calendarClient.channels.stop({
        requestBody: { id: channelId, resourceId },
      })
    } catch (error) {
      throw toGoogleApiError(error)
    }
  }
}

function toEventEntry(item: {
  id?: string | null
  status?: string | null
  etag?: string | null
  updated?: string | null
  start?: { date?: string | null; dateTime?: string | null; timeZone?: string | null } | null
  end?: { date?: string | null; dateTime?: string | null; timeZone?: string | null } | null
  recurringEventId?: string | null
  originalStartTime?: {
    date?: string | null
    dateTime?: string | null
    timeZone?: string | null
  } | null
  visibility?: string | null
  summary?: string | null
  location?: string | null
  description?: string | null
}): GoogleEventEntry {
  return {
    id: item.id ?? '',
    ...(item.status ? { status: item.status } : {}),
    ...(item.etag ? { etag: item.etag } : {}),
    ...(item.updated ? { updated: item.updated } : {}),
    ...(item.start ? { start: compactDateTime(item.start) } : {}),
    ...(item.end ? { end: compactDateTime(item.end) } : {}),
    ...(item.recurringEventId ? { recurringEventId: item.recurringEventId } : {}),
    ...(item.originalStartTime
      ? { originalStartTime: compactDateTime(item.originalStartTime) }
      : {}),
    ...(item.visibility ? { visibility: item.visibility } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
    ...(item.location ? { location: item.location } : {}),
    ...(item.description ? { description: item.description } : {}),
  }
}

function compactDateTime(value: {
  date?: string | null
  dateTime?: string | null
  timeZone?: string | null
}) {
  return {
    ...(value.date ? { date: value.date } : {}),
    ...(value.dateTime ? { dateTime: value.dateTime } : {}),
    ...(value.timeZone ? { timeZone: value.timeZone } : {}),
  }
}

function watchBody(request: WatchRequest) {
  return {
    address: request.address,
    expiration: String(request.expiration.getTime()),
    id: request.channelId,
    token: request.token,
    type: 'web_hook',
  }
}

function watchResult(
  resourceId: string | null | undefined,
  expiration: string | null | undefined,
): WatchResult {
  if (!resourceId || !expiration || !Number.isFinite(Number(expiration))) {
    throw new GoogleApiError(502, 'PERMANENT')
  }

  return { resourceId, expiration: new Date(Number(expiration)) }
}

function toGoogleApiError(error: unknown): GoogleApiError {
  const status =
    typeof error === 'object' && error && 'code' in error
      ? Number((error as { code?: unknown }).code)
      : 500

  if (status === 401 || status === 403) {
    return new GoogleApiError(status, 'AUTH')
  }

  if (status === 410) {
    return new GoogleApiError(status, 'GONE')
  }

  if (status === 429) {
    return new GoogleApiError(status, 'RATE_LIMIT')
  }

  if (status >= 500) {
    return new GoogleApiError(status, 'TRANSIENT')
  }

  return new GoogleApiError(status, 'PERMANENT')
}
