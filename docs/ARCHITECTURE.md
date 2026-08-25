# 기술 아키텍처

## 1. 상태

- 상태: T-010 관측성·백업·Linux ARM64 운영 준비 완료, 실제 Raspberry Pi 배포는 후속 작업
- 작성일: 2026-08-25
- 전제: 단일 관리자, 단일 Raspberry Pi 인스턴스, SQLite 영속 볼륨
- 승인된 제약과 제안 선택은 `docs/DECISIONS.md`에서 구분한다.

## 2. 선택한 기술 스택과 선택 이유

| 영역 | 제안 | 이유 |
| --- | --- | --- |
| 런타임 | Node.js 24 LTS, TypeScript strict | ARM64 지원과 단일 언어, 운영 지원 기간 |
| HTTP 서버 | Fastify | API, 정적 자산, SSE, 앱 내 동기화 스케줄러를 단일 프로세스로 운영하기 단순함 |
| 웹 UI | React + Vite | 관리자 폼과 반응형 캘린더 UI를 컴포넌트로 공유하고 정적 자산으로 빌드 가능 |
| 데이터 | SQLite WAL + Drizzle ORM + `better-sqlite3` | 브리프 제약을 지키면서 타입 스키마와 추적 가능한 SQL 마이그레이션 제공 |
| 검증 | Vitest, React Testing Library, Fastify inject, Playwright | 정책 로직부터 실제 브라우저 흐름까지 계층별 검증 |
| 패키지 | pnpm | 단일 lockfile과 재현 가능한 설치 |
| 배포 | 단일 Linux ARM64 이미지 + HTTPS reverse proxy + 영속 볼륨 | Raspberry Pi에서 운영 요소와 장애 지점을 최소화 |

Node.js 공식 정책은 프로덕션에 LTS 라인을 권장한다. Fastify는 TypeScript와 Node HTTP 서버를 직접 지원하고, Vite는 백엔드와 결합한 정적 자산 빌드를 지원한다. SQLite WAL은 같은 머신에서 읽기와 쓰기의 동시성을 개선하지만 writer는 하나이므로 단일 프로세스 모델과 잘 맞는다.

근거 자료:

