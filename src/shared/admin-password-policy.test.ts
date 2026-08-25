import { describe, expect, it } from 'vitest'

import {
  MIN_ADMIN_PASSWORD_CHARACTERS,
  validateAdminPassword,
} from './admin-password-policy'

describe('administrator password policy', () => {
  it('accepts exactly eight Unicode characters', () => {
    expect(MIN_ADMIN_PASSWORD_CHARACTERS).toBe(8)
    expect(validateAdminPassword('가나다라마바사아', '가나다라마바사아')).toBeNull()
  })

  it('rejects shorter and mismatched passwords', () => {
    expect(validateAdminPassword('1234567', '1234567')).toBe(
      'Admin password must contain at least 8 characters',
    )
    expect(validateAdminPassword('12345678', '87654321')).toBe(
      'Passwords do not match',
    )
  })
})
