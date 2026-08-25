import { useEffect, useState } from 'react'

import { AdminApp } from './admin/AdminApp'
import {
  PublicCalendarApp,
  PublicUnavailablePage,
} from './public/PublicCalendarApp'

export function App({ initialShareToken = null }: { initialShareToken?: string | null }) {
  if (initialShareToken !== null) {
    return <ShareTokenExchange token={initialShareToken} />
  }

  if (window.location.pathname.startsWith('/admin')) {
    return <AdminApp />
  }

  if (window.location.pathname === '/share/unavailable') {
    return <PublicUnavailablePage />
  }

  const shareMatch = /^\/share\/([0-9a-f-]{36})$/i.exec(window.location.pathname)
  if (shareMatch?.[1]) {
    return <PublicCalendarApp expectedShareId={shareMatch[1]} />
  }

  return (
    <main className="app-shell">
      <section className="status-card" aria-labelledby="project-title">
        <span className="eyebrow">Calendar sharing, made personal</span>
        <h1 id="project-title">캘공</h1>
        <p className="lead">
          필요한 사람에게, 필요한 일정만. 전달받은 공유 링크로 안전하게 확인하세요.
        </p>
        <dl className="status-list">
          <div>
            <dt>이용 방법</dt>
            <dd>공유 링크 열기</dd>
          </div>
          <div>
            <dt>공개 범위</dt>
            <dd>허용된 일정만</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}

function ShareTokenExchange({ token }: { readonly token: string }) {
  const [shareId, setShareId] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(!/^[A-Za-z0-9_-]{43}$/.test(token))

  useEffect(() => {
    if (unavailable) {
      window.history.replaceState(null, '', '/share/unavailable')
      return
    }
    const controller = new AbortController()
    void fetch('/api/v1/public/session', {
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('share-token-exchange-failed')
        }
        const body = (await response.json()) as { shareId: string }
        window.history.replaceState(null, '', `/share/${body.shareId}`)
        setShareId(body.shareId)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        window.history.replaceState(null, '', '/share/unavailable')
        setUnavailable(true)
      })
    return () => controller.abort()
  }, [token, unavailable])

  if (unavailable) {
    return <PublicUnavailablePage />
  }
  if (shareId) {
    return <PublicCalendarApp expectedShareId={shareId} />
  }
  return (
    <main className="visitor-shell visitor-state">
      <p role="status">공유 링크를 확인하고 있습니다.</p>
    </main>
  )
}
