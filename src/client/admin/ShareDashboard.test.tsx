// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShareDashboard } from './ShareDashboard'

const shareId = '50000000-0000-4000-8000-000000000001'
const calendarOne = '50000000-0000-4000-8000-000000000011'
const calendarTwo = '50000000-0000-4000-8000-000000000012'

describe('ShareDashboard', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('creates, previews, edits, copies, and revokes a share', async () => {
    let storedShare: ReturnType<typeof shareFixture> | null = null
    let createPayload: Record<string, unknown> | null = null
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/v1/admin/calendars')) {
        return jsonResponse({
          calendars: [
            calendarFixture(calendarOne, '가족', true),
            calendarFixture(calendarTwo, '업무', false),
          ],
        })
      }
      if (url.endsWith('/api/v1/admin/shares') && method === 'GET') {
        return jsonResponse({ shares: [] })
      }
      if (url.endsWith('/api/v1/admin/shares') && method === 'POST') {
        createPayload = JSON.parse(String(init?.body)) as Record<string, unknown>
        storedShare = shareFixture({
          calendarIds: createPayload.calendarIds as string[],
          calendarScope: createPayload.calendarScope as 'ALL' | 'SELECTED',
          eventEndDate: createPayload.eventEndDate as string | null,
          eventDateScope: createPayload.eventDateScope as 'ALL' | 'SELECTED',
          eventStartDate: createPayload.eventStartDate as string | null,
          name: String(createPayload.name),
          shareUrl: 'https://calendar.app.hurdoo.kr/#share=persistent-link',
        })
        return jsonResponse({
          share: storedShare,
          shareUrl: storedShare.shareUrl,
          token: 'not-used-by-ui',
        }, 201)
      }
      if (url.endsWith(`/api/v1/admin/shares/${shareId}/preview`)) {
        return jsonResponse({
          availability: 'AVAILABLE',
          share: {
            id: shareId,
            name: storedShare?.name ?? '가족 공유',
            eventDateScope: storedShare?.eventDateScope ?? 'SELECTED',
            eventStartDate: storedShare
              ? storedShare.eventStartDate
              : '2026-08-25',
            eventEndDate: storedShare ? storedShare.eventEndDate : '2026-09-25',
          },
          events: [eventFixture()],
        })
      }
      if (url.endsWith(`/api/v1/admin/shares/${shareId}`) && method === 'PUT') {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
        storedShare = shareFixture({
          ...(storedShare ?? {}),
          name: String(payload.name),
          calendarIds: payload.calendarIds as string[],
          calendarScope: payload.calendarScope as 'ALL' | 'SELECTED',
        })
        return jsonResponse({ share: storedShare })
      }
      if (url.endsWith(`/api/v1/admin/shares/${shareId}`) && method === 'DELETE') {
        return { ok: true, status: 204 } as Response
      }
      throw new Error(`Unexpected fetch in test: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<ShareDashboard csrfToken="fixture-csrf" />)
    expect(
      await screen.findByText('아직 만든 공유가 없어요'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '새 공유 만들기' }))
    await userEvent.type(screen.getByLabelText('공유 이름'), '가족 공유')
    await userEvent.click(screen.getByLabelText(/선택한 캘린더만/))
    await userEvent.click(screen.getByLabelText('업무'))
    await userEvent.click(screen.getByLabelText(/전체 데이터/))
    await userEvent.click(screen.getByRole('button', { name: '공유 만들기' }))

    expect(
      await screen.findByDisplayValue(
        'https://calendar.app.hurdoo.kr/#share=persistent-link',
      ),
    ).toBeInTheDocument()
    expect(createPayload).toMatchObject({
      name: '가족 공유',
      calendarScope: 'SELECTED',
      calendarIds: [calendarOne],
      eventDateScope: 'ALL',
      eventStartDate: null,
      eventEndDate: null,
    })
    await userEvent.click(screen.getAllByRole('button', { name: '링크 복사' })[0]!)
    expect(writeText).toHaveBeenCalledWith(
      'https://calendar.app.hurdoo.kr/#share=persistent-link',
    )

    await userEvent.click(screen.getByRole('button', { name: '미리보기' }))
    const preview = await screen.findByRole('region', { name: '공유 미리보기' })
    expect(within(preview).getAllByText('정책과 같은 일정').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    const nameInput = screen.getByLabelText('공유 이름')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '수정된 가족 공유')
    await userEvent.click(screen.getByRole('button', { name: '변경 저장' }))
    expect(await screen.findByText('수정된 가족 공유')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '공유 종료' }))
    await waitFor(() => expect(screen.getByText('종료됨')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function calendarFixture(id: string, name: string, isPrimary: boolean) {
  return {
    id,
    name,
    color: isPrimary ? '#4b9ad1' : '#e09f4f',
    isPrimary,
    syncStatus: 'READY',
  }
}

function shareFixture(
  overrides: Partial<{
    id: string
    name: string
    calendarScope: 'ALL' | 'SELECTED'
    calendarIds: string[]
    eventDateScope: 'ALL' | 'SELECTED'
    eventStartDate: string | null
    eventEndDate: string | null
    shareUrl: string | null
    accessStartsAt: string | null
    accessEndsAt: string | null
    revokedAt: string | null
    createdAt: string
    updatedAt: string
  }> = {},
) {
  return {
    id: shareId,
    name: '가족 공유',
    calendarScope: 'SELECTED' as const,
    calendarIds: [calendarOne],
    eventDateScope: 'SELECTED' as const,
    eventStartDate: '2026-08-25',
    eventEndDate: '2026-09-25',
    shareUrl: 'https://calendar.app.hurdoo.kr/#share=persistent-link',
    accessStartsAt: null,
    accessEndsAt: null,
    revokedAt: null,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  }
}

function eventFixture() {
  return {
    id: 'preview-event',
    calendar: { id: calendarOne, name: '가족', color: '#4b9ad1' },
    isAllDay: false,
    startsAt: '2026-08-25T09:00:00.000Z',
    endsAt: '2026-08-25T10:00:00.000Z',
    startDate: null,
    endDate: null,
    title: '정책과 같은 일정',
    location: '우리 집',
    description: '같은 정책 평가 결과',
    isPrivate: false,
  }
}
