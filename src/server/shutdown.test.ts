import { describe, expect, it, vi } from 'vitest'

import { installGracefulShutdown, type ShutdownSignal } from './shutdown'

describe('graceful shutdown', () => {
  it('closes exactly once when multiple termination signals arrive', async () => {
    const listeners = new Map<ShutdownSignal, () => void>()
    const signalSource = {
      exitCode: undefined as number | undefined,
      off: vi.fn((signal: ShutdownSignal) => listeners.delete(signal)),
      once: vi.fn((signal: ShutdownSignal, listener: () => void) => {
        listeners.set(signal, listener)
      }),
    }
    let finishClose: (() => void) | undefined
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve
        }),
    )
    const logger = { error: vi.fn(), info: vi.fn() }
    const shutdown = installGracefulShutdown(
      { close, log: logger },
      signalSource,
    )

    const first = shutdown.shutdown('SIGTERM')
    const second = shutdown.shutdown('SIGINT')
    expect(close).toHaveBeenCalledTimes(1)

    finishClose?.()
    await Promise.all([first, second])

    expect(signalSource.exitCode).toBeUndefined()
    expect(signalSource.off).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenLastCalledWith(
      { result: 'completed', signal: 'SIGTERM' },
      'Graceful shutdown completed',
    )
  })

  it('sets a failing exit code without logging the raw close error', async () => {
    const signalSource = {
      exitCode: undefined as number | undefined,
      off: vi.fn(),
      once: vi.fn(),
    }
    const logger = { error: vi.fn(), info: vi.fn() }
    const shutdown = installGracefulShutdown(
      {
        close: async () => {
          throw new Error('database path must stay private')
        },
        log: logger,
      },
      signalSource,
    )

    await shutdown.shutdown('SIGTERM')

    expect(signalSource.exitCode).toBe(1)
    expect(logger.error).toHaveBeenCalledWith(
      {
        result: 'failed',
        safe_error_code: 'SHUTDOWN_FAILED',
        signal: 'SIGTERM',
      },
      'Graceful shutdown failed',
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('database path')
  })
})
