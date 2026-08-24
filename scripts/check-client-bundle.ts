import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const clientDir = 'dist/client'
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt'])
const forbiddenPatterns = [
  { name: 'Google API key', value: /AIza[0-9A-Za-z_-]{20,}/ },
  {
    name: 'Google OAuth client identifier',
    value: /[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com/i,
  },
  { name: 'private key', value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'local environment filename', value: /\.env\.local/ },
  { name: 'administrator password secret name', value: /ADMIN_PASSWORD_HASH/ },
  { name: 'Google OAuth secret name', value: /GOOGLE_CLIENT_SECRET/ },
  { name: 'Google token key secret name', value: /GOOGLE_TOKEN_ENCRYPTION_KEY/ },
  { name: 'session secret name', value: /SESSION_SECRET/ },
] as const

const files = await listFiles(clientDir)
let checkedFiles = 0
const violations: string[] = []

for (const file of files) {
  if (!textExtensions.has(extname(file))) {
    continue
  }
  checkedFiles += 1
  const contents = await readFile(file, 'utf8')
  for (const pattern of forbiddenPatterns) {
    if (pattern.value.test(contents)) {
      violations.push(`${relative(clientDir, file)}: ${pattern.name}`)
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Client bundle secret scan failed:\n${violations.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Client bundle secret scan passed (${checkedFiles} files).\n`)
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : Promise.resolve([path])
    }),
  )
  return nested.flat()
}
