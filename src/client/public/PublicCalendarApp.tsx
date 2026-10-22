import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
const listPageSize = 80

interface EventOccurrence {
  readonly date: string
  readonly event: PublicEvent
}

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
  const [selectedEvent, setSelectedEvent] = useState<PublicEvent | null>(null)
  const [viewResetKey, setViewResetKey] = useState(0)
  const [startDate, endDate] = useMemo(() => calendarBounds(data), [data])
  const today = clamp(
    formatLocalDate(new Date().toISOString()),
    startDate,
    endDate,
  )
  const [weekAnchorDate, setWeekAnchorDate] = useState(today)
  const groupedEvents = useMemo(
    () => groupEvents(data, startDate, endDate),
    [data, endDate, startDate],
  )
  const eventsByDate = useMemo(
    () => new Map<string, PublicEvent[]>(groupedEvents),
    [groupedEvents],
  )
  const occurrences = useMemo(
    () =>
      groupedEvents.flatMap(([date, events]) =>
        events.map((event) => ({ date, event })),
      ),
    [groupedEvents],
  )

  useEffect(() => {
    setWeekAnchorDate((current) => clamp(current, startDate, endDate))
  }, [endDate, startDate])

  useEffect(() => {
    setSelectedEvent((current) =>
      current
        ? (data.events.find((event) => event.id === current.id) ?? null)
        : null,
    )
  }, [data.events])

  const closeEventDetails = useCallback(() => setSelectedEvent(null), [])

  const selectViewMode = useCallback((mode: CalendarViewMode) => {
    setWeekAnchorDate(today)
    setViewResetKey((current) => current + 1)
    setViewMode(mode)
    storeViewMode(mode)
  }, [today])

  const openWeekForDate = useCallback((date: string) => {
    setWeekAnchorDate(clamp(date, startDate, endDate))
    setViewResetKey((current) => current + 1)
    setViewMode('week')
    storeViewMode('week')
  }, [endDate, startDate])

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
        <section
          className="visitor-list"
          aria-label="날짜별 일정 목록"
          key={`list-${viewResetKey}`}
        >
          <EventList occurrences={occurrences} today={today} />
        </section>
      ) : viewMode === 'week' ? (
        <section
          className="visitor-week"
          aria-label="주간 일정 달력"
          key={`week-${viewResetKey}`}
        >
          <WeekCalendar
            anchorDate={weekAnchorDate}
            endDate={endDate}
            eventsByDate={eventsByDate}
            onAnchorDateChange={setWeekAnchorDate}
            onSelectEvent={setSelectedEvent}
            startDate={startDate}
          />
        </section>
      ) : (
        <section
          className="visitor-month"
          aria-label="월간 일정 달력"
          key={`month-${viewResetKey}`}
        >
          <MonthCalendar
            endDate={endDate}
            eventsByDate={eventsByDate}
            onSelectDate={openWeekForDate}
            onSelectEvent={setSelectedEvent}
            startDate={startDate}
          />
        </section>
      )}
      {selectedEvent ? (
        <EventDetailDialog event={selectedEvent} onClose={closeEventDetails} />
      ) : null}
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

