import { expect, test, type Route } from '@playwright/test'

const shareId = '60000000-0000-4000-8000-000000000001'
const calendarOne = '60000000-0000-4000-8000-000000000011'
const calendarTwo = '60000000-0000-4000-8000-000000000012'

test('creates, previews, edits, copies, and revokes a share', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4177',
  })
  page.on('dialog', (dialog) => void dialog.accept())
  let storedShare: ReturnType<typeof shareFixture> | null = null
  const mutationCsrfHeaders: string[] = []

  await page.route('**/api/v1/admin/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const csrf = request.headers()['x-csrf-token']
    if (method !== 'GET' && url.pathname !== '/api/v1/admin/session' && csrf) {
      mutationCsrfHeaders.push(csrf)
    }

    if (url.pathname === '/api/v1/admin/session' && method === 'GET') {
      return fulfillJson(route, {
        authenticated: true,
        csrfToken: 'e2e-csrf-token',
        expiresAt: '2026-08-25T08:00:00.000Z',
      })
    }
    if (url.pathname === '/api/v1/admin/google/status') {
      return fulfillJson(route, {
        connected: true,
        lastErrorCode: null,
        lastSyncedAt: '2026-08-25T00:00:00.000Z',
        calendars: { active: 2, ready: 2 },
        queue: {},
      })
    }
    if (url.pathname === '/api/v1/admin/calendars') {
      return fulfillJson(route, {
        calendars: [
          calendarFixture(calendarOne, '가족', true),
          calendarFixture(calendarTwo, '업무', false),
        ],
      })
    }
    if (url.pathname === '/api/v1/admin/shares' && method === 'GET') {
      return fulfillJson(route, { shares: storedShare ? [storedShare] : [] })
    }
    if (url.pathname === '/api/v1/admin/shares' && method === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>
      storedShare = shareFixture({
        name: String(payload.name),
        calendarScope: payload.calendarScope as 'ALL' | 'SELECTED',
        calendarIds: payload.calendarIds as string[],
        eventStartDate: String(payload.eventStartDate),
        eventEndDate: String(payload.eventEndDate),
      })
      return fulfillJson(
        route,
        {
          share: storedShare,
          shareUrl: 'https://calendar.app.hurdoo.kr/s/e2e-one-time-link',
          token: 'not-rendered-separately',
        },
        201,
      )
    }
    if (url.pathname === `/api/v1/admin/shares/${shareId}/preview`) {
      return fulfillJson(route, {
        availability: 'AVAILABLE',
        share: {
          id: shareId,
          name: storedShare?.name ?? '가족 공유',
          eventStartDate: storedShare?.eventStartDate ?? '2026-08-25',
          eventEndDate: storedShare?.eventEndDate ?? '2026-09-25',
        },
        events: [previewEvent()],
      })
    }
    if (url.pathname === `/api/v1/admin/shares/${shareId}` && method === 'PUT') {
      const payload = request.postDataJSON() as Record<string, unknown>
      storedShare = shareFixture({
        ...(storedShare ?? {}),
        name: String(payload.name),
        calendarScope: payload.calendarScope as 'ALL' | 'SELECTED',
        calendarIds: payload.calendarIds as string[],
      })
      return fulfillJson(route, { share: storedShare })
    }
    if (url.pathname === `/api/v1/admin/shares/${shareId}` && method === 'DELETE') {
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({ status: 404 })
  })

  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: '관리자 대시보드' })).toBeVisible()
  await page.getByRole('button', { name: '새 공유 만들기' }).click()
  await page.getByLabel('공유 이름').fill('가족 공유')
  await page.getByLabel(/선택한 캘린더만/).click()
  await page.getByLabel('업무').uncheck()
  await page.getByRole('button', { name: '공유 만들기', exact: true }).click()

  const linkNotice = page.locator('.link-notice')
  await expect(linkNotice.getByLabel('공유 주소')).toHaveValue(
    'https://calendar.app.hurdoo.kr/s/e2e-one-time-link',
  )
  await linkNotice.getByRole('button', { name: '링크 복사' }).click()
  await expect(page.getByText('공유 링크를 복사했습니다.')).toBeVisible()

  await page.getByRole('button', { name: '미리보기' }).click()
  const preview = page.getByRole('region', { name: '공유 미리보기' })
  await expect(preview.getByText('방문자와 같은 일정').last()).toBeVisible()
  await expect(preview.getByText('같은 정책 응답')).toHaveCount(1)

  await page.getByRole('button', { name: '수정' }).click()
  await page.getByLabel('공유 이름').fill('수정된 가족 공유')
  await page.getByRole('button', { name: '변경 저장' }).click()
  await expect(page.locator('.share-card').getByText('수정된 가족 공유')).toBeVisible()

  await page.getByRole('button', { name: '공유 종료' }).click()
  await expect(page.getByText('종료됨')).toBeVisible()
  await expect(page.getByRole('button', { name: '수정' })).toHaveCount(0)
  expect(mutationCsrfHeaders).toEqual([
    'e2e-csrf-token',
    'e2e-csrf-token',
    'e2e-csrf-token',
  ])
})

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
) {
  return route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
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
    eventStartDate: string
    eventEndDate: string
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
    eventStartDate: '2026-08-25',
    eventEndDate: '2026-09-25',
    accessStartsAt: null,
    accessEndsAt: null,
    revokedAt: null,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  }
}

function previewEvent() {
  return {
    id: 'preview-event',
    calendar: { id: calendarOne, name: '가족', color: '#4b9ad1' },
    isAllDay: false,
    startsAt: '2026-08-25T09:00:00.000Z',
    endsAt: '2026-08-25T10:00:00.000Z',
    startDate: null,
    endDate: null,
    title: '방문자와 같은 일정',
    location: '우리 집',
    description: '같은 정책 응답',
    isPrivate: false,
  }
}
