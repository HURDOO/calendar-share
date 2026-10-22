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
- 후속 변경: 2026-08-25 사용자 결정으로 관리자 비밀번호 생성 CLI의 최소 길이를 Unicode 문자 기준 8자로 변경했다. `pnpm lint`, `pnpm typecheck`, `pnpm test`(89개), `pnpm build`가 통과했고 정확히 8자 허용·7자 거부·확인 불일치를 자동 검증했다.

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

## [x] T-007 방문자 캘린더 핵심 흐름 구현

- 범위: `/s/:token` 교환, clean URL, 모바일 우선 일정 목록, 넓은 화면 달력, 빈/로딩/만료/오류 상태와 SSE 갱신을 구현한다.
- 선행 조건: T-005, T-006.
- 산출물: 공개 React 화면, public events/stream API, 반응형 스타일, E2E fixture.
- 완료 조건: Kakao 인앱 브라우저 상당 viewport와 데스크톱 E2E에서 링크 열람·갱신이 동작하고 DOM에 관리자 링크가 없으며 범위 밖 데이터가 응답에 없다.
- 검증: 2026-08-25 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(79개), `pnpm build`, `pnpm test:e2e`(Chromium 4개) 통과. token URL의 clean redirect, 방문자 세션·공유 ID 결합, 모바일 390×844 날짜별 목록, 1280px 월간 달력, 로딩·빈·접근 불가·오류 상태, 실제 HTTP SSE 인증과 데이터 없는 갱신 신호, 성공한 Google event sync 후 refetch, 관리자 링크 부재를 검증했다.

## [x] T-008 관리자 공유 대시보드와 미리보기 구현

- 범위: 연결 상태, 공유 목록, 생성/편집/폐기, 링크 복사, 실제 정책 기반 미리보기 UI를 구현한다.
- 선행 조건: T-004, T-005, T-006, T-007의 공유 일정 컴포넌트.
- 산출물: 관리자 대시보드 화면과 폼 검증, 미리보기, E2E.
- 완료 조건: 생성→미리보기→수정→폐기 흐름이 브라우저 테스트를 통과하고 미리보기와 방문자 이벤트 집합이 일치한다.
- 검증: 2026-08-25 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(80개), `pnpm build`, `pnpm test:e2e`(Chromium 5개) 통과. `ALL` 기본값과 빈 `SELECTED` 허용 목록, 공유 날짜·접근 시간 폼 검증, 생성·회전 때만 보이는 일회성 원문 링크, 복사, 실제 공개 정책 API와 방문자 일정 컴포넌트를 재사용한 미리보기, 수정·즉시 폐기·CSRF 헤더를 검증했다.

## [x] T-009 보안·접근성·호환성 강화

- 범위: 보안 헤더, cache/noindex/referrer 정책, proxy-aware rate limit, URL/log redaction, 키보드·대비·레이블, 모바일 WebView 호환성을 검증한다.
- 선행 조건: T-007, T-008.
- 산출물: 보안/접근성 자동 검사와 수동 점검표, 위협 모델 갱신.
- 완료 조건: 토큰/비밀값 누출 검사, 핵심 키보드 흐름, 합의된 접근성 기준, 모바일/데스크톱 브라우저 matrix가 통과한다.
- 검증: 2026-08-25 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(87개), `pnpm build`, `pnpm security:bundle-check`, `pnpm audit --prod` 통과. `pnpm test:e2e`는 Chromium/WebKit 21개 통과와 Android WebView 전용 WebKit 1개 의도적 skip을 기록했다. 전역 CSP·no-store/noindex/referrer/nosniff/frame/HSTS 경계, fingerprint asset cache, 64KiB body limit, 500 오류 마스킹, proxy allowlist 기반 client IP rate limit과 비신뢰 forwarded header 무시, URL·인증 필드 로그 redaction, 클라이언트 bundle secret scan, axe WCAG A/AA 위반 0건, 키보드 로그인·공유 편집·월 이동, KakaoTalk형 UA·touch viewport·EventSource/clipboard fallback을 검증했다.

## [x] T-009A 공유 링크·기간·수동 동기화 후속 보완

