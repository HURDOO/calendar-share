import { expect, test } from '@playwright/test'

test('shows the public project status without an admin link', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '캘공' })).toBeVisible()
  await expect(page.getByText('관리자 인증')).toBeVisible()
  await expect(page.getByRole('link', { name: /관리자/ })).toHaveCount(0)
})

test('shows the login shell only when the admin route is entered directly', async ({ page }) => {
  await page.route('**/api/v1/admin/session', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ code: 'AUTHENTICATION_REQUIRED' }),
      contentType: 'application/json',
      status: 401,
    })
  })
  await page.goto('/admin')

  await expect(page.getByRole('heading', { name: '관리자 로그인' })).toBeVisible()
  await expect(page.getByLabel('비밀번호')).toHaveAttribute(
    'autocomplete',
    'current-password',
  )
})
