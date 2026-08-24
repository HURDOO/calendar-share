import { openDatabase } from './database'

export function createTestDatabase() {
  return openDatabase({ filePath: ':memory:' })
}
