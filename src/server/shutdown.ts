export type ShutdownSignal = 'SIGINT' | 'SIGTERM'

interface ClosableApp {
  readonly log: {
    error(fields: Record<string, unknown>, message: string): void
    info(fields: Record<string, unknown>, message: string): void
  }
  close(): Promise<void>
}

interface SignalSource {
  exitCode: number | string | null | undefined
  off(signal: ShutdownSignal, listener: () => void): unknown
  once(signal: ShutdownSignal, listener: () => void): unknown
}

export interface GracefulShutdown {
  dispose(): void
  shutdown(signal: ShutdownSignal): Promise<void>
}

export function installGracefulShutdown(
  app: ClosableApp,
  signalSource: SignalSource = process,
): GracefulShutdown {
  let activeShutdown: Promise<void> | null = null
  let installed = true

  const onSigint = () => void shutdown('SIGINT')
  const onSigterm = () => void shutdown('SIGTERM')

  function dispose() {
    if (!installed) return
    installed = false
    signalSource.off('SIGINT', onSigint)
    signalSource.off('SIGTERM', onSigterm)
  }

  function shutdown(signal: ShutdownSignal): Promise<void> {
    if (activeShutdown) return activeShutdown

    app.log.info({ result: 'started', signal }, 'Graceful shutdown started')
    activeShutdown = app
      .close()
      .then(() => {
        app.log.info({ result: 'completed', signal }, 'Graceful shutdown completed')
      })
      .catch(() => {
        signalSource.exitCode = 1
        app.log.error(
          { result: 'failed', safe_error_code: 'SHUTDOWN_FAILED', signal },
          'Graceful shutdown failed',
        )
      })
      .finally(dispose)
    return activeShutdown
  }

  signalSource.once('SIGINT', onSigint)
  signalSource.once('SIGTERM', onSigterm)

  return { dispose, shutdown }
}
