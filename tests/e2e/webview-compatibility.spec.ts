import { devices, expect, test } from '@playwright/test'

const shareId = '90000000-0000-4000-8000-000000000001'
const galaxy = devices['Galaxy S9+']

test.use({
  deviceScaleFactor: galaxy.deviceScaleFactor,
  hasTouch: galaxy.hasTouch,
  isMobile: galaxy.isMobile,
  userAgent: `${galaxy.userAgent} KAKAOTALK 26.8.0 (INAPP)`,
  viewport: galaxy.viewport,
})

test('renders a touch-safe calendar without modern streaming APIs', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Android WebView parity uses Chromium')
  await page.addInitScript(() => {
    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: undefined,
    })
  })
  await page.route('**/api/v1/public/events', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        availability: 'AVAILABLE',
        share: {
          id: shareId,
          name: '인앱 브라우저 공유',
          eventStartDate: '2026-08-01',
          eventEndDate: '2026-08-31',
        },
        events: [
          {
            id: 'webview-event',
            calendar: { id: 'webview-calendar', name: '가족', color: '#4b9ad1' },
            isAllDay: false,
            startsAt: '2026-08-25T09:00:00.000Z',
            endsAt: '2026-08-25T10:00:00.000Z',
            startDate: null,
            endDate: null,
            title: '인앱 브라우저 일정',
            location: '우리 집',
            description: 'EventSource가 없어도 일정을 볼 수 있습니다.',
            isPrivate: false,
          },
        ],
      }),
      contentType: 'application/json',
      status: 200,
    })
  })

  await page.goto(`/share/${shareId}`)

  await expect(page.locator('.visitor-list')).toBeVisible()
  await expect(
    page.locator('.visitor-list').getByText('인앱 브라우저 일정'),
  ).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('새로고침으로 업데이트')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})
