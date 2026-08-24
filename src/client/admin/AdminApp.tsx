import { type FormEvent, useEffect, useState } from 'react'

interface SessionResponse {
  readonly authenticated: true
  readonly csrfToken: string
  readonly expiresAt: string
}

type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'anonymous' }
  | { readonly status: 'authenticated'; readonly csrfToken: string }

export function AdminApp() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
          <p className="panel-kicker">보호된 관리자 영역</p>
          <h2 id="connection-title">Google Calendar 연결 준비</h2>
          <p>관리자 인증이 완료되었습니다. 다음 단계에서 읽기 전용 연결을 추가합니다.</p>
        </section>

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
