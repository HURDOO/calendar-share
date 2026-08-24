# 작업 목록

상태: `[ ]` 대기, `[-]` 진행, `[>]` 명시된 다음 작업, `[~]` 보류, `[x]` 완료.

## [x] T-001 명세 승인과 개인정보 차단 결정 해소

- 범위: `docs/SPEC.md`의 가정과 결정 항목을 사용자와 검토하고 공개 상세 필드, 시간 경계, 캘린더 범위 모드, 운영 origin, secret 전달, 보존 구간을 확정한다.
- 선행 조건: 없음.
- 산출물: 사용자 결정을 반영한 `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.
- 완료 조건: 2026-08-25 사용자 답변으로 모든 제품 차단 결정이 해소되고 SPEC과 ARCHITECTURE가 일치한다. 구현은 별도 지시 전 시작하지 않는다.

## [x] T-002 프로젝트 골격과 품질 게이트 구성

- 범위: 단일 pnpm 프로젝트에 TypeScript strict, Fastify, React/Vite 기본 구조와 lint/typecheck/test/build 스크립트, 환경변수 스키마, 빈 `.env.example`, 숨김 입력 관리자 비밀번호 hash CLI와 256비트 secret 생성 CLI를 만든다.
- 선행 조건: T-001.
- 산출물: package manifest와 lockfile, 서버/클라이언트/shared 디렉터리, 테스트 설정, 실제 개발 명령이 기록된 README.
- 완료 조건: 깨끗한 설치 후 lint, typecheck, 빈 테스트 suite, production build가 성공하고 비밀값 누락 시 안전한 오류로 종료한다. CLI가 원문 비밀번호를 인자·환경변수·로그에 남기지 않으며 secret 출력 형식 검증이 통과한다.
- 검증: 2026-08-25 `pnpm lint`, `pnpm typecheck`, `pnpm test`(9개), `pnpm build`, `pnpm test:e2e`(Chromium 1개) 통과. 서버 빌드 target은 Node.js 24다.

## [x] T-003 SQLite 스키마와 마이그레이션 기반 구현

- 범위: 연결, 캘린더, 이벤트, 공유, 허용 캘린더, 세션, watch 채널, sync 작업 테이블과 인덱스·제약을 구현한다.
- 선행 조건: T-002.
- 산출물: Drizzle schema, 최초 SQL migration, DB 초기화와 테스트 fixture.
- 완료 조건: 빈 DB migration, 재실행, foreign key/고유키/시간 경계 통합 테스트가 통과하고 migration 파일이 추적된다.
- 검증: 2026-08-25 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(17개), `pnpm build` 통과. 빈 DB migration 재실행, foreign key, event/token 고유키, 일정·공유·세션 시간 경계, private 상세 차단, 활성 sync job dedupe를 실제 SQLite에서 검증했다.

## [x] T-004 관리자 인증과 보안 세션 구현

- 범위: 비밀번호 검증, 로그인 rate limit, 관리자 세션, logout, CSRF/Origin 검증, 보호된 `/admin` shell을 구현한다.
- 선행 조건: T-003.
- 산출물: 인증 API와 middleware, 로그인/로그아웃 UI, 보안 테스트.
- 완료 조건: 정상·오류·만료·폐기·CSRF·반복 실패 테스트가 통과하고 쿠키 속성과 로그 redaction이 검증된다.
- 검증: 2026-08-25 `pnpm lint`, `pnpm typecheck`, `pnpm test`(30개), `pnpm build`, `pnpm test:e2e` 통과. 정상·오류 로그인, 정확한 Origin, IP별 반복 실패, HttpOnly/Secure/SameSite 쿠키, DB token hash, 30분 유휴·8시간 절대 만료, logout 폐기, session-bound CSRF와 로그 redaction을 검증했다.

## [x] T-005 Google OAuth와 동기화 수직 흐름 구현

- 범위: OAuth 연결, token 암호화, CalendarList/Events 초기 및 증분 sync, 매일 ±3개월 window 교체, 삭제/반복 일정, CalendarList/Events watch webhook, durable job, 채널 갱신과 복구 sync를 구현한다.
- 선행 조건: T-003, Google Cloud 테스트 자격 증명 또는 fake adapter 계약.
- 산출물: Google adapter, sync/watch/job 모듈, 관리자 연결 상태 API, fixture 기반 통합 테스트.
- 완료 조건: 페이지네이션, 변경·삭제, 410, 429/5xx, 중복 webhook, 채널 만료, 날짜 경계 window 이동 테스트가 통과하고 같은 이벤트가 중복 저장되지 않는다. 실패한 window 교체는 기존 snapshot을 보존한다.
- 검증: 2026-08-25 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(61개), `pnpm build`, `pnpm test:e2e`(Chromium 2개) 통과. PKCE/state/session-bound OAuth, AES-256-GCM refresh token 저장, 최소 읽기 scope, CalendarList/Events 페이지네이션·증분·삭제·중복 제거·410 복구, private 마스킹, 종일/반복 일정, ±3개월 window 원자 교체, 429/5xx backoff, durable queue, 검증된 webhook과 watch 갱신을 fake adapter로 검증했다.

## [x] T-006 공유 정책과 관리 API 구현

- 범위: 이름·`ALL`/`SELECTED` 캘린더 범위·일정 범위·접근 시간의 CRUD, token 발급/해시, 폐기, 단일 정책 평가기를 구현한다.
- 선행 조건: T-003, T-004, 승인된 공유 경계.
- 산출물: 공유 도메인 서비스, 관리자 API, 공개 token 교환 API, 정책 단위/통합 테스트.
- 완료 조건: 캘린더·날짜·접근시간 모든 경계 조합에서 허용된 이벤트만 반환되고 폐기가 다음 요청부터 즉시 적용된다. 새 캘린더는 `ALL` 공유에만 자동 포함된다.
- 검증: 2026-08-25 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(71개), `pnpm build`, `pnpm test:e2e`(Chromium 2개) 통과. 256비트 공유 token의 hash-only 저장과 1회 공개/회전, `ALL`/`SELECTED` 및 빈 allowlist, 미래 캘린더, 일정 날짜 겹침, 접근 시작 포함·종료 배타, private 대체 표시, 관리자 CRUD·미리보기, clean URL 방문자 세션, 회전·폐기 직후 차단을 실제 SQLite와 Fastify 통합 테스트로 검증했다.

## [>] T-007 방문자 캘린더 핵심 흐름 구현

- 범위: `/s/:token` 교환, clean URL, 모바일 우선 일정 목록, 넓은 화면 달력, 빈/로딩/만료/오류 상태와 SSE 갱신을 구현한다.
- 선행 조건: T-005, T-006.
- 산출물: 공개 React 화면, public events/stream API, 반응형 스타일, E2E fixture.
- 완료 조건: Kakao 인앱 브라우저 상당 viewport와 데스크톱 E2E에서 링크 열람·갱신이 동작하고 DOM에 관리자 링크가 없으며 범위 밖 데이터가 응답에 없다.

## [ ] T-008 관리자 공유 대시보드와 미리보기 구현

- 범위: 연결 상태, 공유 목록, 생성/편집/폐기, 링크 복사, 실제 정책 기반 미리보기 UI를 구현한다.
- 선행 조건: T-004, T-005, T-006, T-007의 공유 일정 컴포넌트.
- 산출물: 관리자 대시보드 화면과 폼 검증, 미리보기, E2E.
- 완료 조건: 생성→미리보기→수정→폐기 흐름이 브라우저 테스트를 통과하고 미리보기와 방문자 이벤트 집합이 일치한다.

## [ ] T-009 보안·접근성·호환성 강화

- 범위: 보안 헤더, cache/noindex/referrer 정책, proxy-aware rate limit, URL/log redaction, 키보드·대비·레이블, 모바일 WebView 호환성을 검증한다.
- 선행 조건: T-007, T-008.
- 산출물: 보안/접근성 자동 검사와 수동 점검표, 위협 모델 갱신.
- 완료 조건: 토큰/비밀값 누출 검사, 핵심 키보드 흐름, 합의된 접근성 기준, 모바일/데스크톱 브라우저 matrix가 통과한다.

## [ ] T-010 관측성, 백업과 운영 준비

- 범위: 구조화 로그, health/readiness, sync 상태, SQLite 일관 백업/복원, graceful shutdown, ARM64 native module smoke test를 구현한다.
- 선행 조건: T-005~T-009.
- 산출물: 운영 endpoint, runbook, backup/restore 스크립트와 검증 기록, 배포 환경변수 names-only 계약.
- 완료 조건: 별도 검증 DB 복원, 장애/재시작 후 queue 복구, Linux ARM64 image build와 health smoke test가 통과한다.

## [ ] T-011 Raspberry Pi 배포와 사용자 검증

- 범위: 사용자의 별도 배포 지시가 있을 때만 `deploy-project` 스킬로 이미지와 dashboard handoff를 준비하고 사용자가 제어하는 배포를 검증한다.
- 선행 조건: T-010, 공개 HTTPS origin, Google production 자격 증명, 배포 승인.
- 산출물: 배포 가능한 이미지, secrets names-only readiness, 배포/롤백 검증 기록.
- 완료 조건: 사용자 제어 배포 후 health, OAuth callback, Google webhook, 공유 링크 smoke test가 성공하고 검증된 롤백 지점이 있다.
