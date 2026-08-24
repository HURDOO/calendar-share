import { AdminApp } from './admin/AdminApp'
import {
  PublicCalendarApp,
  PublicUnavailablePage,
} from './public/PublicCalendarApp'

export function App() {
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
