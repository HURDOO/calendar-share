import { describe, expect, it } from 'vitest'

import { createSyncWindow } from './sync-window'

describe('createSyncWindow', () => {
  it('creates an inclusive three-month window around the Seoul calendar date', () => {
    const window = createSyncWindow(
      new Date('2026-08-25T16:30:00.000Z'),
      'Asia/Seoul',
    )

    expect(window).toEqual({
      startDate: '2026-05-26',
      endDate: '2026-11-26',
      timeMin: '2026-05-25T15:00:00.000Z',
      timeMax: '2026-11-26T15:00:00.000Z',
    })
  })

  it('clamps month ends without overflowing into the next month', () => {
    const window = createSyncWindow(
      new Date('2026-01-30T15:30:00.000Z'),
      'Asia/Seoul',
    )

    expect(window.startDate).toBe('2025-10-31')
    expect(window.endDate).toBe('2026-04-30')
  })
})
