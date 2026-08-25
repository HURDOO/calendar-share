import { useEffect, useState } from 'react'

export interface PublicEvent {
  readonly id: string
  readonly calendar: {
    readonly id: string
    readonly name: string
    readonly color: string | null
  }
  readonly isAllDay: boolean
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly startDate: string | null
  readonly endDate: string | null
  readonly title: string
  readonly location: string | null
  readonly description: string | null
  readonly isPrivate: boolean
}

export interface PublicCalendarData {
  readonly availability: 'AVAILABLE'
  readonly share: {
    readonly id: string
    readonly name: string
    readonly eventDateScope: 'ALL' | 'SELECTED'
    readonly eventStartDate: string | null
    readonly eventEndDate: string | null
  }
  readonly events: PublicEvent[]
}

type PageState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly data: PublicCalendarData }

type StreamState = 'connecting' | 'live' | 'retrying' | 'unsupported'
type CalendarViewMode = 'list' | 'week' | 'month'

const viewModeStorageKey = 'calendar-share:view-mode'

export function PublicCalendarApp({ expectedShareId }: { expectedShareId: string }) {
  const [page, setPage] = useState<PageState>({ status: 'loading' })
  const [stream, setStream] = useState<StreamState>('connecting')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    let controller: AbortController | null = null
    let hasLoaded = false

    async function loadEvents() {
      controller?.abort()
      controller = new AbortController()
      try {
        const response = await fetch('/api/v1/public/events', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!active) {
          return
        }
        if (response.status === 401 || response.status === 403) {
          setPage({ status: 'unavailable' })
          return
        }
        if (!response.ok) {
          throw new Error('public-events-failed')
        }
        const result = (await response.json()) as PublicCalendarData
        if (
          result.availability !== 'AVAILABLE' ||
          result.share.id !== expectedShareId
        ) {
          setPage({ status: 'unavailable' })
          return
        }
        hasLoaded = true
        setPage({ status: 'ready', data: result })
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) {
          return
        }
        if (!hasLoaded) {
          setPage({ status: 'error' })
        }
        setStream('retrying')
      }
    }

    void loadEvents()
    if (typeof EventSource === 'undefined') {
      setStream('unsupported')
      return () => {
        active = false
        controller?.abort()
      }
    }

    const source = new EventSource('/api/v1/public/stream')
    source.onopen = () => setStream('live')
    source.onerror = () => setStream('retrying')
    source.addEventListener('changed', () => void loadEvents())
    source.addEventListener('unavailable', () => {
      setPage({ status: 'unavailable' })
      source.close()
    })

    return () => {
      active = false
      controller?.abort()
      source.close()
    }
  }, [expectedShareId, retry])

  if (page.status === 'loading') {
    return <PublicStatus title="일정을 불러오고 있어요" detail="잠시만 기다려 주세요." />
  }

  if (page.status === 'unavailable') {
    return (
      <PublicStatus
        title="이 공유는 열 수 없어요"
        detail="링크가 만료되었거나 공유가 종료되었습니다. 링크를 보낸 사람에게 확인해 주세요."
      />
    )
  }

  if (page.status === 'error') {
    return (
      <PublicStatus
        title="일정을 불러오지 못했어요"
        detail="네트워크 연결을 확인하고 다시 시도해 주세요."
        action={
          <button className="primary-button" onClick={() => setRetry((value) => value + 1)}>
            다시 시도
          </button>
        }
      />
    )
  }

  return (
    <main className="visitor-shell">
      <PublicCalendarView data={page.data} stream={stream} />
    </main>
  )
}