const EventList = memo(function EventList({
  occurrences,
  today,
}: {
  readonly occurrences: EventOccurrence[]
  readonly today: string
}) {
  const initialPageStart = useMemo(
    () => initialListPageStart(occurrences, today),
    [occurrences, today],
  )
  const [pageStart, setPageStart] = useState(initialPageStart)
  const listTopRef = useRef<HTMLDivElement>(null)
  const pageEnd = Math.min(pageStart + listPageSize, occurrences.length)
  const visibleOccurrences = occurrences.slice(pageStart, pageEnd)
  const grouped = groupOccurrences(visibleOccurrences)

  useEffect(() => {
    setPageStart((current) =>
      Math.min(current, Math.max(0, occurrences.length - 1)),
    )
  }, [occurrences.length])

  function showPage(nextStart: number) {
    setPageStart(nextStart)
    const scrollToList = () => {
      listTopRef.current?.scrollIntoView?.({ block: 'start' })
    }
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(scrollToList)
    } else {
      scrollToList()
    }
  }

  return (
    <div className="event-list-page" ref={listTopRef}>
      <EventListPagination
        initialPageStart={initialPageStart}
        onShowPage={showPage}
        pageEnd={pageEnd}
        pageStart={pageStart}
        total={occurrences.length}
      />
      <div className="event-groups">
        {grouped.map(([date, events]) => (
          <section className="event-group" key={date} aria-labelledby={`date-${date}`}>
            <h2 id={`date-${date}`}>{formatDateHeading(date)}</h2>
            <div className="event-stack">
              {events.map((event) => (
                <EventCard event={event} key={`${date}-${event.id}`} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <EventListPagination
        initialPageStart={initialPageStart}
        onShowPage={showPage}
        pageEnd={pageEnd}
        pageStart={pageStart}
        total={occurrences.length}
      />
    </div>
  )
})

function EventListPagination({
  initialPageStart,
  onShowPage,
  pageEnd,
  pageStart,
  total,
}: {
  readonly initialPageStart: number
  readonly onShowPage: (start: number) => void
  readonly pageEnd: number
  readonly pageStart: number
  readonly total: number
}) {
  const previousStart = Math.max(0, pageStart - listPageSize)
  const nextStart = pageEnd
  return (
    <nav className="event-list-pagination" aria-label="목록 일정 페이지">
      <button
        disabled={pageStart === 0}
        onClick={() => onShowPage(previousStart)}
        type="button"
      >
        이전 일정
      </button>
      <button
        disabled={pageStart === initialPageStart}
        onClick={() => onShowPage(initialPageStart)}
        type="button"
      >
        오늘
      </button>
      <button
        disabled={pageEnd >= total}
        onClick={() => onShowPage(nextStart)}
        type="button"
      >
        다음 일정
      </button>
      <span aria-live="polite">
        {total === 0 ? 0 : pageStart + 1}–{pageEnd} / {total}개 일정
      </span>
    </nav>
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

function EventDetailDialog({
  event,
  onClose,
}: {
  readonly event: PublicEvent
  readonly onClose: () => void
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    function handleKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key === 'Escape') {
        onClose()
      } else if (keyEvent.key === 'Tab') {
        keyEvent.preventDefault()
        closeButtonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [onClose])

  return (
    <div
      className="event-detail-backdrop"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        aria-labelledby="event-detail-title"
        aria-modal="true"
        className="event-detail-dialog"
        role="dialog"
      >
        <div className="event-detail-dialog__heading">
          <div>
            <span className="event-detail-dialog__calendar">
              <span
                aria-hidden="true"
                style={{ backgroundColor: safeCalendarColor(event.calendar.color) }}
              />
              {event.calendar.name}
            </span>
            <h2 id="event-detail-title">{event.title}</h2>
          </div>
          <button
            aria-label="일정 상세 닫기"
            className="event-detail-dialog__close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            ×
          </button>
        </div>
        <dl className="event-detail-list">
          <div>
            <dt>날짜와 시간</dt>
            <dd>{formatEventDateTime(event)}</dd>
          </div>
          {event.location ? (
            <div>
              <dt>장소</dt>
              <dd>{event.location}</dd>
            </div>
          ) : null}
          {event.description ? (
            <div>
              <dt>설명</dt>
              <dd>{event.description}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  )
}

const MonthCalendar = memo(function MonthCalendar({
  endDate,
  eventsByDate,
  onSelectDate,
  onSelectEvent,
  startDate,
}: {
  readonly endDate: string
  readonly eventsByDate: ReadonlyMap<string, PublicEvent[]>
  readonly onSelectDate: (date: string) => void
  readonly onSelectEvent: (event: PublicEvent) => void
  readonly startDate: string
}) {
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
          const inRange = date >= startDate && date <= endDate
          const events = inRange ? (eventsByDate.get(date) ?? []) : []
          return (
            <div
              className={`calendar-day${inRange ? '' : ' calendar-day--outside'}`}
              key={date}
            >
              <button
                aria-label={`${formatDateHeading(date)} 주간 보기`}
                className="calendar-day__open-week"
                disabled={!inRange}
                onClick={() => onSelectDate(date)}
                type="button"
              >
                <span className="calendar-day__number">
                  {Number(date.slice(8, 10))}
                </span>
              </button>
              <span className="calendar-day__events">
                {events.slice(0, 3).map((event) => (
                  <button
                    aria-label={`${event.title} 상세 보기`}
                    className="calendar-event"
                    key={event.id}
                    onClick={() => onSelectEvent(event)}
                    title={`${event.title}${event.location ? ` · ${event.location}` : ''}`}
                    type="button"
                  >
                    <span
                      className="calendar-event__dot"
                      style={{ backgroundColor: safeCalendarColor(event.calendar.color) }}
                    />
                    <span className="calendar-event__text">
                      <strong>{event.title}</strong>
                      {event.location ? <small>{event.location}</small> : null}
                    </span>
                  </button>
                ))}
                {events.length > 3 ? (
                  <span className="calendar-event-more">+{events.length - 3}개</span>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})

const weekHourHeight = 34

const WeekCalendar = memo(function WeekCalendar({
  anchorDate,
  endDate,
  eventsByDate,
  onAnchorDateChange,
  onSelectEvent,
  startDate,
}: {
  readonly anchorDate: string
  readonly endDate: string
  readonly eventsByDate: ReadonlyMap<string, PublicEvent[]>
  readonly onAnchorDateChange: (date: string) => void
  readonly onSelectEvent: (event: PublicEvent) => void
  readonly startDate: string
}) {
  const today = formatLocalDate(new Date().toISOString())
  const boundedAnchorDate = clamp(anchorDate, startDate, endDate)
  const weekStart = startOfWeek(boundedAnchorDate)
  const dates = weekDates(weekStart)
  const weekEnd = dates[6] ?? weekStart
  const gridHeight = weekHourHeight * 24

  function moveWeek(amount: number) {
    const nextStart = addDays(weekStart, amount * 7)
    const boundedStart = clamp(
      nextStart,
      startOfWeek(startDate),
      startOfWeek(endDate),
    )
    onAnchorDateChange(
      firstDateInRange(weekDates(boundedStart), startDate, endDate),
    )
  }

  function moveToToday() {
    onAnchorDateChange(clamp(today, startDate, endDate))
  }

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

      <div className="week-timetable-scroll">
        <div className="week-timetable" aria-label="월요일부터 일요일까지 24시간 주간 시간표">
          <div className="week-time-corner">시간</div>
          {dates.map((date) => {
            const inRange = date >= startDate && date <= endDate
            return (
              <div
                className={`week-day-header${inRange ? '' : ' week-day-header--outside'}`}
                key={`header-${date}`}
              >
                <span>{formatWeekday(date)}</span>
                <strong>{Number(date.slice(8, 10))}</strong>
              </div>
            )
          })}

          <div className="week-all-day-label">종일·미정</div>
          {dates.map((date) => {
            const inRange = date >= startDate && date <= endDate
            const events = inRange
              ? (eventsByDate.get(date) ?? []).filter(isUntimedEvent)
              : []
            return (
              <div
                aria-label={`${formatDateHeading(date)} 종일 및 시간 미정 일정`}
                className={`week-all-day-cell${inRange ? '' : ' week-timetable-outside'}`}
                key={`all-day-${date}`}
              >
                {events.map((event) => (
                  <WeekAllDayEvent
                    event={event}
                    key={event.id}
                    onSelect={onSelectEvent}
                  />
                ))}
              </div>
            )
          })}

          <div className="week-time-axis" style={{ height: gridHeight }}>
            {Array.from({ length: 25 }, (_, hour) => (
              <span
                className={hour === 0 ? 'is-start' : hour === 24 ? 'is-end' : ''}
                key={hour}
                style={{ top: hour * weekHourHeight }}
              >
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {dates.map((date) => {
            const inRange = date >= startDate && date <= endDate
            const events = inRange
              ? layoutTimedEventsForDate(eventsByDate.get(date) ?? [], date)
              : []
            return (
              <div
                aria-label={`${formatDateHeading(date)} 시간별 일정`}
                className={`week-time-column${inRange ? '' : ' week-timetable-outside'}`}
                key={`time-${date}`}
                style={{ height: gridHeight }}
              >
                {events.map((layout) => (
                  <WeekTimedEvent
                    key={layout.event.id}
                    layout={layout}
                    onSelect={onSelectEvent}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
})

function WeekAllDayEvent({
  event,
  onSelect,
}: {
  readonly event: PublicEvent
  readonly onSelect: (event: PublicEvent) => void
}) {
  return (
    <button
      aria-label={`${event.title} 상세 보기`}
      className="week-all-day-event"
      onClick={() => onSelect(event)}
      style={{ borderLeftColor: safeCalendarColor(event.calendar.color) }}
      title={`${event.title} · ${formatEventTime(event)}`}
      type="button"
    >
      <strong>{event.title}</strong>
      {event.location ? <small>{event.location}</small> : null}
    </button>
  )
}

interface TimedEventLayout {
  column: number
  columnCount: number
  readonly endMinute: number
  readonly event: PublicEvent
  readonly startMinute: number
}

function WeekTimedEvent({
  layout,
  onSelect,
}: {
  readonly layout: TimedEventLayout
  readonly onSelect: (event: PublicEvent) => void
}) {
  const top = (layout.startMinute / 60) * weekHourHeight
  const height = Math.max(
    ((layout.endMinute - layout.startMinute) / 60) * weekHourHeight,
    24,
  )
  const laneWidth = 100 / layout.columnCount
  return (
    <button
      aria-label={`${layout.event.title} 상세 보기`}
      className="week-timed-event"
      onClick={() => onSelect(layout.event)}
      style={{
        borderLeftColor: safeCalendarColor(layout.event.calendar.color),
        height,
        left: `calc(${layout.column * laneWidth}% + 2px)`,
        top,
        width: `calc(${laneWidth}% - 4px)`,
      }}
      title={`${layout.event.title} · ${formatEventTime(layout.event)}`}
      type="button"
    >
      <strong>{layout.event.title}</strong>
      {layout.event.location ? <small>{layout.event.location}</small> : null}
      <span>{formatEventTime(layout.event)}</span>
    </button>
  )
}

function groupEvents(
  data: PublicCalendarData,
  policyStart: string,
  policyEnd: string,
): Array<[string, PublicEvent[]]> {
  const grouped = new Map<string, PublicEvent[]>()
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

function groupOccurrences(
  occurrences: EventOccurrence[],
): Array<[string, PublicEvent[]]> {
  const grouped = new Map<string, PublicEvent[]>()
  for (const { date, event } of occurrences) {
    const existing = grouped.get(date) ?? []
    existing.push(event)
    grouped.set(date, existing)
  }
  return [...grouped.entries()]
}

function initialListPageStart(
  occurrences: EventOccurrence[],
  today: string,
): number {
  const todayIndex = occurrences.findIndex(({ date }) => date >= today)
  return todayIndex === -1
    ? Math.max(0, occurrences.length - listPageSize)
    : todayIndex
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

function isUntimedEvent(event: PublicEvent): boolean {
  return event.isAllDay || !event.startsAt || !event.endsAt
}

function layoutTimedEventsForDate(
  events: PublicEvent[],
  date: string,
): TimedEventLayout[] {
  const dayStart = Date.parse(`${date}T00:00:00+09:00`)
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  const segments = events
    .filter((event) => !isUntimedEvent(event))
    .flatMap((event) => {
      const eventStart = Date.parse(event.startsAt ?? '')
      const eventEnd = Date.parse(event.endsAt ?? '')
      const segmentStart = Math.max(eventStart, dayStart)
      const segmentEnd = Math.min(eventEnd, dayEnd)
      // A zero-length event (end == start) is a point in time: keep it on its own day.
      const isPoint = eventEnd === eventStart
      if (
        !Number.isFinite(segmentStart) ||
        !Number.isFinite(segmentEnd) ||
        (isPoint
          ? eventStart < dayStart || eventStart >= dayEnd
          : segmentEnd <= segmentStart)
      ) {
        return []
      }
      return [
        {
          column: 0,
          columnCount: 1,
          endMinute: (segmentEnd - dayStart) / 60_000,
          event,
          startMinute: (segmentStart - dayStart) / 60_000,
        },
      ]
    })
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        right.endMinute - left.endMinute,
    )

  const positioned: TimedEventLayout[] = []
  let group: TimedEventLayout[] = []
  let groupEnd = -1

  function flushGroup() {
    const laneEnds: number[] = []
    for (const segment of group) {
      let column = laneEnds.findIndex((endMinute) => endMinute <= segment.startMinute)
      if (column === -1) {
        column = laneEnds.length
      }
      laneEnds[column] = segment.endMinute
      segment.column = column
    }
    for (const segment of group) {
      segment.columnCount = laneEnds.length
    }
    positioned.push(...group)
    group = []
    groupEnd = -1
  }

  for (const segment of segments) {
    if (group.length > 0 && segment.startMinute >= groupEnd) {
      flushGroup()
    }
    group.push(segment)
    groupEnd = Math.max(groupEnd, segment.endMinute)
  }
  if (group.length > 0) {
    flushGroup()
  }
  return positioned
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

function formatEventDateTime(event: PublicEvent): string {
  const range = eventDateRange(event)
  if (!range) {
    return formatEventTime(event)
  }
  const date =
    range[0] === range[1]
      ? formatDateHeading(range[0])
      : `${formatDateHeading(range[0])} – ${formatDateHeading(range[1])}`
  return `${date} · ${formatEventTime(event)}`
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
  return addDays(date, weekday === 0 ? -6 : 1 - weekday)
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
