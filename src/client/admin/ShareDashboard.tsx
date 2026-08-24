import { type FormEvent, useEffect, useState } from 'react'

import {
  type PublicCalendarData,
  type PublicEvent,
  PublicCalendarView,
} from '../public/PublicCalendarApp'

interface CalendarView {
  readonly id: string
  readonly name: string
  readonly color: string | null
  readonly isPrimary: boolean
  readonly syncStatus: string
}

interface ShareView {
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

interface ShareFormValue {
  readonly name: string
  readonly calendarScope: 'ALL' | 'SELECTED'
  readonly calendarIds: string[]
  readonly eventStartDate: string
  readonly eventEndDate: string
  readonly limitAccess: boolean
  readonly accessStartsAt: string
  readonly accessEndsAt: string
}

interface PreviewResponse {
  readonly availability:
    | 'AVAILABLE'
    | 'NOT_FOUND'
    | 'REVOKED'
    | 'NOT_STARTED'
    | 'EXPIRED'
  readonly share: {
    readonly id: string
    readonly name: string
    readonly eventStartDate: string
    readonly eventEndDate: string
  } | null
  readonly events: PublicEvent[]
}

type PreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly value: PreviewResponse }

interface LinkNotice {
  readonly shareId: string
  readonly shareName: string
  readonly shareUrl: string
}

