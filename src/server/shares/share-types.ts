import { z } from 'zod'

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
    'Invalid calendar date',
  )

const optionalInstantSchema = z.iso.datetime({ offset: true }).nullable()

export const shareWriteSchema = z
  .object({
    accessEndsAt: optionalInstantSchema,
    accessStartsAt: optionalInstantSchema,
    calendarIds: z.array(z.string().uuid()).max(1000),
    calendarScope: z.enum(['ALL', 'SELECTED']),
    eventEndDate: calendarDateSchema,
    eventStartDate: calendarDateSchema,
    name: z.string().trim().min(1).max(120),
  })
  .superRefine((value, context) => {
    if (value.eventEndDate < value.eventStartDate) {
      context.addIssue({
        code: 'custom',
        message: 'Event date range is invalid',
        path: ['eventEndDate'],
      })
    }

    const hasStart = value.accessStartsAt !== null
    const hasEnd = value.accessEndsAt !== null
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: 'custom',
        message: 'Both access boundaries are required',
        path: ['accessEndsAt'],
      })
    } else if (
      value.accessStartsAt &&
      value.accessEndsAt &&
      Date.parse(value.accessEndsAt) <= Date.parse(value.accessStartsAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Access range is invalid',
        path: ['accessEndsAt'],
      })
    }

    if (value.calendarScope === 'ALL' && value.calendarIds.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'ALL scope cannot have an allowlist',
        path: ['calendarIds'],
      })
    }

    if (new Set(value.calendarIds).size !== value.calendarIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Calendar identifiers must be unique',
        path: ['calendarIds'],
      })
    }
  })

export const shareIdParamsSchema = z.object({ id: z.string().uuid() })

export type ShareWriteInput = z.infer<typeof shareWriteSchema>

export interface ShareView {
  readonly id: string
  readonly name: string
  readonly calendarScope: 'ALL' | 'SELECTED'
  readonly calendarIds: string[]
  readonly eventStartDate: string
  readonly eventEndDate: string
  readonly accessStartsAt: string | null
  readonly accessEndsAt: string | null
  readonly revokedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}
