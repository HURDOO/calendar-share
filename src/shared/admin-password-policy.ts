export const MIN_ADMIN_PASSWORD_CHARACTERS = 8

export function validateAdminPassword(
  password: string,
  confirmation: string,
): string | null {
  if (Array.from(password).length < MIN_ADMIN_PASSWORD_CHARACTERS) {
    return `Admin password must contain at least ${MIN_ADMIN_PASSWORD_CHARACTERS} characters`
  }

  if (password !== confirmation) {
    return 'Passwords do not match'
  }

  return null
}
