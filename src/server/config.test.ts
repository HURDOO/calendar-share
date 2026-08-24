import { describe, expect, it } from 'vitest'

import { ConfigurationError, loadRuntimeConfig, REQUIRED_SECRET_NAMES } from './config'

describe('loadRuntimeConfig', () => {
  it('provides safe local defaults', () => {
    const config = loadRuntimeConfig({ NODE_ENV: 'test' })

    expect(config).toMatchObject({
      appBaseUrl: 'http://localhost:8464',
      appTimeZone: 'Asia/Seoul',
      host: '127.0.0.1',
      nodeEnv: 'test',
      port: 8465,
      storageDir: './data',
    })
  })

  it('reports only missing variable names in production', () => {
    expect(() => loadRuntimeConfig({ NODE_ENV: 'production' })).toThrow(
      new ConfigurationError(
        `Missing required environment variables: ${REQUIRED_SECRET_NAMES.join(', ')}`,
      ),
    )
  })

  it('does not include an invalid value in configuration errors', () => {
    const invalidValue = 'not-a-port-secret-value'

    expect(() => loadRuntimeConfig({ NODE_ENV: 'test', PORT: invalidValue })).toThrow(
      'Invalid environment variables: PORT',
    )

    try {
      loadRuntimeConfig({ NODE_ENV: 'test', PORT: invalidValue })
    } catch (error) {
      expect(String(error)).not.toContain(invalidValue)
    }
  })
})
