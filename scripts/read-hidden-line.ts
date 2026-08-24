import { stdin, stdout } from 'node:process'

export async function readHiddenLine(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('This command requires an interactive terminal')
  }

  stdout.write(prompt)

  return new Promise((resolve, reject) => {
    let value = ''
    const wasRaw = stdin.isRaw

    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(wasRaw)
      stdin.pause()
    }

    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

      if (text.startsWith('\u001b')) {
        return
      }

      for (const character of text) {
        if (character === '\u0003') {
          cleanup()
          stdout.write('\n')
          reject(new Error('Cancelled'))
          return
        }

        if (character === '\r' || character === '\n') {
          cleanup()
          stdout.write('\n')
          resolve(value)
          return
        }

        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('')
          continue
        }

        if (character >= ' ') {
          value += character
        }
      }
    }

    stdin.setEncoding('utf8')
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}
