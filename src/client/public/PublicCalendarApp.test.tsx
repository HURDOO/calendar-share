// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PublicCalendarApp,
  type PublicCalendarData,
  PublicCalendarView,
} from './PublicCalendarApp'

const shareId = '30000000-0000-4000-8000-000000000001'

describe('PublicCalendarApp', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
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

  it('renders the complete retained dataset without fixed date boundaries', async () => {
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          calendarData({
            share: {
              id: shareId,
              name: '전체 일정',
              eventDateScope: 'ALL',
              eventStartDate: null,
              eventEndDate: null,
            },
          }),
        ),
      ),
    )

    render(<PublicCalendarApp expectedShareId={shareId} />)

    expect(await screen.findByText('전체 데이터')).toBeInTheDocument()
    expect(screen.getAllByText('저녁 식사').length).toBeGreaterThan(0)
  })

  it('switches between list, week, and month views and remembers the choice', async () => {
    const data = calendarData()
    const first = render(
      <PublicCalendarView data={data} showStreamStatus={false} />,
    )

    expect(screen.getByRole('button', { name: '목록' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: '주간' }))
    expect(
      screen.getByRole('region', { name: '주간 일정 달력' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '주간' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: '월간' }))
    expect(
      screen.getByRole('region', { name: '월간 일정 달력' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2026년 8월' })).toBeInTheDocument()
    first.unmount()

    render(<PublicCalendarView data={data} showStreamStatus={false} />)
    expect(screen.getByRole('button', { name: '월간' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows a multi-day event in each all-day cell it spans', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'))
    const event = calendarData().events[0]!
    const data = calendarData({
      events: [
        {
          ...event,
          id: 'multi-day-event',
          isAllDay: true,
          startsAt: null,
          endsAt: null,
          startDate: '2026-08-25',
          endDate: '2026-08-27',
          title: '여러 날 일정',
        },
      ],
    })
    const rendered = render(
      <PublicCalendarView data={data} showStreamStatus={false} />,
    )

    expect(
      within(rendered.container.querySelector('.visitor-list') as HTMLElement)
        .getAllByText('여러 날 일정'),
    ).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '주간' }))
    const timetable = rendered.container.querySelector('.week-timetable')
    expect(timetable).not.toBeNull()
    expect(
      within(timetable as HTMLElement).getAllByText('여러 날 일정'),
    ).toHaveLength(2)
  })

  it('places timed events on a Monday-to-Sunday 24-hour timetable', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'))
    const rendered = render(
      <PublicCalendarView data={calendarData()} showStreamStatus={false} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '주간' }))
    const timetable = rendered.container.querySelector('.week-timetable')
    const headers = rendered.container.querySelectorAll('.week-day-header')
    const event = rendered.container.querySelector('.week-timed-event')
    expect(timetable).toHaveAccessibleName(
      '월요일부터 일요일까지 24시간 주간 시간표',
    )
    expect([...headers].map((header) => header.textContent?.at(0))).toEqual([
      '월',
      '화',
      '수',
      '목',
      '금',
      '토',
      '일',
    ])
    expect(event).toHaveStyle({ height: '56px', top: '1008px' })
    expect(
      within(timetable as HTMLElement).getByText('24:00'),
    ).toBeInTheDocument()
  })

  it('shows compact locations, opens details, and opens a monthly date in its week', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'))
    const rendered = render(
      <PublicCalendarView data={calendarData()} showStreamStatus={false} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '월간' }))
    const month = rendered.container.querySelector('.visitor-month')
    expect(within(month as HTMLElement).getByText('저녁 식사')).toBeInTheDocument()
    expect(within(month as HTMLElement).getByText('우리 집')).toBeInTheDocument()
    const eventButton = within(month as HTMLElement).getByRole('button', {
      name: '저녁 식사 상세 보기',
    })
    eventButton.focus()
    fireEvent.click(eventButton)

    const dialog = screen.getByRole('dialog', { name: '저녁 식사' })
    expect(within(dialog).getByText('우리 집')).toBeInTheDocument()
    expect(within(dialog).getByText('함께 식사해요')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: '일정 상세 닫기' }),
    ).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(eventButton).toHaveFocus()

    fireEvent.click(
      within(month as HTMLElement).getByRole('button', {
        name: /8월 25일.*주간 보기/,
      }),
    )

    expect(screen.getByRole('button', { name: '주간' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.getByRole('heading', {
        name: '2026년 8월 24일 – 8월 30일',
      }),
    ).toBeInTheDocument()
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
      eventDateScope: 'SELECTED',
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