- [Node.js 릴리스 정책](https://nodejs.org/en/about/previous-releases)
- [Fastify TypeScript 문서](https://fastify.dev/docs/latest/Reference/TypeScript/)
- [Vite 백엔드 통합](https://vite.dev/guide/backend-integration.html)
- [SQLite WAL](https://www.sqlite.org/wal.html)
- [Drizzle SQLite 지원](https://orm.drizzle.team/docs/get-started-sqlite-new)

현재 데이터 계층은 Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, `better-sqlite3` 13.0.3으로 구현하고 lockfile에 고정했다. `better-sqlite3`의 Linux ARM64 네이티브 바이너리는 목표 Raspberry Pi 이미지에서 빌드·실행 검증한다. 실패하면 SQLite 계약을 유지한 채 드라이버를 재평가한다.

## 3. 시스템 구성과 데이터 흐름

```text
관리자/방문자 브라우저
        |
     HTTPS
        v
Reverse proxy (TLS, 요청 제한)
        |
        v
Fastify 단일 프로세스
  +-- React/Vite 정적 자산
  +-- /api/v1/admin/*  관리자 API
  +-- /#share=:token   client가 fragment 제거 후 방문자 세션 교환
  +-- /s/:token        기존 공유 링크 호환 교환
  +-- /api/v1/public/* 방문자 API + SSE
  +-- /api/v1/google/webhook
  +-- 동기화/채널 갱신 스케줄러
        |                  |
        v                  v
 SQLite WAL          Google OAuth/Calendar API
 (영속 로컬 볼륨)     (HTTPS)
```

### Google에서 방문자 화면까지

1. OAuth 연결 후 `CalendarList`와 `Asia/Seoul` 오늘 기준 과거 3개월부터 미래 3개월까지의 각 캘린더 Events를 전체 동기화하고 `nextSyncToken`을 저장한다.
2. CalendarList와 캘린더별 Events watch 채널을 만들고 공개 HTTPS webhook을 등록한다.
3. webhook은 채널 ID와 비밀 token을 검증한 뒤 SQLite 작업 큐에 증분 동기화를 중복 없이 등록하고 빠르게 2xx를 반환한다.
4. 프로세스 내 worker가 저장된 sync token으로 변경분과 삭제분을 반영한다. Google 알림에는 변경 본문이 없으므로 알림 자체를 데이터로 신뢰하지 않는다.
5. 커밋 후 해당 공유를 보고 있는 SSE 연결에 갱신 신호를 보내고 브라우저가 정책 필터된 API를 다시 조회한다.
6. 주기적 복구 작업이 알림 누락을 보완하고 채널을 만료 전에 갱신한다. Google이 sync token에 410을 반환하면 해당 캘린더를 트랜잭션 방식으로 전체 재동기화한다.
7. 매일 날짜 경계 이후 현재 ±3개월 구간으로 전체 window sync를 수행해 새 `nextSyncToken`으로 교체한다. 새 구간이 완전히 커밋된 뒤에만 범위 밖 이벤트를 제거한다. Google은 `syncToken`과 `timeMin`/`timeMax`의 동시 사용을 허용하지 않으므로 webhook 증분 요청에는 시간 필터를 다시 보내지 않는다.

Google 계약 근거:

- [증분 동기화](https://developers.google.com/workspace/calendar/api/guides/sync)
- [Push notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- [OAuth 2.0 Web Server 흐름](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Events list의 syncToken 제약](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)

## 4. 주요 모듈과 책임

- `config`: 환경변수 스키마 검증. 누락된 필수 비밀값이 있으면 fail fast한다.
- `db`: SQLite 연결, WAL/foreign key/busy timeout 설정, 마이그레이션, 트랜잭션.
- `auth/admin`: 비밀번호 검증, 로그인 속도 제한, 관리자 세션 생성·폐기, CSRF 방어.
- `auth/share`: 원문 공유 토큰 해시 조회, fragment POST 또는 레거시 경로 교환, 접근 시간 검증, 제한된 방문자 세션 발급.
- `google/oauth`: authorization URL, callback state 검증, refresh token 암호화 저장·회전.
- `google/sync`: 전체/증분 동기화, 페이지네이션, 410 재동기화, 삭제와 반복 일정 처리.
- `google/watch`: 채널 생성·검증·갱신·중지와 webhook 처리.
- `shares`: 공유 CRUD, 허용 캘린더와 날짜/시간 정책 검증, 미리보기.
- `events/read-model`: 관리자 미리보기와 방문자 API가 함께 쓰는 단일 정책 평가 쿼리.
- `jobs`: SQLite 기반 durable 작업 큐, 중복 제거, 지수 backoff와 jitter, dead-letter 상태.
- `realtime`: 동기화 완료 신호용 SSE. 데이터 자체는 다시 권한 검증한 API로 조회한다.
- `ui/admin`: Google 연결 상태, 공유 목록·편집·미리보기. 직접 입력한 `/admin` 경로에서만 진입한다.
- `ui/public`: 목록·주간·월간 보기와 공통 기간 탐색. 모바일은 목록, 넓은 화면은 월간을 기본으로 한다. 주간은 월–일×24시간 시간표로 시간당 34px을 사용해 timed 일정을 서울 시간의 분 단위 위치에 놓고 겹침 lane을 계산하며, 종일·시간 미정 일정은 별도 행에 둔다. 7개 요일 열은 가용 폭을 균등 분할해 최소 320px에서도 가로 오버플로 없이 표시한다. 주간·월간 일정 버튼은 제목 아래 장소를 압축 표시하고 공통 상세 대화상자에서 날짜·시간·장소·일반 텍스트 설명을 제공한다. 월간 날짜 버튼은 일정 버튼과 분리하며 같은 컴포넌트 상태의 주간 기준일을 바꾼다. 관리자 탐색 요소를 import하지 않는다.
- `observability`: 구조화 로그, request ID, 상태/준비 확인, 동기화 메트릭.

초기 구현은 하나의 저장소와 package manifest를 사용하되 서버, 클라이언트, 공유 타입의 디렉터리 경계를 둔다. 별도 워크스페이스나 마이크로서비스는 만들지 않는다.

## 5. 데이터 모델

구현 테이블은 다음과 같다. TypeScript 스키마는 `src/server/db/schema.ts`, 추적되는 최초 migration은 `drizzle/0000_initial_schema.sql`이다.

- `google_connections`: 단일 연결, 암호화 refresh token, scopes, 연결/오류 상태.
- `calendars`: Google ID, 이름, 색상, 시간대, 선택 가능/삭제 상태, sync token, 동기화 시각.
- `events`: `(calendar_id, google_event_id)` 고유키, 상태, 시작/종료 또는 종일 날짜, 원본 시간대, 반복 연결, visibility, 제목, 장소, 일반 텍스트 설명, etag/updated. 참석자·주최자 연락처·첨부·회의 정보와 원문 payload는 저장하지 않는다.
- `share_links`: ID, 이름, `calendar_scope` (`ALL`/`SELECTED`), token hash 고유키와 파생 버전, `event_date_scope` (`ALL`/`SELECTED`)와 선택 날짜 범위, 접근 시간 범위, 폐기 시각, 생성/수정 시각. 기존 행은 token 버전이 `NULL`이라 링크 교환은 유지하되 관리자 재표시는 회전 뒤 가능하다.
- `share_calendars`: `SELECTED` 공유의 `(share_id, calendar_id)` 허용 목록. `ALL` 공유는 이 목록 대신 조회 시 활성 캘린더 전체를 사용하므로 새 캘린더도 자동 포함한다.
- `admin_sessions`: token hash, 만료, 마지막 사용, 폐기 시각.
- `visitor_sessions`: 공유 token 교환 뒤 사용하는 token hash, 연결된 공유, 만료, 마지막 사용, 폐기 시각.
- `watch_channels`: channel ID, resource ID, 검증 token hash/암호문, 만료, 캘린더 연결.
- `sync_jobs`: 종류, dedupe key, 상태, 시도 횟수, 다음 시도 시각, 마지막 오류 분류.

모든 외래키를 활성화한다. 이벤트 조회에는 캘린더와 시간 구간 복합 인덱스, 세션·공유에는 token hash 고유 인덱스를 둔다. `private` 이벤트의 제목·장소·설명 저장 금지, timed/all-day 경계, 공유 날짜·접근 시각, 세션 만료, watch 대상 종류는 SQLite check constraint로도 강제한다. sync 작업의 dedupe key는 `PENDING`/`RUNNING`/`RETRY` 상태에만 유일하도록 partial index를 사용한다. 서버 시작 시 foreign key, WAL, 5초 busy timeout, `synchronous=FULL`을 설정하고 추적된 migration을 재실행 가능하게 적용한다. 프로덕션에서 schema push를 사용하지 않는다.

## 6. API 및 외부 연동 계약

초기 HTTP 계약은 `/api/v1` 아래 JSON API로 둔다.

| 경로군 | 책임 | 인증 |
| --- | --- | --- |
| `POST/DELETE /api/v1/admin/session` | 로그인/로그아웃 | 로그인은 공개+rate limit, 로그아웃은 관리자 세션 |
| `/api/v1/admin/google/*` | Google 연결, callback, 상태, 수동 복구 등록과 작업 결과 조회 | 관리자 세션; callback은 OAuth state |
| `/api/v1/admin/shares/*` | 공유 CRUD와 미리보기 | 관리자 세션 + CSRF |
| `POST /api/v1/public/session` | fragment에서 꺼낸 토큰 검증, 방문자 세션 설정, share ID 반환 | exact Origin + JSON 원문 토큰 |
| `GET /s/:token` | 기존 링크 토큰 검증, 방문자 세션 설정, clean URL redirect | 레거시 원문 토큰 |
| `/api/v1/public/events` | 허용된 일정만 조회 | 방문자 세션 + 매 요청 정책 검증 |
| `/api/v1/public/stream` | 데이터 없는 갱신 신호 | 방문자 세션 + 매 연결 정책 검증 |
| `POST /api/v1/google/webhook` | Google 알림 검증·작업 등록 | Google 채널 헤더 + 저장된 채널 token |
| `GET /health/live`, `GET /health/ready` | 프로세스/DB 준비 상태 | 민감정보 없는 제한 응답 |
| `GET /api/v1/admin/operations` | sync lag/error, queue, watch 만료, 최근 공개 API latency | 관리자 세션 |

요청·응답 스키마는 공유 TypeScript 스키마에서 생성하고 런타임 검증한다. 오류는 안정된 코드와 request ID만 반환하며 내부 예외, SQL, Google 응답 원문을 노출하지 않는다. Public API는 동일 origin만 제공하고 범용 CORS를 열지 않는다.

## 7. 인증과 권한

### 관리자

- 관리자는 한 명이다. `pnpm admin:hash-password` CLI가 비밀번호를 숨김 입력·확인하고 encoded scrypt verifier만 출력한다. 사용자가 이 값을 deployd 대시보드의 `ADMIN_PASSWORD_HASH` secret으로 등록하면 런타임 환경변수로 주입된다. 원문 비밀번호를 인자나 환경변수로 전달하지 않는다.
- 로그인 성공 시 256비트 난수 세션을 발급하고 DB에는 SHA-256 hash만 저장한다. 유휴 30분과 절대 8시간 만료를 서버에서 검사하고 logout·만료 시 DB row를 폐기한다.
- 관리자 쿠키는 운영에서 Secure/HttpOnly/SameSite=Lax/Path=/이며, 로컬 HTTP 개발에서만 Secure를 끈다.
- 로그인과 상태 변경은 정확한 `APP_BASE_URL` Origin을 요구한다. 인증 후 상태 변경은 세션 ID에 HMAC으로 결합해 JSON으로 전달한 token을 `X-CSRF-Token` header로 되돌려 받아 함께 검증한다.
- 로그인 실패는 프로세스 메모리에서 client IP별 15분 window에 5회로 제한한다. Fastify는 `TRUST_PROXY`에 적힌 바로 앞 proxy IP/CIDR만 신뢰하며 `request.ip`로 전달된 실제 client를 구분한다. reverse proxy는 앱 포트의 직접 접근을 막고 `X-Forwarded-For`를 정규화하며 별도 외곽 rate limit도 적용한다.

### 방문자

- 새 공유 링크 원문 토큰은 별도 256비트 `SHARE_LINK_SECRET`과 공유 ID·양의 버전을 HMAC-SHA-256에 넣어 256비트로 파생한다. DB에는 SHA-256 hash와 버전만 저장하고 상수 시간 비교를 사용한다.
- 새 URL은 `/#share=:token`이다. fragment는 첫 HTTP 요청과 Referer에 포함되지 않으며 client bootstrap이 render 전에 제거한다. 이후 exact-origin `POST /api/v1/public/session`으로 교환해 `/share/:publicId`로 정리한다. `/s/:token`은 기존 배포 링크 호환을 위해 같은 교환 정책으로 유지한다.
- 검증 성공 시 share ID와 만료를 가진 서버 저장형 HttpOnly 세션을 설정한다. 세션은 30분 유휴·12시간 절대 만료이며 접근 종료가 더 빠르면 서버 만료도 그 시각으로 제한한다.
- 이후 모든 조회는 세션 서명뿐 아니라 현재 공유 row의 폐기/시간/캘린더/일정 범위를 다시 확인한다. 링크 폐기는 즉시 효력을 갖는다.
- 관리자는 인증된 공유 목록에서 현재 token 버전과 `SHARE_LINK_SECRET`으로 재구성된 주소를 다시 확인한다. 링크 회전은 버전을 올리고 token hash를 교체하며 해당 공유의 기존 방문자 세션을 모두 폐기한다.
- URL fragment는 브라우저 기록에서 즉시 제거하고 `/s/:token` 같은 레거시 경로, request body, access log, analytics에서 원문 토큰이 남지 않도록 reverse proxy와 앱 로깅을 redaction한다.
- 모든 동적·HTML 응답은 `no-store`, fingerprint `/assets/*`만 1년 immutable cache를 사용한다. CSP의 script는 same-origin으로 제한하고 frame·object·권한 API를 차단하며 `no-referrer`, `nosniff`, `noindex`를 전역 적용한다. HSTS는 TLS가 보장되는 운영에서만 활성화한다.

### Google

- OAuth state와 PKCE를 사용하고 `calendar.calendarlist.readonly`, `calendar.events.readonly` 두 read-only scope만 요청한다.
- refresh token은 별도 환경 키로 인증 암호화해 SQLite에 저장한다. access token은 메모리에만 두고 만료 시 갱신한다.
- webhook은 channel ID/resource ID/token을 저장값과 대조하지만 알림을 권한 판단이나 이벤트 데이터로 사용하지 않는다.

## 8. 오류 처리와 관측성

- 오류 분류: 사용자 입력 4xx, 인증/권한 401·403, 만료/폐기 공개 오류, Google rate limit/일시 오류, 영구 OAuth 오류, DB 오류.
- Google 429/5xx는 지수 backoff와 jitter로 재시도한다. 인증 취소나 권한 부족은 자동 무한 재시도하지 않고 관리자 화면에 조치 상태를 표시한다.
- 동기화 작업은 dedupe key와 트랜잭션 upsert로 멱등성을 보장한다.
- 수동 복구 동기화 등록은 새 작업 또는 이미 활성인 작업 ID를 반환한다. 관리자 UI는 인증된 상태 endpoint를 polling해 대기·진행·재시도·성공·실패 결과를 표시한다.
- 구조화 로그 필드: timestamp, level, request_id/job_id, route template, result, duration, safe error code. 토큰·이벤트 상세·비밀번호는 제외한다.
- 최소 지표: 마지막 성공 동기화, 캘린더별 lag, queue depth, 실패 횟수, watch 만료까지 남은 시간, 공개 API latency.
- readiness는 DB 읽기/쓰기 가능성과 마이그레이션 상태를 확인하되 Google 장애만으로 프로세스를 재시작 루프에 넣지 않는다.
- latency는 외부 서비스 없이 프로세스별 최근 route 표본 512개만 보존한다. 운영 상태 API는 관리자 인증 뒤 제공하고 Google ID·캘린더 이름·이벤트 상세를 포함하지 않는다.
- SIGTERM/SIGINT는 HTTP와 scheduler tick을 중단하고 실행 중 worker를 기다린 뒤 SQLite를 닫는다. 시작 시 남은 모든 `RUNNING` job은 즉시 `RETRY`로 복구한다.

## 9. 테스트 전략

- 단위: 날짜/시간 경계, 종일·시간대, 공유 정책, token hash, 오류 분류, backoff.
- DB 통합: 마이그레이션, 외래키, 허용 목록, 이벤트 upsert/delete, sync token 410 교체, 작업 dedupe.
- HTTP 통합: Fastify inject로 관리자 인증/CSRF/rate limit, 토큰 교환, 공개 응답 필터, webhook 헤더 검증.
- Google 계약: 실제 네트워크 대신 기록된 최소 fixture와 fake client로 페이지네이션, 변경·삭제, 410/429/5xx를 재현한다. 별도 테스트 Google 프로젝트로 제한된 smoke test를 둔다.
- UI: axe WCAG A/AA 자동 검사, 키보드 로그인·공유 편집·보기 전환·주/월 탐색·상세 대화상자, 월간 날짜→주간 전환, 24시간 timed 위치와 월–일 순서, 빈/로딩/만료/오류 상태, 모바일/데스크톱 레이아웃.
- E2E: 로그인→Google 연결 stub→공유 생성→미리보기→링크 방문→폐기, 관리자 링크 부재를 Chromium과 WebKit으로 확인한다. Galaxy S9+ viewport·touch·KakaoTalk형 user-agent와 EventSource 부재로 Android WebView fallback을 별도 검증한다.
- 배포 검증: Linux ARM64 이미지에서 네이티브 SQLite driver load, 마이그레이션, health, 백업/복원 smoke test.

## 10. 로컬 개발 환경

- Node.js 24 LTS, pnpm, Git이 필요하다. Google 실계정 없이 대부분의 흐름을 실행할 fake adapter를 제공한다.
- 제안 디렉터리: `src/server`, `src/client`, `src/shared`, `drizzle`, `tests`, `data`.
- 개발 시 Vite dev server는 `http://localhost:8464`에서 `http://127.0.0.1:8465`의 Fastify API로 proxy하고, 프로덕션에서는 Fastify가 Vite 빌드 결과를 같은 origin으로 제공한다.
- deployd가 제공하는 예약 환경변수는 `APP_BASE_URL`, `STORAGE_DIR`, `NODE_ENV`, `HOST`, `PORT`다. 프로덕션 origin은 `APP_BASE_URL=https://calendar.app.hurdoo.kr`, SQLite 경로는 `${STORAGE_DIR}/calendar-share.db`에서 파생하며 `deploy.json`에서 이 키들을 재선언하지 않는다.
- reviewable visible environment는 `APP_TIME_ZONE=Asia/Seoul`, `LOG_LEVEL=info`, 바로 앞 reverse proxy allowlist인 `TRUST_PROXY`다.
- names-only 필수 secret 계약은 `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `SHARE_LINK_SECRET`이다. 실제 값은 저장소, handoff JSON, 로그, 명령 인자에 넣지 않고 사용자가 deployd 대시보드 **Secrets**에 직접 입력한다.
- 로컬 개발의 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`은 사용자가 관리하는 gitignored `.env.local`에서 애플리케이션만 로드한다. Codex는 파일 내용을 열거나 출력·검색·복사하지 않는다.
- OAuth callback은 프로덕션에서 `${APP_BASE_URL}/api/v1/admin/google/callback`, 로컬 개발에서 `http://localhost:8464/api/v1/admin/google/callback`을 사용한다. Calendar webhook은 공개 HTTPS가 필요한 `${APP_BASE_URL}/api/v1/google/webhook`만 사용한다.
- 구현 작업에서 숨김 입력을 사용하는 `admin:hash-password`와 256비트 `SESSION_SECRET`/`GOOGLE_TOKEN_ENCRYPTION_KEY`/`SHARE_LINK_SECRET` 생성 CLI, 빈 `.env.example`, 런타임 검증 스키마를 함께 만든다. 각 용도의 secret은 `pnpm secret:generate`를 따로 실행해 재사용하지 않는다. Codex는 생성된 실제 값을 읽거나 대신 등록하지 않는다.
- 실행 명령은 package scripts가 실제로 생성된 뒤 README에 기록한다.

## 11. 배포와 롤백

- 공개 배포는 별도 요청을 받은 뒤 `deploy-project` 스킬로만 진행한다. 사용자가 기본 프로젝트 폴더명 대신 명시적으로 선택한 앱 ID는 `calendar`, 공개 origin은 `https://calendar.app.hurdoo.kr`로 확정한다.
- 단일 Linux ARM64 이미지가 Fastify 프로세스를 실행하고, reverse proxy가 TLS 종료·rate limit·본문 크기 제한을 담당한다.
- SQLite DB와 안전한 백업은 이미지 밖의 같은 호스트 영속 볼륨에 둔다. WAL은 네트워크 파일시스템에 두지 않는다.
- Google webhook과 OAuth callback은 위 공개 HTTPS origin의 고정 경로를 사용한다. wildcard DNS는 deploy-project 플랫폼이 제공하며 앱별 DNS를 별도로 만들지 않는다.
- 배포 전 마이그레이션 호환성과 SQLite 온라인 백업을 확인한다. 롤백은 먼저 이전 앱 이미지가 현재 스키마와 호환되는지 확인한다.
- 온라인 backup은 checksum, SQLite integrity/foreign key, migration 개수를 검증하고 mode 0600으로 저장한다. restore는 같은 검증 뒤 존재하지 않는 별도 DB만 만들며 live DB를 덮어쓰지 않는다.
- runtime 이미지는 비루트 `node`, read-only root, `/tmp` tmpfs, capability drop, `no-new-privileges`, writable `/data`를 전제로 한다. base는 Node.js 24.19.0 ARM64 digest, package manager는 pnpm 11.12.0으로 고정한다.
- 비호환 스키마 롤백은 서비스를 중지하고 승인된 복구 지점으로 복원해야 하므로 자동 수행하지 않는다.

## 12. 알려진 위험과 대안

- **Google 알림은 변경 본문과 전송 SLA를 제공하지 않음:** 증분 sync와 5분 복구 sync를 결합한다. 대안은 짧은 polling이지만 quota와 비용이 증가한다.
- **watch 채널 만료/순서 비연속:** 만료 전 갱신, message number를 신뢰한 이벤트 재구성 금지, 주기적 상태 확인으로 보완한다.
- **공유 링크 전달 가능:** 고엔트로피·만료·즉시 폐기·rate limit으로 완화한다. 방문자 신원 보증이 필요하면 계정/OTP가 필요해 MVP 범위를 바꾼다.
- **이벤트 상세 개인정보:** 일반 일정은 제목·날짜/시간·장소·설명만 저장·표시하고 `private` 일정은 상세를 마스킹한다. 설명은 HTML로 신뢰하지 않고 일반 텍스트로 처리한다.
- **이동식 3개월 동기화 구간:** `syncToken` 요청과 시간 필터를 함께 보낼 수 없으므로 일상 변경은 증분 sync, 날짜 경계 이동은 새 범위 전체 sync로 분리한다. 전체 sync 실패 시 기존 성공 snapshot을 유지한다.
- **SQLite 단일 writer:** 개인용 단일 인스턴스에는 적합하나 부하 측정이 필요하다. 다중 인스턴스가 필요해지면 PostgreSQL과 외부 queue가 대안이다.
- **ARM64 네이티브 모듈:** 목표 이미지에서 조기 smoke test한다. 호환 문제 시 `node:sqlite`의 안정성 상태 또는 다른 유지보수 드라이버를 재검토한다.
- **프로세스 내 worker:** 단일 인스턴스에는 단순하지만 프로세스 중단 중 webhook을 놓칠 수 있다. 재시작 시 복구 sync와 durable queue로 보완한다. 규모가 커지면 별도 worker가 대안이다.
- **고정 origin 의존:** Google callback과 webhook 때문에 도메인 변경 시 Google 설정과 watch 채널을 함께 갱신해야 한다.