- 범위: 수동 복구 동기화의 실제 결과 표시, 공개 일정 날짜의 전체 데이터/선택 기간 모드, 관리자 목록의 공유 주소 재확인, 방문자 SPA 진입 수정, fragment token 링크와 레거시 링크 호환을 구현한다.
- 선행 조건: T-005~T-009, 별도 `SHARE_LINK_SECRET` 사용 결정.
- 산출물: tracked sync 상태 API와 UI, 공유 날짜 mode migration, HMAC 파생 링크와 fragment 교환 API, 관리자 지속 링크 UI, 브라우저 회귀 테스트와 결정 기록.
- 완료 조건: 새 링크가 HTTP URL에 token을 보내지 않고 `/share/:id` 달력을 열며 기존 `/s/:token`도 동작한다. 활성 주소는 관리자 화면에서 다시 복사 가능하고 전체 데이터 정책과 수동 sync terminal 결과가 표시된다.
- 검증: 2026-08-25 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(99개), `pnpm build`, `pnpm security:bundle-check` 통과. `pnpm test:e2e`는 Chromium/WebKit 21개 통과와 Android WebView 전용 WebKit 1개 의도적 skip을 기록했다. 기존 share·allowlist·visitor session 보존 migration, `ALL` 날짜 정책, HMAC token 재구성·회전, fragment 즉시 제거·POST 교환·clean URL, 레거시 `/s` 교환, 공유 주소 재표시·복사, 수동 sync 작업 추적, Vite `/s` proxy가 `/share`를 가로채지 않는 회귀를 검증했다.

## [x] T-009B 방문자 목록·주간·월간 보기

- 범위: 방문자가 목록·주간·월간 보기를 전환하고 주·월 기간을 탐색하며 선택한 보기 모드를 기기에서 기억하도록 한다.
- 선행 조건: T-007~T-009A.
- 산출물: 공통 보기 전환기, 모바일 날짜 선택형·데스크톱 7열형 주간 달력, 모바일 월간 압축 표시, 여러 날 일정 날짜 판정과 회귀 테스트.
- 완료 조건: 모바일과 데스크톱에서 세 모드가 정책 범위 안에서 동작하고 관리자 미리보기도 같은 컴포넌트와 전환을 제공한다.
- 검증: 2026-08-25 `pnpm lint`, `pnpm typecheck`, `pnpm test`(101개), `pnpm build`, `pnpm security:bundle-check`, `pnpm test:e2e` 통과. Chromium/WebKit에서 모바일 기본 목록·주간 날짜 선택·월간 압축 표시, 데스크톱 기본 월간·7열 주간·목록 전환, 선택 기억, 멀티데이 일정 표시, 키보드 보기 전환, SSE 후 현재 보기 갱신, 관리자 미리보기 전환을 검증했다.

## [x] T-009C 주간 시간표와 월간 날짜 연계 보완

- 범위: 기존 카드형 주간 보기를 월–일×24시간 시간표로 교체하고 월간 일정명과 날짜→주간 전환을 제공한다.
- 선행 조건: T-009B와 사용자 주간 보기 피드백.
- 산출물: 분 단위 timed 일정 배치와 겹침 lane, 종일·시간 미정 행, 모바일 가로 스크롤, 클릭 가능한 월간 날짜 셀, 단위·브라우저 회귀 테스트.
- 완료 조건: 모든 화면에서 월–일과 00:00–24:00 축이 보이고 일정이 실제 시간 위치에 놓인다. 월간 일정 이름이 표시되고 날짜 선택 시 해당 주간이 열린다.
- 검증: 2026-08-25 `pnpm lint`, `pnpm typecheck`, `pnpm test`(103개), `pnpm build`, `pnpm security:bundle-check`, `pnpm test:e2e` 통과. 월–일 순서, 18:00 일정의 분 단위 위치, 24:00 경계, 멀티데이 종일 행, 월간 일정명·날짜 전환, 모바일 가로 스크롤, Chromium/WebKit 접근성·키보드 흐름을 검증했다.

## [x] T-009D 모바일 주간 7일 폭 맞춤

- 범위: 모바일 주간 시간표의 가로 스크롤을 제거하고 월–일 7개 열을 화면 폭에 맞춘다.
- 선행 조건: T-009C와 사용자 모바일 주간 피드백.
- 산출물: 유동 7열 CSS, 모바일 일정 제목 축약, 320px·390px 가로 오버플로 브라우저 회귀 테스트.
- 완료 조건: 최소 320px부터 주간 시간표의 7일이 모두 한 화면에 보이고 `scrollWidth`가 표시 영역을 넘지 않는다.
- 검증: 2026-08-25 `pnpm lint`, `pnpm typecheck`, `pnpm test`(103개), `pnpm build`, `pnpm security:bundle-check`, `pnpm test:e2e` 통과. Chromium/WebKit의 320px·390px에서 요일 7개, 마지막 일요일 경계와 무가로스크롤을 검증하고 320px 실화면 캡처로 일정 제목 가독성을 확인했다.

