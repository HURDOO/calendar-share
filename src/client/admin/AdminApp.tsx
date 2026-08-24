import { type FormEvent, useEffect, useState } from 'react'

import { ShareDashboard } from './ShareDashboard'

interface SessionResponse {
  readonly authenticated: true
  readonly csrfToken: string
  readonly expiresAt: string
}

interface GoogleStatusResponse {
  readonly connected: boolean
  readonly lastErrorCode: string | null
  readonly lastSyncedAt: string | null
  readonly calendars: { readonly active: number; readonly ready: number }
  readonly queue: Record<string, number>
}

type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'anonymous' }
  | { readonly status: 'authenticated'; readonly csrfToken: string }

type GoogleState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly value: GoogleStatusResponse }

export function AdminApp() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [google, setGoogle] = useState<GoogleState>({ status: 'idle' })

  useEffect(() => {
    const controller = new AbortController()

    void fetch('/api/v1/admin/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setSession({ status: 'anonymous' })
          return
        }

        if (!response.ok) {
          throw new Error('session-check-failed')
        }

        const body = (await response.json()) as SessionResponse
        setSession({ status: 'authenticated', csrfToken: body.csrfToken })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setMessage('관리자 세션을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
        setSession({ status: 'anonymous' })
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (session.status !== 'authenticated') {
      setGoogle({ status: 'idle' })
      return
    }

    const controller = new AbortController()
    setGoogle({ status: 'loading' })
    void fetch('/api/v1/admin/google/status', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('google-status-failed')
        }
        setGoogle({
          status: 'ready',
          value: (await response.json()) as GoogleStatusResponse,
        })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        setGoogle({ status: 'unavailable' })
      })

    return () => controller.abort()
  }, [session.status])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')

    try {
      const response = await fetch('/api/v1/admin/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (response.status === 401) {
        setMessage('비밀번호를 확인해 주세요.')
        return
      }

      if (response.status === 429) {
        setMessage('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.')
        return
      }

      if (!response.ok) {
        setMessage('로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }

      const body = (await response.json()) as SessionResponse
      setPassword('')
      setSession({ status: 'authenticated', csrfToken: body.csrfToken })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    if (session.status !== 'authenticated') {
      return
    }

    setSubmitting(true)
    setMessage('')

    try {
      const response = await fetch('/api/v1/admin/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': session.csrfToken },
      })

      if (!response.ok) {
        setMessage('로그아웃하지 못했습니다. 다시 시도해 주세요.')
        return
      }

      setSession({ status: 'anonymous' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGoogleConnect() {
    if (session.status !== 'authenticated') {
      return
    }

    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch('/api/v1/admin/google/connect', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': session.csrfToken },
      })
      if (!response.ok) {
        setMessage('Google 연결을 시작하지 못했습니다.')
        return
      }
      const body = (await response.json()) as { authorizationUrl: string }
      window.location.assign(body.authorizationUrl)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGoogleSync() {
    if (session.status !== 'authenticated') {
      return
    }

    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch('/api/v1/admin/google/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': session.csrfToken },
      })
      setMessage(
        response.ok
          ? '복구 동기화를 요청했습니다.'
          : '동기화를 요청하지 못했습니다.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGoogleDisconnect() {
    if (
      session.status !== 'authenticated' ||
      !window.confirm('Google Calendar 연결과 로컬 일정 데이터를 제거할까요?')
    ) {
      return
    }

    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch('/api/v1/admin/google/connection', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': session.csrfToken },
      })
      if (!response.ok) {
        setMessage('Google 연결을 해제하지 못했습니다.')
        return
      }
      setGoogle({
        status: 'ready',
        value: {
          connected: false,
          lastErrorCode: null,
          lastSyncedAt: null,
          calendars: { active: 0, ready: 0 },
          queue: {},
        },
      })
      setMessage('Google Calendar 연결을 해제했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  if (session.status === 'loading') {
    return (
      <main className="app-shell">
        <p className="loading-message" role="status">
          관리자 세션을 확인하고 있습니다.
        </p>
      </main>
    )
  }

  if (session.status === 'authenticated') {
    return (
      <main className="admin-shell">
        <header className="admin-header">
          <div>
            <span className="eyebrow">Calendar administration</span>
            <h1>관리자 대시보드</h1>
          </div>
          <button
            className="secondary-button"
            disabled={submitting}
            onClick={() => void handleLogout()}
            type="button"
          >
            로그아웃
          </button>
        </header>

        <section className="admin-panel" aria-labelledby="connection-title">
          <p className="panel-kicker">읽기 전용 연동</p>
          <h2 id="connection-title">Google Calendar</h2>
          {google.status === 'loading' || google.status === 'idle' ? (
            <p role="status">연결 상태를 확인하고 있습니다.</p>
          ) : google.status === 'unavailable' ? (
            <p role="alert">연결 상태를 불러오지 못했습니다.</p>
          ) : google.value.connected ? (
            <>
              <dl className="connection-status">
                <div>
                  <dt>상태</dt>
                  <dd>{google.value.lastErrorCode ? '확인 필요' : '연결됨'}</dd>
                </div>
                <div>
                  <dt>캘린더</dt>
                  <dd>
                    {google.value.calendars.ready}/{google.value.calendars.active} 동기화
                  </dd>
                </div>
                <div>
                  <dt>마지막 동기화</dt>
                  <dd>{formatDateTime(google.value.lastSyncedAt)}</dd>
                </div>
                <div>
                  <dt>대기 작업</dt>
                  <dd>{google.value.queue.PENDING ?? 0}</dd>
                </div>
              </dl>
              {google.value.lastErrorCode ? (
                <p className="inline-warning">
                  오류 코드: {google.value.lastErrorCode}
                </p>
              ) : null}
              <div className="button-row">
                <button
                  className="primary-button"
                  disabled={submitting}
                  onClick={() => void handleGoogleSync()}
                  type="button"
                >
                  지금 동기화
                </button>
                <button
                  className="danger-button"
                  disabled={submitting}
                  onClick={() => void handleGoogleDisconnect()}
                  type="button"
                >
                  연결 해제
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                캘린더 목록과 일정만 읽습니다. 캘린더에 일정을 쓰거나 수정하지
                않습니다.
              </p>
              <button
                className="primary-button"
                disabled={submitting}
                onClick={() => void handleGoogleConnect()}
                type="button"
              >
                Google 계정 연결
              </button>
            </>
          )}
        </section>

        <ShareDashboard csrfToken={session.csrfToken} />

        {message ? (
          <p className="form-message" role="alert">
            {message}
          </p>
        ) : null}
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="login-card" aria-labelledby="login-title">
        <span className="eyebrow">Private dashboard</span>
        <h1 id="login-title">관리자 로그인</h1>
        <p className="lead">캘린더 공유 설정은 관리자 비밀번호로 보호됩니다.</p>

        <form className="login-form" onSubmit={(event) => void handleLogin(event)}>
          <label htmlFor="admin-password">비밀번호</label>
          <input
            autoComplete="current-password"
            id="admin-password"
            maxLength={1024}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? '확인 중…' : '로그인'}
          </button>
        </form>

        {message ? (
          <p className="form-message" role="alert">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  )
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '아직 없음'
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
