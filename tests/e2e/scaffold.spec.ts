import { expect, test } from '@playwright/test'

test('shows the project scaffold', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '캘공' })).toBeVisible()
  await expect(page.getByText('프로젝트 골격')).toBeVisible()
})
