export function App() {
  return (
    <main className="app-shell">
      <section className="status-card" aria-labelledby="project-title">
        <span className="eyebrow">Calendar sharing, made personal</span>
        <h1 id="project-title">캘공</h1>
        <p className="lead">
          필요한 사람에게, 필요한 일정만. 지금은 안전한 구현 골격을 준비한 단계입니다.
        </p>
        <dl className="status-list">
          <div>
            <dt>현재 단계</dt>
            <dd>프로젝트 골격</dd>
          </div>
          <div>
            <dt>다음 단계</dt>
            <dd>SQLite 데이터 모델</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}
