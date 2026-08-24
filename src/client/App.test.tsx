// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'

describe('App', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/')
    vi.unstubAllGlobals()
  })

  it('renders the public status without an administrator link', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '캘공' })).toBeInTheDocument()
    expect(screen.getByText('관리자 인증')).toBeInTheDocument()
    expect(screen.getByText('Google Calendar 연결')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /관리자/ })).not.toBeInTheDocument()
  })

  it('logs in from the directly entered admin route', async () => {
    window.history.pushState({}, '', '/admin')
    const fetchMock = vi
      .fn<typeof fetch>()
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    })
  })
})
