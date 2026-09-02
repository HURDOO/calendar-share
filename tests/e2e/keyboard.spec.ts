import { expect, test, type Page } from '@playwright/test'

const shareId = '80000000-0000-4000-8000-000000000001'

test('supports administrator login and share editing from the keyboard', async ({
  page,
}) => {
  await installKeyboardAdminApi(page)
  await page.goto('/admin')

  const password = page.getByLabel('비밀번호')
  await password.focus()
  await page.keyboard.type('keyboard-password')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '관리자 대시보드' })).toBeVisible()

  const createButton = page.getByRole('button', { name: '새 공유 만들기' })
  await createButton.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('공유 이름')).toBeFocused()

  await page.keyboard.type('키보드 공유')
  const selectedScope = page.getByLabel(/선택한 캘린더만/)
  await selectedScope.focus()
  await page.keyboard.press('Space')
  await expect(selectedScope).toBeChecked()
  await expect(page.getByLabel('가족')).toBeChecked()
})

test('switches views and moves between periods with the keyboard', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-08-25T00:00:00.000Z'))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: undefined,
    })
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.route('**/api/v1/public/events', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        availability: 'AVAILABLE',
        share: {
          id: shareId,
          name: '키보드 달력',
          eventDateScope: 'SELECTED',
          eventStartDate: '2026-07-01',
          eventEndDate: '2026-10-31',
        },
        events: [
          {
            id: 'keyboard-event',
            calendar: { id: 'keyboard-calendar', name: '가족', color: '#4b9ad1' },
            isAllDay: true,
            startsAt: null,
            endsAt: null,
            startDate: '2026-08-25',
            endDate: '2026-08-26',
            title: '키보드 일정',
            location: null,
            description: null,
            isPrivate: false,
          },
        ],
      }),
      contentType: 'application/json',
      status: 200,
    })
  })

  await page.goto(`/share/${shareId}`)
  const nextMonth = page.getByRole('button', { name: '다음 달' })
  await nextMonth.focus()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { name: '2026년 9월' })).toBeVisible()
  await expect(nextMonth).toBeFocused()

  const weekView = page.getByRole('button', { name: '주간', exact: true })
  await weekView.focus()
  await page.keyboard.press('Enter')

  await expect(weekView).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: '주간 일정 달력' })).toBeVisible()
  await expect(page.locator('.week-timetable')).toBeVisible()
  await expect(weekView).toBeFocused()
})

async function installKeyboardAdminApi(page: Page): Promise<void> {
  let authenticated = false
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/admin/session') {
      if (request.method() === 'POST') {
        authenticated = true
      }
      if (!authenticated) {
        return route.fulfill({
          body: JSON.stringify({ code: 'AUTHENTICATION_REQUIRED' }),
          contentType: 'application/json',
          status: 401,
        })
      }
      return route.fulfill({
        body: JSON.stringify({
          authenticated: true,
          csrfToken: 'keyboard-csrf',
          expiresAt: '2026-08-25T08:00:00.000Z',
        }),
        contentType: 'application/json',
        status: request.method() === 'POST' ? 201 : 200,
      })
    }
    const bodies: Record<string, unknown> = {
      '/api/v1/admin/google/status': {
        connected: false,
        lastErrorCode: null,
        lastSyncedAt: null,
        calendars: { active: 1, ready: 1 },
        queue: {},
      },
      '/api/v1/admin/calendars': {
        calendars: [
          {
            id: 'keyboard-calendar',
            name: '가족',
            color: '#4b9ad1',
            isPrimary: true,
            syncStatus: 'READY',
          },
        ],
      },
      '/api/v1/admin/shares': { shares: [] },
    }
    const body = bodies[path]
    return body
      ? route.fulfill({
          body: JSON.stringify(body),
          contentType: 'application/json',
          status: 200,
        })
      : route.fulfill({ status: 404 })
  })
}
