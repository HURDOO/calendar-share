// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'

describe('App', () => {
  afterEach(() => {
    cleanup()
    window.history.pushState({}, '', '/')
    vi.unstubAllGlobals()
  })

  it('renders the public status without an administrator link', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '캘공' })).toBeInTheDocument()
    expect(screen.getByText('공유 링크 열기')).toBeInTheDocument()
    expect(screen.getByText('허용된 일정만')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /관리자/ })).not.toBeInTheDocument()
  })

  it('exchanges a fragment token for a clean visitor session', async () => {
    const token = 'A'.repeat(43)
    const shareId = '30000000-0000-4000-8000-000000000001'
    vi.stubGlobal('EventSource', undefined)
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/public/session')) {
        expect(init).toMatchObject({
          body: JSON.stringify({ token }),
          credentials: 'same-origin',
          method: 'POST',
        })
        return jsonResponse({ shareId }, 201)
      }
      if (url.endsWith('/api/v1/public/events')) {
        return jsonResponse({
          availability: 'AVAILABLE',
          share: {
            id: shareId,
            name: '조각 링크 공유',
            eventDateScope: 'ALL',
            eventStartDate: null,
            eventEndDate: null,
          },
          events: [],
        })
      }
      throw new Error(`Unexpected fetch in test: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App initialShareToken={token} />)

    expect(
      await screen.findByRole('heading', { name: '조각 링크 공유' }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/share/${shareId}`)
    expect(window.location.hash).toBe('')
  })

  it('logs in from the directly entered admin route', async () => {
    window.history.pushState({}, '', '/admin')
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/admin/google/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            connected: false,
            lastErrorCode: null,
            lastSyncedAt: null,
            calendars: { active: 0, ready: 0 },
            queue: {},
          }),
        } as Response
      }
      if (url.endsWith('/api/v1/admin/calendars')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ calendars: [] }),
        } as Response
      }
      if (url.endsWith('/api/v1/admin/shares')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ shares: [] }),
        } as Response
      }
      throw new Error(`Unexpected fetch in test: ${url}`)
    })
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          authenticated: true,
          csrfToken: 'fixture-csrf-token',
          expiresAt: '2026-08-25T08:00:00.000Z',
        }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    expect(await screen.findByRole('heading', { name: '관리자 로그인' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('비밀번호'), 'fixture-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('heading', { name: '관리자 대시보드' })).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Google 계정 연결' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    })
  })

  it('reports the completed result of a manual Google sync', async () => {
    window.history.pushState({}, '', '/admin')
    const jobId = '70000000-0000-4000-8000-000000000001'
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/v1/admin/session')) {
        return jsonResponse({
          authenticated: true,
          csrfToken: 'fixture-csrf-token',
          expiresAt: '2026-08-25T08:00:00.000Z',
        })
      }
      if (url.endsWith('/api/v1/admin/google/status')) {
        return jsonResponse({
          connected: true,
          lastErrorCode: null,
          lastSyncedAt: '2026-08-25T00:00:00.000Z',
          calendars: { active: 1, ready: 1 },
          queue: {},
        })
      }
      if (url.endsWith('/api/v1/admin/calendars')) {
        return jsonResponse({ calendars: [] })
      }
      if (url.endsWith('/api/v1/admin/shares')) {
        return jsonResponse({ shares: [] })
      }
      if (url.endsWith('/api/v1/admin/google/sync') && method === 'POST') {
        return jsonResponse({ jobId, queued: true }, 202)
      }
      if (url.endsWith(`/api/v1/admin/google/sync/${jobId}`)) {
        return jsonResponse({
          status: 'SUCCEEDED',
          finishedAt: '2026-08-25T00:01:00.000Z',
          lastErrorCategory: null,
        })
      }
      throw new Error(`Unexpected fetch in test: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await userEvent.click(
      await screen.findByRole('button', { name: '지금 동기화' }),
    )
    expect(
      await screen.findByText(/복구 동기화를 완료했습니다/),
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/google/sync/${jobId}`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}
