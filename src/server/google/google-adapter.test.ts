import { describe, expect, it } from 'vitest'

import { google } from 'googleapis'

import { GoogleApiAdapter, toGoogleApiError } from './google-adapter'
import { googleErrorCode } from './sync-service'
import { GOOGLE_CALENDAR_SCOPES, GoogleApiError } from './types'

describe('GoogleApiAdapter OAuth contract', () => {
  it('requests offline read-only access with S256 PKCE and the exact callback', () => {
    const redirectUri =
      'https://calendar.app.hurdoo.kr/api/v1/admin/google/callback'
    const adapter = new GoogleApiAdapter({
      clientId: 'fixture-client-id',
      clientSecret: 'fixture-client-secret',
      redirectUri,
    })

    const authorization = new URL(
      adapter.authorizationUrl({
        codeChallenge: 'fixture-code-challenge',
        state: 'fixture-state',
      }),
    )

    expect(authorization.origin).toBe('https://accounts.google.com')
    expect(authorization.searchParams.get('access_type')).toBe('offline')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('code_challenge')).toBe(
      'fixture-code-challenge',
    )
    expect(authorization.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(authorization.searchParams.get('state')).toBe('fixture-state')
    expect(authorization.searchParams.get('scope')?.split(' ').sort()).toEqual(
      [...GOOGLE_CALENDAR_SCOPES].sort(),
    )
  })
})

describe('toGoogleApiError', () => {
  function httpError(status: number, error: unknown) {
    return Object.assign(new Error('request failed'), {
      name: 'GaxiosError',
      code: status,
      status,
      response: { status, data: { error } },
    })
  }

  it('treats an expired or revoked refresh token as re-authorization, not permanent', () => {
    const result = toGoogleApiError(httpError(400, 'invalid_grant'))
    expect(result).toMatchObject({ status: 400, category: 'AUTH', reason: 'invalid_grant' })
  })

  it('retries network failures that have no HTTP response', async () => {
    const calendar = google.calendar({ version: 'v3', rootUrl: 'https://127.0.0.1:1/' })
    const failure = await calendar.calendarList.list({ key: 'fixture' }).catch((error: unknown) => error)

    expect(toGoogleApiError(failure)).toMatchObject({ category: 'TRANSIENT', reason: 'ECONNREFUSED' })
    expect(
      toGoogleApiError(Object.assign(new Error('timeout'), { name: 'TimeoutError' })).category,
    ).toBe('TRANSIENT')
  })

  it('maps Google API statuses and keeps a safe reason', () => {
    const apiError = (status: number, reason: string) =>
      httpError(status, { code: status, message: 'detail', errors: [{ reason }] })

    expect(toGoogleApiError(apiError(403, 'rateLimitExceeded')).category).toBe('RATE_LIMIT')
    expect(toGoogleApiError(apiError(403, 'insufficientPermissions')).category).toBe('AUTH')
    expect(toGoogleApiError(apiError(410, 'fullSyncRequired')).category).toBe('GONE')
    expect(toGoogleApiError(apiError(503, 'backendError')).category).toBe('TRANSIENT')
    expect(toGoogleApiError(apiError(404, 'notFound'))).toMatchObject({
      category: 'PERMANENT',
      status: 404,
      reason: 'notFound',
    })
    expect(toGoogleApiError(httpError(400, 'has spaces <script>')).reason).toBeNull()
  })

  it('does not retry unknown non-HTTP errors', () => {
    expect(toGoogleApiError(new Error('No refresh token is set.')).category).toBe('PERMANENT')
  })
})

describe('googleErrorCode', () => {
  it('adds status and reason only to permanent failures', () => {
    expect(googleErrorCode(new GoogleApiError(404, 'PERMANENT', 'notFound'))).toBe(
      'GOOGLE_PERMANENT_404_notFound',
    )
    expect(googleErrorCode(new GoogleApiError(400, 'AUTH', 'invalid_grant'))).toBe('GOOGLE_AUTH')
  })
})
