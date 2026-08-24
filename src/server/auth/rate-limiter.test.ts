import { describe, expect, it } from 'vitest'

import { LoginRateLimiter } from './rate-limiter'

describe('LoginRateLimiter', () => {
  it('blocks repeated failures and resets after the window', () => {
    let now = 1_000
    const limiter = new LoginRateLimiter({
      maxFailures: 2,
      windowMs: 10_000,
      now: () => now,
    })

    limiter.recordFailure('client')
    expect(limiter.check('client').blocked).toBe(false)

    limiter.recordFailure('client')
    expect(limiter.check('client')).toEqual({
      blocked: true,
      retryAfterSeconds: 10,
    })

    now += 10_001
    expect(limiter.check('client').blocked).toBe(false)
  })

  it('clears a client bucket after successful authentication', () => {
    const limiter = new LoginRateLimiter({ maxFailures: 1, windowMs: 10_000 })

    limiter.recordFailure('client')
    limiter.reset('client')

    expect(limiter.check('client').blocked).toBe(false)
  })
})