export function ShareDashboard({ csrfToken }: { readonly csrfToken: string }) {
  const [calendars, setCalendars] = useState<CalendarView[]>([])
  const [shares, setShares] = useState<ShareView[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<ShareView | 'new' | null>(null)
  const [linkNotice, setLinkNotice] = useState<LinkNotice | null>(null)
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    void Promise.all([
      fetch('/api/v1/admin/calendars', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      }),
      fetch('/api/v1/admin/shares', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      }),
    ])
      .then(async ([calendarResponse, shareResponse]) => {
        if (!calendarResponse.ok || !shareResponse.ok) {
          throw new Error('share-dashboard-load-failed')
        }
        const calendarBody = (await calendarResponse.json()) as {
          calendars: CalendarView[]
        }
        const shareBody = (await shareResponse.json()) as { shares: ShareView[] }
        if (!active) {
          return
        }
        setCalendars(calendarBody.calendars)
        setShares(shareBody.shares)
      })
      .catch((error: unknown) => {
        if (
          !active ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return
        }
        setMessage('공유 설정을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [])

  async function saveShare(value: ShareFormValue) {
    setBusy(true)
    setMessage('')
    const isNew = editing === 'new'
    const url = isNew
      ? '/api/v1/admin/shares'
      : `/api/v1/admin/shares/${editing?.id ?? ''}`
    try {
      const response = await fetch(url, {
        body: JSON.stringify(toSharePayload(value)),
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        method: isNew ? 'POST' : 'PUT',
      })
      if (!response.ok) {
        setMessage('공유를 저장하지 못했습니다. 입력값을 확인해 주세요.')
        return
      }
      const body = (await response.json()) as {
        share: ShareView
        shareUrl?: string
      }
      setShares((current) => upsertShare(current, body.share))
      if (body.shareUrl) {
        setLinkNotice({
          shareId: body.share.id,
          shareName: body.share.name,
          shareUrl: body.shareUrl,
        })
      }
      setEditing(null)
      setMessage(isNew ? '공유를 만들었습니다.' : '공유를 수정했습니다.')
    } catch {
      setMessage('공유를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function previewShare(share: ShareView) {
    setPreview({ status: 'loading' })
    setMessage('')
    try {
      const response = await fetch(`/api/v1/admin/shares/${share.id}/preview`, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) {
        setPreview({ status: 'error' })
        return
      }
      setPreview({ status: 'ready', value: (await response.json()) as PreviewResponse })
    } catch {
      setPreview({ status: 'error' })
    }
  }

  async function rotateLink(share: ShareView) {
    if (
      !window.confirm(
        '기존 링크와 방문자 세션이 즉시 무효화됩니다. 새 링크를 발급할까요?',
      )
    ) {
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(
        `/api/v1/admin/shares/${share.id}/rotate-token`,
        {
          credentials: 'same-origin',
          headers: { 'X-CSRF-Token': csrfToken },
          method: 'POST',
        },
      )
      if (!response.ok) {
        setMessage('새 링크를 발급하지 못했습니다.')
        return
      }
      const body = (await response.json()) as { shareUrl: string }
      setLinkNotice({
        shareId: share.id,
        shareName: share.name,
        shareUrl: body.shareUrl,
      })
      setMessage('새 링크를 발급했습니다. 이전 링크는 더 이상 사용할 수 없습니다.')
    } catch {
      setMessage('새 링크를 발급하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function revokeShare(share: ShareView) {
    if (!window.confirm(`“${share.name}” 공유를 종료할까요?`)) {
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/v1/admin/shares/${share.id}`, {
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken },
        method: 'DELETE',
      })
      if (!response.ok) {
        setMessage('공유를 종료하지 못했습니다.')
        return
      }
      const revokedAt = new Date().toISOString()
      setShares((current) =>
        current.map((item) =>
          item.id === share.id ? { ...item, revokedAt, updatedAt: revokedAt } : item,
        ),
      )
      setLinkNotice((current) => (current?.shareId === share.id ? null : current))
      setPreview({ status: 'idle' })
      setMessage('공유를 종료했습니다.')
    } catch {
      setMessage('공유를 종료하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink(notice: LinkNotice) {
    const copied = await copyText(notice.shareUrl)
    setMessage(
      copied
        ? '공유 링크를 복사했습니다.'
        : '링크를 복사하지 못했습니다. 직접 선택해 복사해 주세요.',
    )
  }

  return (
    <section className="admin-panel shares-panel" aria-labelledby="shares-title">
      <div className="shares-heading">
        <div>
          <p className="panel-kicker">사람별 공개 범위</p>
          <h2 id="shares-title">공유 링크</h2>
        </div>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => setEditing('new')}
          type="button"
        >
          새 공유 만들기
        </button>
      </div>

      {message ? (
        <p className="dashboard-message" role="status">
          {message}
        </p>
      ) : null}

      {linkNotice ? (
        <section className="link-notice" aria-labelledby="new-link-title">
          <div>
            <p className="panel-kicker">지금 한 번만 표시됩니다</p>
            <h3 id="new-link-title">{linkNotice.shareName} 링크</h3>
            <p>나중에는 원문 링크를 다시 볼 수 없으며 새 링크를 발급해야 합니다.</p>
          </div>
          <label htmlFor="new-share-link">공유 주소</label>
          <div className="copy-row">
            <input id="new-share-link" readOnly value={linkNotice.shareUrl} />
            <button
              className="primary-button"
              onClick={() => void copyLink(linkNotice)}
              type="button"
            >
              링크 복사
            </button>
          </div>
        </section>
      ) : null}

      {editing ? (
        <ShareForm
          calendars={calendars}
          disabled={busy}
          initial={editing === 'new' ? null : editing}
          key={editing === 'new' ? 'new' : editing.id}
          onCancel={() => setEditing(null)}
          onSave={saveShare}
        />
      ) : null}

      {loading ? (
        <p role="status">공유 목록을 불러오고 있습니다.</p>
      ) : shares.length === 0 ? (
        <div className="share-list-empty">
          <h3>아직 만든 공유가 없어요</h3>
          <p>새 공유를 만들어 캘린더와 기간을 안전하게 제한할 수 있습니다.</p>
        </div>
      ) : (
        <ul className="share-list">
          {shares.map((share) => {
            const currentLink =
              linkNotice?.shareId === share.id ? linkNotice : null
            return (
              <li className="share-card" key={share.id}>
                <div className="share-card__heading">
                  <div>
                    <span
                      className={`share-state ${share.revokedAt ? 'share-state--revoked' : ''}`}
                    >
                      {share.revokedAt ? '종료됨' : '공유 중'}
                    </span>
                    <h3>{share.name}</h3>
                  </div>
                  <span className="share-scope">
                    {share.calendarScope === 'ALL'
                      ? '전체 캘린더'
                      : `${share.calendarIds.length}개 캘린더`}
                  </span>
                </div>
                <dl className="share-summary">
                  <div>
                    <dt>일정 범위</dt>
                    <dd>
                      {share.eventStartDate} – {share.eventEndDate}
                    </dd>
                  </div>
                  <div>
                    <dt>접근 시간</dt>
                    <dd>{formatAccessRange(share)}</dd>
                  </div>
                </dl>
                <div className="share-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void previewShare(share)}
                    type="button"
                  >
                    미리보기
                  </button>
                  {!share.revokedAt ? (
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setEditing(share)}
                        type="button"
                      >
                        수정
                      </button>
                      {currentLink ? (
                        <button
                          className="secondary-button"
                          onClick={() => void copyLink(currentLink)}
                          type="button"
                        >
                          링크 복사
                        </button>
                      ) : (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void rotateLink(share)}
                          type="button"
                        >
                          새 링크 발급
                        </button>
                      )}
                      <button
                        className="danger-button"
                        disabled={busy}
                        onClick={() => void revokeShare(share)}
                        type="button"
                      >
                        공유 종료
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <SharePreview preview={preview} onClose={() => setPreview({ status: 'idle' })} />
    </section>
  )
}

function ShareForm({
  calendars,
  disabled,
  initial,
  onCancel,
  onSave,
}: {
  readonly calendars: CalendarView[]
  readonly disabled: boolean
  readonly initial: ShareView | null
  readonly onCancel: () => void
  readonly onSave: (value: ShareFormValue) => Promise<void>
}) {
  const [value, setValue] = useState<ShareFormValue>(() => formValue(initial))
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validation = validateForm(value)
    if (validation) {
      setError(validation)
      return
    }
    setError('')
    await onSave(value)
  }

  function selectScope(scope: ShareFormValue['calendarScope']) {
    setValue((current) => ({
      ...current,
      calendarScope: scope,
      calendarIds:
        scope === 'SELECTED' && current.calendarIds.length === 0
          ? calendars.map((calendar) => calendar.id)
          : current.calendarIds,
    }))
  }

  function toggleCalendar(calendarId: string, checked: boolean) {
    setValue((current) => ({
      ...current,
      calendarIds: checked
        ? [...new Set([...current.calendarIds, calendarId])]
        : current.calendarIds.filter((id) => id !== calendarId),
    }))
  }

  return (
    <form className="share-form" onSubmit={(event) => void submit(event)}>
      <div className="share-form__heading">
        <div>
          <p className="panel-kicker">{initial ? '공유 수정' : '새 공유'}</p>
          <h3>{initial ? initial.name : '공개 범위를 정해 주세요'}</h3>
        </div>
        <button className="secondary-button" onClick={onCancel} type="button">
          닫기
        </button>
      </div>

      <div className="form-field">
        <label htmlFor="share-name">공유 이름</label>
        <input
          autoFocus
          id="share-name"
          maxLength={120}
          onChange={(event) => setValue({ ...value, name: event.target.value })}
          placeholder="예: 가족 일정"
          required
          type="text"
          value={value.name}
        />
      </div>

      <fieldset className="form-field">
        <legend>공개할 캘린더</legend>
        <label className="choice-row">
          <input
            checked={value.calendarScope === 'ALL'}
            name="calendar-scope"
            onChange={() => selectScope('ALL')}
            type="radio"
          />
          <span>
            <strong>전체 캘린더</strong>
            <small>나중에 추가되는 캘린더도 자동으로 포함합니다.</small>
          </span>
        </label>
        <label className="choice-row">
          <input
            checked={value.calendarScope === 'SELECTED'}
            name="calendar-scope"
            onChange={() => selectScope('SELECTED')}
            type="radio"
          />
          <span>
            <strong>선택한 캘린더만</strong>
            <small>새 캘린더는 자동으로 포함하지 않습니다.</small>
          </span>
        </label>
        {value.calendarScope === 'SELECTED' ? (
          <div className="calendar-options">
            {calendars.length === 0 ? (
              <p>선택할 수 있는 활성 캘린더가 없습니다.</p>
            ) : (
              calendars.map((calendar) => (
                <label className="calendar-option" key={calendar.id}>
                  <input
                    checked={value.calendarIds.includes(calendar.id)}
                    onChange={(event) =>
                      toggleCalendar(calendar.id, event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span
                    className="calendar-option__color"
                    style={{ backgroundColor: safeColor(calendar.color) }}
                  />
                  <span>{calendar.name}</span>
                  {calendar.isPrimary ? <small>기본</small> : null}
                </label>
              ))
            )}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="form-field date-fields">
        <legend>공개할 일정 날짜</legend>
        <label>
          시작일
          <input
            onChange={(event) =>
              setValue({ ...value, eventStartDate: event.target.value })
            }
            required
            type="date"
            value={value.eventStartDate}
          />
        </label>
        <label>
          종료일
          <input
            min={value.eventStartDate}
            onChange={(event) =>
              setValue({ ...value, eventEndDate: event.target.value })
            }
            required
            type="date"
            value={value.eventEndDate}
          />
        </label>
      </fieldset>

      <fieldset className="form-field">
        <legend>링크 접근 시간</legend>
        <label className="choice-row">
          <input
            checked={!value.limitAccess}
            name="access-mode"
            onChange={() => setValue({ ...value, limitAccess: false })}
            type="radio"
          />
          <span>
            <strong>항상 접근 가능</strong>
          </span>
        </label>
        <label className="choice-row">
          <input
            checked={value.limitAccess}
            name="access-mode"
            onChange={() => setValue({ ...value, limitAccess: true })}
            type="radio"
          />
          <span>
            <strong>접근 시간 제한</strong>
          </span>
        </label>
        {value.limitAccess ? (
          <div className="date-fields access-fields">
            <label>
              시작 시각
              <input
                onChange={(event) =>
                  setValue({ ...value, accessStartsAt: event.target.value })
                }
                required
                type="datetime-local"
                value={value.accessStartsAt}
              />
            </label>
            <label>
              종료 시각
              <input
                onChange={(event) =>
                  setValue({ ...value, accessEndsAt: event.target.value })
                }
                required
                type="datetime-local"
                value={value.accessEndsAt}
              />
            </label>
          </div>
        ) : null}
      </fieldset>

      {error ? (
        <p className="form-message" role="alert">
          {error}
        </p>
      ) : null}
      <div className="button-row">
        <button className="primary-button" disabled={disabled} type="submit">
          {initial ? '변경 저장' : '공유 만들기'}
        </button>
        <button className="secondary-button" onClick={onCancel} type="button">
          취소
        </button>
      </div>
    </form>
  )
}

function SharePreview({
  preview,
  onClose,
}: {
  readonly preview: PreviewState
  readonly onClose: () => void
}) {
  if (preview.status === 'idle') {
    return null
  }
  return (
    <section className="share-preview" aria-labelledby="preview-title">
      <div className="share-form__heading">
        <div>
          <p className="panel-kicker">방문자와 동일한 정책</p>
          <h3 id="preview-title">공유 미리보기</h3>
        </div>
        <button className="secondary-button" onClick={onClose} type="button">
          닫기
        </button>
      </div>
      {preview.status === 'loading' ? (
        <p role="status">미리보기를 불러오고 있습니다.</p>
      ) : preview.status === 'error' ? (
        <p role="alert">미리보기를 불러오지 못했습니다.</p>
      ) : preview.value.availability !== 'AVAILABLE' || !preview.value.share ? (
        <div className="preview-unavailable">
          <strong>{availabilityLabel(preview.value.availability)}</strong>
          <p>현재 기준으로 방문자에게 일정이 제공되지 않습니다.</p>
        </div>
      ) : (
        <PublicCalendarView
          data={preview.value as PublicCalendarData}
          showStreamStatus={false}
        />
      )}
    </section>
  )
}

function formValue(share: ShareView | null): ShareFormValue {
  if (share) {
    return {
      name: share.name,
      calendarScope: share.calendarScope,
      calendarIds: share.calendarIds,
      eventStartDate: share.eventStartDate,
      eventEndDate: share.eventEndDate,
      limitAccess: Boolean(share.accessStartsAt && share.accessEndsAt),
      accessStartsAt: toLocalInput(share.accessStartsAt),
      accessEndsAt: toLocalInput(share.accessEndsAt),
    }
  }
  const today = todayInSeoul()
  return {
    name: '',
    calendarScope: 'ALL',
    calendarIds: [],
    eventStartDate: today,
    eventEndDate: addMonths(today, 1),
    limitAccess: false,
    accessStartsAt: '',
    accessEndsAt: '',
  }
}

function validateForm(value: ShareFormValue): string | null {
  if (!value.name.trim()) {
    return '공유 이름을 입력해 주세요.'
  }
  if (!value.eventStartDate || value.eventEndDate < value.eventStartDate) {
    return '일정 날짜 범위를 확인해 주세요.'
  }
  if (
    value.limitAccess &&
    (!value.accessStartsAt ||
      !value.accessEndsAt ||
      Date.parse(value.accessEndsAt) <= Date.parse(value.accessStartsAt))
  ) {
    return '접근 시작과 종료 시각을 확인해 주세요.'
  }
  return null
}

function toSharePayload(value: ShareFormValue) {
  return {
    accessEndsAt: value.limitAccess
      ? new Date(value.accessEndsAt).toISOString()
      : null,
    accessStartsAt: value.limitAccess
      ? new Date(value.accessStartsAt).toISOString()
      : null,
    calendarIds: value.calendarScope === 'ALL' ? [] : value.calendarIds,
    calendarScope: value.calendarScope,
    eventEndDate: value.eventEndDate,
    eventStartDate: value.eventStartDate,
    name: value.name.trim(),
  }
}

function upsertShare(current: ShareView[], share: ShareView): ShareView[] {
  const existing = current.some((item) => item.id === share.id)
  return existing
    ? current.map((item) => (item.id === share.id ? share : item))
    : [share, ...current]
}

function formatAccessRange(share: ShareView): string {
  if (!share.accessStartsAt || !share.accessEndsAt) {
    return '항상 가능'
  }
  return `${formatShortDateTime(share.accessStartsAt)} – ${formatShortDateTime(
    share.accessEndsAt,
  )}`
}

function formatShortDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function toLocalInput(value: string | null): string {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function todayInSeoul(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Seoul',
    year: 'numeric',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addMonths(value: string, amount: number): string {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + amount, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  return [
    target.getUTCFullYear(),
    String(target.getUTCMonth() + 1).padStart(2, '0'),
    String(Math.min(day, lastDay)).padStart(2, '0'),
  ].join('-')
}

function availabilityLabel(value: PreviewResponse['availability']): string {
  switch (value) {
    case 'NOT_STARTED':
      return '접근 시작 전입니다.'
    case 'EXPIRED':
      return '접근 시간이 종료되었습니다.'
    case 'REVOKED':
      return '종료된 공유입니다.'
    case 'NOT_FOUND':
      return '공유를 찾을 수 없습니다.'
    case 'AVAILABLE':
      return '공유 중입니다.'
  }
}

function safeColor(value: string | null): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#4b9ad1'
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
    const input = document.createElement('textarea')
    input.value = value
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.append(input)
    input.select()
    const copied = document.execCommand('copy')
    input.remove()
    return copied
  } catch {
    return false
  }
}
