// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { consumeShareToken } from './share-token'

describe('consumeShareToken', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('removes the token fragment before returning it to the application', () => {
    const token = 'A'.repeat(43)
    window.history.replaceState(null, '', `/calendar?view=month#share=${token}`)

    expect(consumeShareToken()).toBe(token)
    expect(window.location.pathname).toBe('/calendar')
    expect(window.location.search).toBe('?view=month')
    expect(window.location.hash).toBe('')
  })

  it('leaves unrelated fragments untouched', () => {
    window.history.replaceState(null, '', '/#section=help')

    expect(consumeShareToken()).toBeNull()
    expect(window.location.hash).toBe('#section=help')
  })
})