## [x] T-009E 주·월간 일정 상세 표시

- 범위: 주간·월간의 압축 일정 카드에 장소를 추가하고 일정 선택 시 승인된 필드를 공통 상세 대화상자로 표시한다.
- 선행 조건: T-009D와 사용자 일정 상세 피드백.
- 산출물: 주·월간 제목/장소 카드, 날짜·시간·장소·설명 상세 대화상자, 월간 날짜/일정 분리 동작, 키보드·접근성·브라우저 회귀 테스트.
- 완료 조건: 주간·월간에서 장소를 확인하고 일정 선택으로 상세를 열 수 있다. 월간 날짜 선택은 계속 해당 주간을 열고, 최소 320px의 7일 폭과 승인된 공개 필드 경계를 유지한다.
- 검증: 2026-08-25 `pnpm lint`, `pnpm typecheck`, `pnpm test`(103개), `pnpm build`, `pnpm security:bundle-check`, `pnpm test:e2e` 통과. Chromium/WebKit에서 주·월간 장소, 상세 열기·닫기·Escape·포커스 복원, 월간 날짜→주간 분리 동작, 320px 주간 무가로스크롤, 상세 열린 상태의 axe 위반 0건을 검증했다.

## [x] T-009F 주간 시간표 세로 밀도 보완

- 범위: 주간 24시간 시간표의 시간당 세로 간격을 기존 56px의 약 60%로 줄인다.
- 선행 조건: T-009E와 사용자 세로 간격 피드백.
- 산출물: 34px 시간 간격, 816px 24시간 격자, 일정 위치·높이와 배경 시간선 동기화, 단위·브라우저 회귀 테스트.
- 완료 조건: `00:00`부터 `24:00`까지 빈 초과 격자 없이 표시되고 timed 일정의 실제 시간 비율, 주간 7일 폭, 제목·장소 상세 동작이 유지된다.
- 검증: 2026-08-25 `pnpm lint`, `pnpm typecheck`, `pnpm test`(103개), `pnpm build`, `pnpm security:bundle-check`, `pnpm test:e2e` 통과. 18시 일정의 612px 위치, 1시간 일정의 34px 높이, 24시간 열의 816px 높이, Chromium/WebKit 320px·390px 무가로스크롤과 실제 320px 렌더링을 확인했다.

## [x] T-009G 대량 일정 탐색·상세 성능 보완

- 범위: 모바일에서 수백 개 일정을 불러올 때 목록 로딩과 주·월간 상세 열기가 느려지는 문제를 줄이고, 보기 전환 시 오늘 위치를 먼저 표시한다.
- 선행 조건: T-009F와 사용자 대량 일정 피드백.
- 산출물: 날짜별 일정 인덱스, 80개 단위 오늘 기준 목록 페이지, memoized 주·월간 렌더 경계, 실제 데이터 측정과 400개 일정 회귀 테스트.
- 완료 조건: 목록은 오늘 이후 첫 일정부터 최대 80개 카드만 DOM에 두고 이전·다음 일정을 탐색할 수 있다. 목록·주간·월간을 다시 선택하면 오늘 위치로 돌아오며, 상세 대화상자 상태 변경은 달력 전체를 다시 계산하지 않는다.
- 검증: 2026-09-02 `pnpm lint`, `pnpm typecheck`, `pnpm test`(115개), `pnpm build`, `pnpm security:bundle-check`, `pnpm test:e2e` 통과. Chromium/WebKit에서 400개 일정의 모바일 목록 DOM 80개 상한, 오늘 기준 시작·페이지 탐색·보기 전환 초기화·상세 열기와 axe 위반 0건을 검증했다. 로컬 실제 113개 일정에서는 목록 카드 113→80개, 전체 DOM node 1,097→773개로 줄었고 오늘인 9월 2일부터 표시됨을 확인했다.

## [x] T-010 관측성, 백업과 운영 준비

