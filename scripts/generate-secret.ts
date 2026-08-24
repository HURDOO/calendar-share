import { stderr, stdout } from 'node:process'

import { generateSecret } from '../src/shared/secrets'

function main() {
  if (process.argv.length > 2) {
    throw new Error('Usage: pnpm secret:generate')
  }

  stdout.write(`${generateSecret()}\n`)
}

try {
  main()
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Secret generation failed'
  stderr.write(`${message}\n`)
  process.exitCode = 1
}
