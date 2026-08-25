import { expect, test, type Page } from '@playwright/test'

const shareId = '40000000-0000-4000-8000-000000000001'
const shareToken = 'A'.repeat(43)

test.beforeEach(async ({ page }) => {
  await installMockEventSource(page)
  await page.route('**/api/v1/public/session', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: shareToken })
    expect(route.request().url()).not.toContain(shareToken)
    expect(route.request().headers().origin).toBe('http://127.0.0.1:4177')
    await route.fulfill({
      body: JSON.stringify({ shareId }),
      contentType: 'application/json',
      headers: {
        'set-cookie': 'calendar_visitor_session=fixture; HttpOnly; Path=/; SameSite=Lax',
      },
      status: 201,
    })
  })
})

test('opens a token link as a clean mobile calendar and refreshes on SSE', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let requestCount = 0
  await page.route('**/api/v1/public/events', async (route) => {
    requestCount += 1
    await route.fulfill({
      body: JSON.stringify(
        publicData(requestCount === 1 ? '모바일 첫 일정' : '자동 반영된 일정'),
      ),
      contentType: 'application/json',
      status: 200,
    })
  })

  await page.goto(`/#share=${shareToken}`)

  await expect(page).toHaveURL(new RegExp(`/share/${shareId}$`))
  await expect(page.getByRole('heading', { name: '가족 공유' })).toBeVisible()
  await expect(page.locator('.visitor-list')).toBeVisible()
  await expect(page.getByRole('button', { name: '목록' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.visitor-list').getByText('모바일 첫 일정')).toBeVisible()
  await expect(page.locator('.visitor-list').getByText('우리 집')).toBeVisible()
  await expect(page.locator('.visitor-list').getByText('함께 식사해요')).toBeVisible()
  await expect(page.getByRole('link', { name: /관리자/ })).toHaveCount(0)
  expect(page.url()).not.toContain(shareToken)

  await page.getByRole('button', { name: '주간', exact: true }).click()
  await expect(page.locator('.week-timetable-scroll')).toBeVisible()
  await expect(page.locator('.week-timed-event').getByText('모바일 첫 일정')).toBeVisible()
  await expect(page.locator('.week-timed-event').getByText('우리 집')).toBeVisible()
  await page.getByRole('button', { name: '모바일 첫 일정 상세 보기' }).click()
  const weekDialog = page.getByRole('dialog', { name: '모바일 첫 일정' })
  await expect(weekDialog.getByText('우리 집')).toBeVisible()
  await expect(weekDialog.getByText('함께 식사해요')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(weekDialog).toHaveCount(0)
  await expectFullWeekToFit(page)
  await page.setViewportSize({ width: 320, height: 844 })
  await expectFullWeekToFit(page)
  await page.getByRole('button', { name: '월간' }).click()
  await expect(page.locator('.visitor-month')).toBeVisible()
  await expect(page.getByRole('heading', { name: '2026년 8월' })).toBeVisible()
  await expect(page.locator('.visitor-month').getByText('모바일 첫 일정')).toBeVisible()
  await expect(page.locator('.visitor-month').getByText('우리 집')).toBeVisible()
  await page.getByRole('button', { name: '모바일 첫 일정 상세 보기' }).click()
  const monthDialog = page.getByRole('dialog', { name: '모바일 첫 일정' })
  await expect(monthDialog.getByText('함께 식사해요')).toBeVisible()
  await monthDialog.getByRole('button', { name: '일정 상세 닫기' }).click()
  await page
    .getByRole('button', { name: /8월 25일.*주간 보기/ })
    .locator('.calendar-day__number')
    .click()
  await expect(
    page.getByRole('button', { name: '주간', exact: true }),
  ).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '목록' }).click()

  await page.evaluate(() => {
    ;(window as unknown as { emitCalendarEvent: (type: string) => void }).emitCalendarEvent(
      'changed',
    )
  })

  await expect(
    page.locator('.visitor-list').getByText('자동 반영된 일정'),
  ).toBeVisible()
  expect(requestCount).toBe(2)
})

test('shows the monthly calendar on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.route('**/api/v1/public/events', async (route) => {
    await route.fulfill({
      body: JSON.stringify(publicData('데스크톱 일정')),
      contentType: 'application/json',
      status: 200,
    })
  })

  await page.goto(`/#share=${shareToken}`)

  await expect(page.locator('.visitor-month')).toBeVisible()
  await expect(page.getByRole('button', { name: '월간' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('heading', { name: '2026년 8월' })).toBeVisible()
  await expect(
    page.locator('.visitor-month').getByText('데스크톱 일정'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '이전 달' })).toBeDisabled()
  await page.getByRole('button', { name: '주간', exact: true }).click()
  await expect(page.locator('.week-timetable')).toBeVisible()
  await expect(page.locator('.week-timed-event').getByText('데스크톱 일정')).toBeVisible()
  await expect(page.locator('.week-day-header').first()).toContainText('월')
  await page.getByRole('button', { name: '목록' }).click()
  await expect(page.locator('.visitor-list').getByText('데스크톱 일정')).toBeVisible()
  await expect(page.getByRole('link', { name: /관리자/ })).toHaveCount(0)
})

async function expectFullWeekToFit(page: Page): Promise<void> {
  const metrics = await page.locator('.week-timetable-scroll').evaluate((scroll) => {
    const headers = [...scroll.querySelectorAll('.week-day-header')]
    const timeColumn = scroll.querySelector('.week-time-column')
    const scrollBounds = scroll.getBoundingClientRect()
    const lastHeaderBounds = headers.at(-1)?.getBoundingClientRect()
    return {
      clientWidth: scroll.clientWidth,
      headerCount: headers.length,
      lastHeaderRight: lastHeaderBounds?.right ?? Number.POSITIVE_INFINITY,
      scrollRight: scrollBounds.right,
      scrollWidth: scroll.scrollWidth,
      timeColumnHeight: timeColumn?.getBoundingClientRect().height ?? 0,
    }
  })
  expect(metrics.headerCount).toBe(7)
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  expect(metrics.lastHeaderRight).toBeLessThanOrEqual(metrics.scrollRight + 1)
  expect(metrics.timeColumnHeight).toBe(816)
}

async function installMockEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class BrowserMockEventSource {
      static latest: BrowserMockEventSource | null = null
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      private readonly listeners = new Map<string, Array<() => void>>()

      constructor() {
        BrowserMockEventSource.latest = this
        queueMicrotask(() => this.onopen?.())
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

    ;(window as unknown as { EventSource: typeof BrowserMockEventSource }).EventSource =
      BrowserMockEventSource
    ;(
      window as unknown as { emitCalendarEvent: (type: string) => void }
    ).emitCalendarEvent = (type) => BrowserMockEventSource.latest?.emit(type)
  })
}

function publicData(title: string) {
  return {
    availability: 'AVAILABLE',
    share: {
      id: shareId,
      name: '가족 공유',
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
        title,
        location: '우리 집',
        description: '함께 식사해요',
        isPrivate: false,
      },
    ],
  }
}