- 범위: 구조화 로그, health/readiness, sync 상태, SQLite 일관 백업/복원, graceful shutdown, ARM64 native module smoke test를 구현한다.
- 선행 조건: T-005~T-009.
- 산출물: 운영 endpoint, runbook, backup/restore 스크립트와 검증 기록, 배포 환경변수 names-only 계약.
- 완료 조건: 별도 검증 DB 복원, 장애/재시작 후 queue 복구, Linux ARM64 image build와 health smoke test가 통과한다.
- 검증: 2026-08-25 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(112개), `pnpm build`, `pnpm security:bundle-check`, `pnpm test:e2e` 통과. Chromium/WebKit 21개 통과와 Android WebView 전용 WebKit 1개 의도적 skip을 기록했다. 관리자 운영 상태, 민감정보 없는 HTTP/job 로그, DB read/write/migration readiness, SIGTERM worker 대기, 시작 즉시 stale queue 복구, 온라인 backup checksum·integrity·foreign key·migration 검증과 빈 대상 복원을 자동 검증했다. Node.js 24.19.0 Linux ARM64 image를 비루트·read-only root·capability drop·`no-new-privileges` 조건에서 빌드하고 native `better-sqlite3`, health/UI/API, online backup→restore, graceful exit 0, 재시작 데이터 지속성 smoke를 통과했다. 최종 로컬 image ID는 `sha256:5008fb63dab6ead186816b08ad37a9c56a66f4986ecc2ba2f095f0378776f521`이며 GHCR push와 실제 배포는 수행하지 않았다.

## [-] T-011 Raspberry Pi 배포와 사용자 검증

