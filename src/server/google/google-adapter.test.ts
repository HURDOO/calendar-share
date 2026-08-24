import { describe, expect, it } from 'vitest'

import { GoogleApiAdapter } from './google-adapter'
import { GOOGLE_CALENDAR_SCOPES } from './types'

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
