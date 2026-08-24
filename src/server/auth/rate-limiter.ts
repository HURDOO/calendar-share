interface FailureBucket {
  failures: number[]
}

export interface LoginRateLimiterOptions {
  readonly maxFailures: number
  readonly windowMs: number
  readonly now?: () => number
}

export class LoginRateLimiter {
  private readonly buckets = new Map<string, FailureBucket>()
  private readonly maxFailures: number
  private readonly windowMs: number
  private readonly now: () => number

  constructor({ maxFailures, windowMs, now = Date.now }: LoginRateLimiterOptions) {
    this.maxFailures = maxFailures
    this.windowMs = windowMs
    this.now = now
  }

  check(key: string): { readonly blocked: boolean; readonly retryAfterSeconds: number } {
    const currentTime = this.now()
    const bucket = this.buckets.get(key)

    if (!bucket) {
      return { blocked: false, retryAfterSeconds: 0 }
    }

    bucket.failures = bucket.failures.filter(
      (timestamp) => timestamp > currentTime - this.windowMs,
    )

    if (bucket.failures.length === 0) {
      this.buckets.delete(key)
      return { blocked: false, retryAfterSeconds: 0 }
    }

    if (bucket.failures.length < this.maxFailures) {
      return { blocked: false, retryAfterSeconds: 0 }
    }

    const oldestFailure = bucket.failures[0] ?? currentTime
    return {
      blocked: true,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldestFailure + this.windowMs - currentTime) / 1000),
      ),
    }
  }

  recordFailure(key: string): void {
    const bucket = this.buckets.get(key) ?? { failures: [] }
    bucket.failures.push(this.now())
    this.buckets.set(key, bucket)
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }
}
