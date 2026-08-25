import { stderr, stdout } from 'node:process'

import { validateAdminPassword } from '../src/shared/admin-password-policy'
import { hashPassword } from '../src/shared/secrets'
import { readHiddenLine } from './read-hidden-line'

async function main() {
  if (process.argv.length > 2) {
    throw new Error('Usage: pnpm admin:hash-password')
  }

  const password = await readHiddenLine('Admin password: ')
  const confirmation = await readHiddenLine('Confirm password: ')

  const validationError = validateAdminPassword(password, confirmation)
  if (validationError) {
    throw new Error(validationError)
  }

  const verifier = await hashPassword(password)
  stdout.write(`${verifier}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Password hashing failed'
  stderr.write(`${message}\n`)
  process.exitCode = 1
})
