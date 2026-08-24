import { AdminApp } from './admin/AdminApp'

export function App() {
  if (window.location.pathname.startsWith('/admin')) {
    return <AdminApp />
  }

  return (
    <main className="app-shell">
      <section className="status-card" aria-labelledby="project-title">
        <span className="eyebrow">Calendar sharing, made personal</span>
        <h1 id="project-title">캘공</h1>
        <p className="lead">
          필요한 사람에게, 필요한 일정만. 안전한 개인 캘린더 공유를 준비하고 있습니다.
        </p>
        <dl className="status-list">
          <div>
            <dt>현재 단계</dt>
            <dd>관리자 인증</dd>
          </div>
          <div>
            <dt>다음 단계</dt>
            <dd>Google Calendar 연결</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}
