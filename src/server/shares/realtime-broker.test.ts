import { describe, expect, it, vi } from 'vitest'

import { ShareRealtimeBroker } from './realtime-broker'

describe('ShareRealtimeBroker', () => {
  it('publishes data-free signals only to current subscribers', () => {
    const broker = new ShareRealtimeBroker()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribe = broker.subscribe('share-1', first)
    broker.subscribe('share-2', second)

    expect(broker.publish('share-1')).toBe(1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(broker.publishAll()).toBe(2)

    unsubscribe()
    expect(broker.publish('share-1')).toBe(0)
  })
})
