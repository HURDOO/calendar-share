import { afterEach, describe, expect, it, vi } from 'vitest'

import { startGoogleScheduler } from './scheduler'

describe('Google scheduler lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops accepting work and waits for the active job', async () => {
    vi.useFakeTimers()
    let finishJob: ((result: boolean) => void) | undefined
    const runOnce = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishJob = resolve
        }),
    )
    const enqueue = vi.fn(() => true)
    const scheduler = startGoogleScheduler(
      {
        enqueue,
        isConnected: () => true,
        needsWindowReplacement: () => false,
        recoverStaleLocks: vi.fn(() => 0),
        runOnce,
      },
      { maintenanceMs: 30, recoveryMs: 20, workerMs: 10 },
    )

    await vi.advanceTimersByTimeAsync(10)
    expect(runOnce).toHaveBeenCalledTimes(1)

    let stopped = false
    const stopping = scheduler.stop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)

    finishJob?.(true)
    await stopping
    await vi.advanceTimersByTimeAsync(100)

    expect(stopped).toBe(true)
    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('contains unexpected worker failures and reports a safe signal', async () => {
    vi.useFakeTimers()
    const onRunError = vi.fn()
    const runOnce = vi.fn(async () => {
      throw new Error('sensitive adapter response')
    })
    const scheduler = startGoogleScheduler(
      {
        enqueue: vi.fn(() => true),
        isConnected: () => false,
        needsWindowReplacement: () => false,
        onRunError,
        recoverStaleLocks: vi.fn(() => 0),
        runOnce,
      },
      { maintenanceMs: 30, recoveryMs: 20, workerMs: 10 },
    )

    await vi.advanceTimersByTimeAsync(10)
    await scheduler.stop()

    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(onRunError).toHaveBeenCalledTimes(1)
  })
})
