// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PublicCalendarApp, type PublicCalendarData } from './PublicCalendarApp'

const shareId = '30000000-0000-4000-8000-000000000001'

describe('PublicCalendarApp', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the shared fields without administrator navigation', async () => {
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(calendarData())),
    )

    render(<PublicCalendarApp expectedShareId={shareId} />)

    expect(
      await screen.findByRole('heading', { name: '가족 일정' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('저녁 식사').length).toBeGreaterThan(0)
    expect(screen.getAllByText('우리 집').length).toBeGreaterThan(0)
    expect(screen.getAllByText('함께 식사해요').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /관리자/ })).not.toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(calendarData({ events: [] })),
      ),
    )
    render(<PublicCalendarApp expectedShareId={shareId} />)
    expect(await screen.findByText('공유된 일정이 없어요')).toBeInTheDocument()
  })

  it('shows an unavailable state without disclosing a reason', async () => {
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 401 } as Response),
    )
    render(<PublicCalendarApp expectedShareId={shareId} />)
    expect(await screen.findByText('이 공유는 열 수 없어요')).toBeInTheDocument()
  })

  it('offers a retry after a temporary loading error', async () => {
    vi.stubGlobal('EventSource', undefined)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse(calendarData()))
    vi.stubGlobal('fetch', fetchMock)
    render(<PublicCalendarApp expectedShareId={shareId} />)
    expect(await screen.findByText('일정을 불러오지 못했어요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(
      await screen.findByRole('heading', { name: '가족 일정' }),
    ).toBeInTheDocument()
  })

  it('refetches policy-filtered events after a data-free SSE signal', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(calendarData()))
      .mockResolvedValueOnce(
        jsonResponse(
          calendarData({
            events: [
              {
                ...calendarData().events[0]!,
                id: 'event-updated',
                title: '업데이트된 일정',
              },
            ],
          }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', MockEventSource)

    render(<PublicCalendarApp expectedShareId={shareId} />)
    expect((await screen.findAllByText('저녁 식사')).length).toBeGreaterThan(0)

    MockEventSource.latest?.emit('changed')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect((await screen.findAllByText('업데이트된 일정')).length).toBeGreaterThan(0)
  })
})

class MockEventSource {
  static latest: MockEventSource | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private readonly listeners = new Map<string, Array<() => void>>()

  constructor() {
    MockEventSource.latest = this
  }

  addEventListener(type: string, listener: () => void): void {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener()
    }
  }

  close(): void {}
}

function calendarData(
  overrides: Partial<PublicCalendarData> = {},
): PublicCalendarData {
  return {
    availability: 'AVAILABLE',
    share: {
      id: shareId,
      name: '가족 일정',
      eventStartDate: '2026-08-01',
      eventEndDate: '2026-08-31',
    },
    events: [
      {
        id: 'event-1',
        calendar: { id: 'calendar-1', name: '가족', color: '#4b9ad1' },
        isAllDay: false,
        startsAt: '2026-08-25T09:00:00.000Z',
        endsAt: '2026-08-25T10:00:00.000Z',
        startDate: null,
        endDate: null,
        title: '저녁 식사',
        location: '우리 집',
        description: '함께 식사해요',
        isPrivate: false,
      },
    ],
    ...overrides,
  }
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response
}
