import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const shareId = '70000000-0000-4000-8000-000000000001'

test('has no detectable WCAG A or AA violations on public and login pages', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '캘공' })).toBeVisible()
  await expectAccessible(page)

  await page.route('**/api/v1/admin/session', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ code: 'AUTHENTICATION_REQUIRED' }),
      contentType: 'application/json',
      status: 401,
    })
  })
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: '관리자 로그인' })).toBeVisible()
  await expectAccessible(page)
})

test('has no detectable WCAG A or AA violations in the public calendar', async ({
  page,
}) => {
  await installEventSourceFallback(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/v1/public/events', async (route) => {
    await route.fulfill({
      body: JSON.stringify(publicData()),
      contentType: 'application/json',
      status: 200,
    })
  })

  await page.goto(`/share/${shareId}`)
  await expect(page.getByRole('heading', { name: '접근성 공유' })).toBeVisible()
  await expectAccessible(page)
})

test('has no detectable WCAG A or AA violations in the share form', async ({
  page,
}) => {
  await installAuthenticatedAdminApi(page)
  await page.goto('/admin')
  await page.getByRole('button', { name: '새 공유 만들기' }).click()
  await expect(page.getByLabel('공유 이름')).toBeFocused()
  await expectAccessible(page)
})

async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(result.violations).toEqual([])
}

async function installEventSourceFallback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: undefined,
    })
  })
}

async function installAuthenticatedAdminApi(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const bodies: Record<string, unknown> = {
      '/api/v1/admin/session': {
        authenticated: true,
        csrfToken: 'accessibility-csrf',
        expiresAt: '2026-08-25T08:00:00.000Z',
      },
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
            id: 'calendar-accessibility',
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
    if (!body) {
      return route.fulfill({ status: 404 })
    }
    return route.fulfill({
      body: JSON.stringify(body),
      contentType: 'application/json',
      status: 200,
    })
  })
}

function publicData() {
  return {
    availability: 'AVAILABLE',
    share: {
      id: shareId,
      name: '접근성 공유',
      eventStartDate: '2026-08-01',
      eventEndDate: '2026-09-30',
    },
    events: [
      {
        id: 'accessible-event',
        calendar: { id: 'calendar-accessibility', name: '가족', color: '#4b9ad1' },
        isAllDay: false,
        startsAt: '2026-08-25T09:00:00.000Z',
        endsAt: '2026-08-25T10:00:00.000Z',
        startDate: null,
        endDate: null,
        title: '접근 가능한 일정',
        location: '우리 집',
        description: '레이블과 대비를 확인합니다.',
        isPrivate: false,
      },
    ],
  }
}