- 범위: 사용자의 별도 배포 지시가 있을 때만 `deploy-project` 스킬로 이미지와 dashboard handoff를 준비하고 사용자가 제어하는 배포를 검증한다.
- 선행 조건: T-010, 공개 HTTPS origin, Google production 자격 증명, 배포 승인.
- 산출물: 배포 가능한 이미지, secrets names-only readiness, 배포/롤백 검증 기록.
- 완료 조건: 사용자 제어 배포 후 health, OAuth callback, Google webhook, 공유 링크 smoke test가 성공하고 검증된 롤백 지점이 있다.
- 진행: 2026-08-26 사용자가 `@hurdoo` 저장소에 `@hurdooagent` collaborator로 push하는 방식과 public 배포 계획을 승인했다. GHCR package를 저장소에 연결하고 deployd v0.7.1에 public 앱·HTTPS route·names-only secret을 등록했다. 첫 image는 deployd가 image의 `USER node`를 capability 없는 UID 0으로 덮어쓰는 조건에서 node 소유 mode 0700/0600 Drizzle migration을 읽지 못해 중단됐다. `/app/drizzle`에 `a+rX`만 추가한 revision `9031c4d3630a396a9008bae0d3e97b0c54c5f512`와 digest `sha256:7fd388e192ca462e7615241bba75bc8ad1ae717ed218baa1b52b1f286a44b4d3`는 사용자 승인 배포 후 deployd와 공개 HTTPS readiness가 모두 200/healthy가 됐다. 공개 검증에서 정적 플러그인의 기본값이 전역 cache 정책을 가려 HTML과 fingerprint asset 모두 `public, max-age=0`인 문제가 발견되어, 플러그인의 cache header 생성을 끄고 최종 release를 준비한다.
- 검증(배포 준비): 2026-08-26 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(112개), `pnpm build`, `pnpm security:bundle-check`, `pnpm test:e2e`가 통과했다. Chromium/WebKit 21개 통과와 Android WebView 전용 WebKit 1개 의도적 skip을 기록했으며, 날짜 경과로 공유 범위 밖에 밀리던 관리자 미리보기 E2E fixture는 브라우저 시계를 기준일로 고정해 안정화했다.
- 검증(배포 권한 호환): 2026-08-26 `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(112개), `pnpm build`, `pnpm security:bundle-check`가 통과했다. 수정 Linux ARM64 image를 deployd와 같은 UID `0:0`, effective capability `0`, read-only root, capability drop, `no-new-privileges`, writable `/data` bind 조건으로 실행해 Drizzle migration 적용, readiness 200 연속 3회와 Docker health `healthy`를 확인했다. `/app/drizzle`과 `meta`는 mode 0755, `_journal.json`은 0644로 확인했다.
- 검증(첫 성공 배포): 2026-08-26 deploy job `6d1e0acd-0ee1-44ee-b709-82b8e09a3832`가 성공했다. deployd status에서 위 digest/revision이 current이고 `app.status=healthy`, `runtime.healthy=true`, HTTP 200임을 확인했으며 previous release는 아직 없다. Mac에서 공개 HTTPS `/health/ready`와 `/health/live`가 200, HSTS·CSP·`nosniff`·frame 차단·`no-referrer`·`noindex`가 적용된 것을 확인했다. HTTP endpoint는 redirect 대신 404로 닫혀 있었다.
- 검증(cache 정책 보완): 2026-08-26 실제 정적 파일을 사용하는 회귀 테스트를 추가했다. `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(113개), `pnpm build`, `pnpm security:bundle-check`가 통과했다. Linux ARM64 image를 deployd와 같은 UID `0:0`, effective capability `0`, read-only root, capability drop, `no-new-privileges`, writable `/data` bind 조건으로 실행해 Docker health `healthy`, readiness 200 연속 3회, HTML `Cache-Control: no-store`, fingerprint JavaScript `Cache-Control: public, max-age=31536000, immutable`을 확인했다. 첫 sandbox 실행의 SSE와 bundle scan은 각각 loopback/IPC listen `EPERM`으로 중단됐고 같은 명령을 권한이 있는 로컬 환경에서 재실행해 통과했다.
- 진행(Google 동기화 오류 분류): 2026-10-21 운영 관리자 화면이 재연결 뒤에도 `GOOGLE_PERMANENT`를 표시했다. adapter가 gaxios `code`만 숫자로 읽어 네트워크 오류(`ECONNREFUSED` 등, NaN)와 refresh token 만료·취소(`400 invalid_grant`)를 재시도 불가 영구 오류로 뭉뚱그린 것을 재현했다. HTTP status를 `status`/`response.status`에서 읽고, 응답 없는 네트워크·timeout은 `TRANSIENT`, OAuth `invalid_grant`/`invalid_client`/`unauthorized_client`는 `AUTH`, 403 rate limit reason은 `RATE_LIMIT`로 분류하도록 고쳤다. 남은 영구 오류는 `GOOGLE_PERMANENT_<status>_<reason>`으로 저장하고 worker 로그에 `google_status`, `google_reason`을 남긴다. 검증: `pnpm lint`, `pnpm typecheck`, `pnpm test`(120개), `pnpm build` 통과. 운영 원인 확정은 배포 뒤 새 오류 코드로 확인해야 한다.
- 진행(동기화 실패 캘린더 격리): 2026-10-22 운영 operations에서 캘린더 1개가 2026-09-02부터 `SYNC_INVALID_DATA`로 `ERROR`였고, 이 때문에 5분마다 도는 `RECOVERY_SYNC`가 전부 실패(`FAILED` 323)해 뒤 순서 캘린더 동기화와 watch 갱신이 멈춘 것을 확인했다. Google이 허용하는 0분짜리 일정(end == start)을 앱이 잘못된 데이터로 거부한 것이 가장 유력한 원인이다. 수정: migration `0003_allow_zero_duration_events`로 timed event check를 `ends_at >= starts_at`로 완화했다. 저장할 수 없는 일정 하나는 건너뛰고 증분 변경이면 예전 저장본을 지우며, 사유 code별 개수만 `skipped_events`/`skipped_event_codes`로 기록한다. `RECOVERY_SYNC`와 기간 창 재동기화는 캘린더별로 격리해 나머지 캘린더와 watch 갱신을 계속하고, 실패 캘린더만 `ERROR`로 남긴 뒤 job을 실패(일시 오류면 재시도)로 마치며 `failed_calendars`/`synced_calendars`를 기록한다. 주간 시간표와 선택 기간 조회도 0분짜리 일정을 표시한다. 결정은 DECISIONS의 2026-10-22 두 항목에 기록했다. 검증: `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`(130개), `pnpm build`, `pnpm security:bundle-check`, `pnpm test:e2e`(23 passed, 1 skipped) 통과. 0002까지 적용된 DB에 0003을 적용해 기존 행 유지, index 3개, foreign key·integrity 검사, calendar 삭제 cascade를 확인했다. 배포는 하지 않았다. 배포하면 migration이 적용되므로 직전 백업이 필요하다.
