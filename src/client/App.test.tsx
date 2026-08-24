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
})