export function PublicCalendarView({
  data,
  stream = 'unsupported',
  showStreamStatus = true,
}: {
  readonly data: PublicCalendarData
  readonly stream?: StreamState
  readonly showStreamStatus?: boolean
}) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>(initialViewMode)

  function selectViewMode(mode: CalendarViewMode) {
    setViewMode(mode)
    storeViewMode(mode)
  }

  return (
    <>
      <header className="visitor-header">
        <div>
          <span className="eyebrow">Shared calendar</span>
          <h1>{data.share.name}</h1>
          <p>
            {data.share.eventDateScope === 'ALL'
              ? '전체 데이터'
              : formatDateRange(
                  data.share.eventStartDate ?? '',
                  data.share.eventEndDate ?? '',
                )}
          </p>
        </div>
        {showStreamStatus ? (
          <span className={`live-status live-status--${stream}`} role="status">
            {streamLabel(stream)}
          </span>
        ) : null}
      </header>

      <nav className="calendar-view-switcher" aria-label="캘린더 보기 모드">
        {(
          [
            ['list', '목록'],
            ['week', '주간'],
            ['month', '월간'],
          ] as const
        ).map(([mode, label]) => (
          <button
            aria-pressed={viewMode === mode}
            className={viewMode === mode ? 'is-active' : ''}
            key={mode}
            onClick={() => selectViewMode(mode)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {data.events.length === 0 ? (
        <section className="empty-calendar" aria-labelledby="empty-title">
          <div className="empty-calendar__icon" aria-hidden="true">
            0
          </div>
          <h2 id="empty-title">공유된 일정이 없어요</h2>
          <p>이 기간에 공개된 일정이 생기면 이곳에 표시됩니다.</p>
        </section>
      ) : viewMode === 'list' ? (
          <section className="visitor-list" aria-label="날짜별 일정 목록">
            <EventList data={data} />
          </section>
      ) : viewMode === 'week' ? (
        <section className="visitor-week" aria-label="주간 일정 달력">
          <WeekCalendar data={data} />
        </section>
      ) : (
        <section className="visitor-month" aria-label="월간 일정 달력">
          <MonthCalendar data={data} />
        </section>
      )}
    </>
  )
}

export function PublicUnavailablePage() {
  return (
    <PublicStatus
      title="이 공유는 열 수 없어요"
      detail="링크가 정확한지 확인하거나 링크를 보낸 사람에게 다시 요청해 주세요."
    />
  )
}

function PublicStatus({
  title,
  detail,
  action,
}: {
  readonly title: string
  readonly detail: string
  readonly action?: React.ReactNode
}) {
  return (
    <main className="app-shell">
      <section className="public-status-card" aria-labelledby="public-status-title">
        <span className="eyebrow">캘공</span>
        <h1 id="public-status-title">{title}</h1>
        <p>{detail}</p>
        {action}
      </section>
    </main>
  )
}

function EventList({ data }: { readonly data: PublicCalendarData }) {
  const grouped = groupEvents(data)
  return (
    <div className="event-groups">
      {grouped.map(([date, events]) => (
        <section className="event-group" key={date} aria-labelledby={`date-${date}`}>
          <h2 id={`date-${date}`}>{formatDateHeading(date)}</h2>
          <div className="event-stack">
            {events.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function EventCard({ event }: { readonly event: PublicEvent }) {
  const color = safeCalendarColor(event.calendar.color)
  return (
    <article className="event-card">
      <span className="event-card__bar" style={{ backgroundColor: color }} />
      <div className="event-card__body">
        <div className="event-card__meta">
          <span>{formatEventTime(event)}</span>
          <span>{event.calendar.name}</span>
        </div>
        <h3>{event.title}</h3>
        {event.location ? <p className="event-location">{event.location}</p> : null}
        {event.description ? (
          <p className="event-description">{event.description}</p>
        ) : null}
      </div>
    </article>
  )
}

function MonthCalendar({ data }: { readonly data: PublicCalendarData }) {
  const [startDate, endDate] = calendarBounds(data)
  const startMonth = startDate.slice(0, 7)
  const endMonth = endDate.slice(0, 7)
  const todayMonth = formatLocalDate(new Date().toISOString()).slice(0, 7)
  const initialMonth = clamp(todayMonth, startMonth, endMonth)
  const [month, setMonth] = useState(initialMonth)
  const days = calendarDays(month)

  useEffect(() => {
    setMonth((current) => clamp(current, startMonth, endMonth))
  }, [endMonth, startMonth])

  return (
    <div className="month-calendar">
      <div className="calendar-period-toolbar">
        <button
          aria-label="이전 달"
          className="calendar-nav"
          disabled={month <= startMonth}
          onClick={() => setMonth(addMonth(month, -1))}
          type="button"
        >
          ‹
        </button>
        <h2>{formatMonthHeading(month)}</h2>
        <button
          className="calendar-today"
          onClick={() => setMonth(clamp(todayMonth, startMonth, endMonth))}
          type="button"
        >
          오늘
        </button>
        <button
          aria-label="다음 달"
          className="calendar-nav"
          disabled={month >= endMonth}
          onClick={() => setMonth(addMonth(month, 1))}
          type="button"
        >
          ›
        </button>
      </div>
      <div className="weekday-row" aria-hidden="true">
        {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="month-grid">
        {days.map((date, index) => {
          if (!date) {
            return <div className="calendar-day calendar-day--blank" key={`blank-${index}`} />
          }
          const events = eventsForDate(data.events, date)
          const inRange = date >= startDate && date <= endDate
          return (
            <section
              aria-label={formatDateHeading(date)}
              className={`calendar-day${inRange ? '' : ' calendar-day--outside'}`}
              key={date}
            >
              <span className="calendar-day__number">{Number(date.slice(8, 10))}</span>
              <div className="calendar-day__events">
                {events.slice(0, 3).map((event) => (
                  <div className="calendar-event" key={event.id} title={event.title}>
                    <span
                      className="calendar-event__dot"
                      style={{ backgroundColor: safeCalendarColor(event.calendar.color) }}
                    />
                    <span>{event.title}</span>
                  </div>
                ))}
                {events.length > 3 ? (
                  <span className="calendar-event-more">+{events.length - 3}개</span>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function WeekCalendar({ data }: { readonly data: PublicCalendarData }) {
  const [startDate, endDate] = calendarBounds(data)
  const today = formatLocalDate(new Date().toISOString())
  const initialDate = clamp(today, startDate, endDate)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(initialDate))
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const dates = weekDates(weekStart)
  const weekEnd = dates[6] ?? weekStart

  useEffect(() => {
    const bounded = clamp(selectedDate, startDate, endDate)
    setSelectedDate(bounded)
    setWeekStart((current) => {
      const minimumWeek = startOfWeek(startDate)
      const maximumWeek = startOfWeek(endDate)
      return clamp(current, minimumWeek, maximumWeek)
    })
  }, [endDate, selectedDate, startDate])

  function moveWeek(amount: number) {
    const nextStart = addDays(weekStart, amount * 7)
    const boundedStart = clamp(
      nextStart,
      startOfWeek(startDate),
      startOfWeek(endDate),
    )
    setWeekStart(boundedStart)
    setSelectedDate(firstDateInRange(weekDates(boundedStart), startDate, endDate))
  }

  function moveToToday() {
    const bounded = clamp(today, startDate, endDate)
    setSelectedDate(bounded)
    setWeekStart(startOfWeek(bounded))
  }

  const selectedEvents = eventsForDate(data.events, selectedDate)

  return (
    <div className="week-calendar">
      <div className="calendar-period-toolbar">
        <button
          aria-label="이전 주"
          className="calendar-nav"
          disabled={weekStart <= startOfWeek(startDate)}
          onClick={() => moveWeek(-1)}
          type="button"
        >
          ‹
        </button>
        <h2>{formatWeekHeading(weekStart, weekEnd)}</h2>
        <button className="calendar-today" onClick={moveToToday} type="button">
          오늘
        </button>
        <button
          aria-label="다음 주"
          className="calendar-nav"
          disabled={weekStart >= startOfWeek(endDate)}
          onClick={() => moveWeek(1)}
          type="button"
        >
          ›
        </button>
      </div>

      <div className="week-date-picker" aria-label="주간 날짜 선택">
        {dates.map((date) => {
          const inRange = date >= startDate && date <= endDate
          return (
            <button
              aria-pressed={selectedDate === date}
              disabled={!inRange}
              key={date}
              onClick={() => setSelectedDate(date)}
              type="button"
            >
              <span>{formatWeekday(date)}</span>
              <strong>{Number(date.slice(8, 10))}</strong>
            </button>
          )
        })}
      </div>

      <section className="week-mobile-agenda" aria-labelledby="selected-day-title">
        <h3 id="selected-day-title">{formatDateHeading(selectedDate)}</h3>
        {selectedEvents.length > 0 ? (
          <div className="event-stack">
            {selectedEvents.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </div>
        ) : (
          <p className="week-empty">이 날짜에 공유된 일정이 없어요.</p>
        )}
      </section>

      <div className="week-grid">
        {dates.map((date) => {
          const inRange = date >= startDate && date <= endDate
          const events = inRange ? eventsForDate(data.events, date) : []
          return (
            <section
              aria-label={formatDateHeading(date)}
              className={`week-day${inRange ? '' : ' week-day--outside'}`}
              key={date}
            >
              <header>
                <span>{formatWeekday(date)}</span>
                <strong>{Number(date.slice(8, 10))}</strong>
              </header>
              {events.length > 0 ? (
                <div className="week-day__events">
                  {events.map((event) => (
                    <WeekEvent event={event} key={event.id} />
                  ))}
                </div>
              ) : (
                <p>{inRange ? '일정 없음' : '범위 밖'}</p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function WeekEvent({ event }: { readonly event: PublicEvent }) {
  return (
    <article
      className="week-event"
      style={{ borderLeftColor: safeCalendarColor(event.calendar.color) }}
    >
      <span>{formatEventTime(event)}</span>
      <h3>{event.title}</h3>
      <small>{event.calendar.name}</small>
    </article>
  )
}

function groupEvents(data: PublicCalendarData): Array<[string, PublicEvent[]]> {
  const grouped = new Map<string, PublicEvent[]>()
  const [policyStart, policyEnd] = calendarBounds(data)
  for (const event of data.events) {
    const range = eventDateRange(event)
    const start = range
      ? range[0] < policyStart
        ? policyStart
        : range[0]
      : eventDisplayDate(event)
    const end = range ? (range[1] > policyEnd ? policyEnd : range[1]) : start
    for (const date of datesInRange(start, end)) {
      const existing = grouped.get(date) ?? []
      existing.push(event)
      grouped.set(date, existing)
    }
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function calendarBounds(data: PublicCalendarData): [string, string] {
  if (
    data.share.eventDateScope === 'SELECTED' &&
    data.share.eventStartDate &&
    data.share.eventEndDate
  ) {
    return [data.share.eventStartDate, data.share.eventEndDate]
  }

  const ranges = data.events
    .map(eventDateRange)
    .filter((range): range is [string, string] => range !== null)
  const today = formatLocalDate(new Date().toISOString())
  const starts = ranges.map(([start]) => start).sort()
  const ends = ranges.map(([, end]) => end).sort()
  return [starts[0] ?? today, ends.at(-1) ?? today]
}

function eventsForDate(events: PublicEvent[], date: string): PublicEvent[] {
  return events.filter((event) => {
    const range = eventDateRange(event)
    return range ? date >= range[0] && date <= range[1] : false
  })
}

function eventDisplayDate(event: PublicEvent): string {
  if (event.startDate) {
    return event.startDate
  }
  return event.startsAt ? formatLocalDate(event.startsAt) : '9999-12-31'
}

function eventDateRange(event: PublicEvent): [string, string] | null {
  if (event.startDate) {
    const end = event.endDate ? addDays(event.endDate, -1) : event.startDate
    return [event.startDate, end < event.startDate ? event.startDate : end]
  }
  if (!event.startsAt) {
    return null
  }
  const start = formatLocalDate(event.startsAt)
  const endTimestamp = event.endsAt
    ? Math.max(Date.parse(event.startsAt), Date.parse(event.endsAt) - 1)
    : Date.parse(event.startsAt)
  return [start, formatLocalDate(new Date(endTimestamp).toISOString())]
}

function formatLocalDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Seoul',
    year: 'numeric',
  }).formatToParts(new Date(value))
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}`
}

function formatEventTime(event: PublicEvent): string {
  if (event.isAllDay) {
    return '종일'
  }
  if (!event.startsAt || !event.endsAt) {
    return '시간 미정'
  }
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
  return `${formatter.format(new Date(event.startsAt))}–${formatter.format(
    new Date(event.endsAt),
  )}`
}

function formatDateHeading(date: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'short',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

function formatDateRange(start: string, end: string): string {
  return `${start.replaceAll('-', '.')} – ${end.replaceAll('-', '.')}`
}

function formatMonthHeading(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${year}년 ${monthNumber}월`
}

function formatWeekHeading(start: string, end: string): string {
  const [startYear, startMonth, startDay] = start.split('-').map(Number)
  const [endYear, endMonth, endDay] = end.split('-').map(Number)
  return startYear === endYear
    ? `${startYear}년 ${startMonth}월 ${startDay}일 – ${endMonth}월 ${endDay}일`
    : `${startYear}년 ${startMonth}월 ${startDay}일 – ${endYear}년 ${endMonth}월 ${endDay}일`
}

function formatWeekday(date: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'UTC',
    weekday: 'short',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

function calendarDays(month: string): Array<string | null> {
  const [year = 0, monthNumber = 0] = month.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: lastDay }, (_, index) =>
      [year, String(monthNumber).padStart(2, '0'), String(index + 1).padStart(2, '0')].join(
        '-',
      ),
    ),
  ]
}

function addMonth(month: string, amount: number): string {
  const [year = 0, monthNumber = 0] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

function startOfWeek(date: string): string {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return addDays(date, -weekday)
}

function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

function datesInRange(start: string, end: string): string[] {
  const dates: string[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(date)
  }
  return dates
}

function firstDateInRange(
  dates: string[],
  minimum: string,
  maximum: string,
): string {
  return dates.find((date) => date >= minimum && date <= maximum) ?? minimum
}

function clamp(value: string, minimum: string, maximum: string): string {
  return value < minimum ? minimum : value > maximum ? maximum : value
}

function safeCalendarColor(color: string | null): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#4b9ad1'
}

function initialViewMode(): CalendarViewMode {
  try {
    const stored = window.localStorage.getItem(viewModeStorageKey)
    if (stored === 'list' || stored === 'week' || stored === 'month') {
      return stored
    }
  } catch {
    // Storage can be unavailable in restrictive in-app browser modes.
  }
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 820px)').matches
    ? 'month'
    : 'list'
}

function storeViewMode(mode: CalendarViewMode): void {
  try {
    window.localStorage.setItem(viewModeStorageKey, mode)
  } catch {
    // The selected mode still works for the current page without storage.
  }
}

function streamLabel(stream: StreamState): string {
  switch (stream) {
    case 'live':
      return '자동 업데이트 중'
    case 'connecting':
      return '업데이트 연결 중'
    case 'retrying':
      return '연결을 다시 시도하는 중'
    case 'unsupported':
      return '새로고침으로 업데이트'
  }
}
