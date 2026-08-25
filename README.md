# 캘공

내 Google 캘린더 일정을 사람별로 정한 범위와 기간만큼 안전하게 공유하는 개인용 서비스입니다.

> 현재 상태: T-011 Raspberry Pi 첫 배포와 사용자 검증 진행 중입니다.

관리자는 비밀번호로 보호된 대시보드에서 공유 링크와 공개 범위를 관리합니다. 방문자는 전달받은 링크를 열어 허용된 캘린더와 기간의 일정만 확인합니다.

## 문서 지도

- `PROJECT_BRIEF.md`: 사용자가 작성한 원본 브리프
- `docs/SPEC.md`: 제품 요구사항과 완료 조건
- `docs/ARCHITECTURE.md`: 제안 기술 구조와 운영 설계
- `docs/TASKS.md`: 구현 순서와 검증 조건
- `docs/DECISIONS.md`: 승인되었거나 제안된 주요 결정
- `docs/SECURITY.md`: 위협 모델, 보안 정책, 브라우저 검증과 실기기 점검표
- `docs/RUNBOOK.md`: 상태 확인, 백업·복원, 재시작, 배포 전 운영 절차

## 로컬 개발

Node.js 24~26과 pnpm 11이 필요합니다.

```bash
pnpm install
pnpm dev
```

- 웹: `http://localhost:8464`
- API: `http://127.0.0.1:8465`
- Google OAuth 개발 callback: `http://localhost:8464/api/v1/admin/google/callback`

로컬 비밀값은 gitignored `.env.local`에서 사용자가 직접 관리합니다. Codex는 해당 파일 내용을 읽거나 출력하지 않습니다. 키 이름 계약은 `.env.example`에만 기록합니다.

서버를 실행하려면 다음 비밀값을 먼저 준비해야 합니다.

- `ADMIN_PASSWORD_HASH`: `pnpm admin:hash-password` 출력
- `SESSION_SECRET`: `pnpm secret:generate` 출력
- `GOOGLE_TOKEN_ENCRYPTION_KEY`: `pnpm secret:generate` 출력
- `SHARE_LINK_SECRET`: 다른 용도와 재사용하지 않고 `pnpm secret:generate`로 별도 생성한 출력
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google Cloud OAuth Web application client 값

관리자 화면은 공개 화면에 링크하지 않으며 주소창에서 `/admin`으로 직접 들어갑니다.

## 검증 명령

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm security:bundle-check
```

`test:e2e`는 Chromium과 WebKit을 직렬 실행합니다. 최초 환경에는 `pnpm exec playwright install chromium webkit`으로 테스트 브라우저를 준비합니다. `security:bundle-check`는 클라이언트 빌드만 검사하며 로컬 `.env.local`을 읽지 않습니다.

## 데이터베이스와 마이그레이션

개발과 운영 서버는 시작할 때 `${STORAGE_DIR}/calendar-share.db`를 열고 추적된 SQL 마이그레이션을 자동 적용합니다. 파일 DB에는 foreign key, WAL, 5초 busy timeout, `synchronous=FULL`을 설정합니다.

스키마를 변경할 때는 기존 migration을 수정하지 않고 새 migration을 생성·검사합니다.

```bash
pnpm db:generate
pnpm db:check
```

테스트는 실제 migration을 적용한 격리된 in-memory SQLite fixture를 사용합니다.

실행 중 DB의 일관 snapshot과 checksum을 만들고, 별도 빈 DB에만 복원하려면 다음 명령을 사용합니다. restore는 기존 대상이나 WAL/SHM 동반 파일을 덮어쓰지 않습니다.

```bash
pnpm db:backup -- --source ./data/calendar-share.db
pnpm db:restore -- --backup ./data/backups/calendar-share-BACKUP.db --target ./data/verification/restored.db
```

live DB 교체는 서비스를 중지하고 복구 지점과 대상을 확인한 뒤 별도 사용자 승인이 필요한 운영 작업입니다. 자세한 절차는 `docs/RUNBOOK.md`에 있습니다.

## 비밀값 CLI

다음 명령은 민감한 결과를 터미널에 출력하므로 사용자가 직접 실행하고 결과를 채팅이나 Git에 남기지 않습니다.

```bash
pnpm admin:hash-password
pnpm secret:generate
```

`admin:hash-password`는 TTY 숨김 입력으로 8자 이상의 비밀번호를 두 번 받고 scrypt verifier를 출력합니다. `secret:generate`는 `SESSION_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `SHARE_LINK_SECRET`에 사용할 256비트 값을 한 번에 하나씩 출력합니다. 세 용도마다 명령을 따로 실행하고 값을 재사용하지 않습니다.

## 관리자 인증 보안 계약

- 서버 저장형 세션의 원문 token은 `HttpOnly`, `SameSite=Lax` 쿠키에만 두고 DB에는 SHA-256 hash만 저장합니다.
- 운영 HTTPS에서는 `Secure` 쿠키를 사용하며 로컬 HTTP 개발에서만 `Secure`를 끕니다.
- 유휴 만료는 30분, 절대 만료는 8시간이며 서버에서 강제합니다.
- 로그인과 로그아웃은 정확한 Origin을 검사하고, 인증 후 상태 변경은 세션에 결합된 `X-CSRF-Token`도 요구합니다.
- 로그인 실패는 클라이언트 주소별 15분 동안 5회까지만 허용합니다.
- `TRUST_PROXY`에는 Fastify 바로 앞 proxy의 IP/CIDR만 나열합니다. 기본값은 loopback이며 운영 proxy 주소가 다르면 배포 환경에서 명시적으로 바꿉니다.
- 동적 응답은 `no-store`, fingerprint 정적 자산만 1년 immutable cache를 사용합니다. CSP, frame 차단, MIME sniffing 차단, `no-referrer`, `noindex`를 전역 적용하고 HSTS는 운영 HTTPS에서만 보냅니다.

## Google Calendar 동기화 계약

- OAuth는 CalendarList와 Events의 읽기 전용 scope만 요청하며 PKCE, 일회용 state, 관리자 세션 결합을 검증합니다.
- refresh token은 `GOOGLE_TOKEN_ENCRYPTION_KEY`를 사용하는 AES-256-GCM 암호문으로만 DB에 저장하고 access token은 영속 저장하지 않습니다.
- 초기 동기화는 `Asia/Seoul` 오늘 기준 앞뒤 3개월이며, 이후 sync token 변경분과 삭제를 반영합니다. 410 응답은 같은 작업에서 전체 동기화로 복구합니다.
- Google webhook은 검증된 채널의 변경 힌트로만 사용합니다. 실제 일정은 durable SQLite queue와 API 재조회로 반영하며 5분 복구 sync와 만료 전 채널 갱신을 함께 사용합니다.
- 관리자 수동 동기화는 durable 작업 ID를 반환하며 화면이 대기·진행·재시도·완료 시각 또는 안전한 실패 안내까지 확인합니다.
- 로컬 HTTP에서는 watch가 비활성화되고 복구 sync가 변경을 보완합니다. 운영 watch endpoint는 `https://calendar.app.hurdoo.kr/api/v1/google/webhook`입니다.

## 공유 정책과 링크 계약

- `ALL` 공유는 조회 시점의 활성 캘린더 전체를 사용해 새 캘린더를 자동 포함합니다. 하나라도 제외한 `SELECTED` 공유는 저장된 allowlist만 사용하며 빈 선택도 허용합니다.
- 일정 날짜 `ALL`은 현재 동기화·보존된 과거 3개월부터 미래 3개월까지의 read model 전체를 제공합니다. `SELECTED`는 `Asia/Seoul` 달력 날짜의 양끝을 포함하고 일정 구간이 공유 날짜와 겹칠 때만 제공합니다. 접근 시작은 포함하고 종료는 배타적입니다.
- 새 공유 링크 token은 별도 `SHARE_LINK_SECRET`, 공유 ID와 버전으로 HMAC-SHA-256 파생합니다. DB에는 token hash와 버전만 저장하고 관리자는 활성 주소를 목록에서 다시 복사할 수 있습니다. token 회전 시 기존 링크와 방문자 세션을 즉시 폐기합니다.
- 새 주소 `/#share=:token`의 fragment는 첫 HTTP 요청에 포함되지 않으며 client가 즉시 지운 뒤 same-origin POST로 HttpOnly 방문자 세션을 만들어 `/share/:id`로 이동합니다. 기존 `/s/:token`도 호환됩니다. 세션은 30분 유휴·12시간 절대 만료이고, 모든 공개 일정 요청이 현재 공유의 폐기·접근 시간·캘린더·날짜 정책을 다시 확인합니다.
- 관리자 API는 `/api/v1/admin/shares` 아래 CRUD·폐기·token 회전·미리보기를 제공하며, 미리보기와 `/api/v1/public/events`는 같은 정책 평가기를 사용합니다.

## 방문자 화면과 실시간 갱신

- `/share/:id`는 `목록`, `주간`, `월간` 보기를 직접 전환할 수 있습니다. 모바일 기본값은 목록이고 820px 이상 화면의 기본값은 월간입니다. 주간은 모든 화면에서 월요일부터 일요일을 가로축, `00:00`부터 `24:00`를 세로축으로 쓰는 시간표이며 시간당 34px의 압축 간격과 최소 320px 화면에서도 폭에 맞는 7일 열을 사용합니다. 선택한 보기 모드만 브라우저에 기억하며 공유 ID나 일정 데이터는 저장하지 않습니다.
- 월간 셀에는 일정 이름을 표시하며 날짜 셀을 누르면 그 날짜가 포함된 주간 시간표로 전환합니다. 종일·시간 미정 일정은 주간 상단 행에, 시간이 있는 일정은 실제 시작·종료 위치에 표시합니다.
- 주간·월간 일정은 제목 아래 장소를 작게 표시합니다. 일정 카드를 누르면 날짜와 시간·장소·설명을 확인하는 상세 창이 열리며, 월간의 날짜 선택과 일정 상세 열기는 서로 구분됩니다.
- 주간과 월간은 `이전`, `오늘`, `다음` 기간 탐색을 제공하고 공유 정책 날짜 밖으로 이동하지 않습니다. 여러 날 일정은 진행되는 각 날짜에 표시됩니다.
- 로딩, 빈 일정, 접근 불가, 네트워크 오류 상태를 각각 안내합니다.
- 공개 화면에는 관리자 경로나 이동 링크가 없고, URL의 공유 ID와 방문자 세션의 정책 응답 ID가 일치할 때만 일정을 표시합니다.
- `/api/v1/public/stream`은 인증된 SSE 연결에 일정 데이터가 아닌 `changed` 신호만 보냅니다. 브라우저는 신호를 받은 뒤 정책이 다시 검증되는 events API를 조회합니다.
- 이벤트 동기화, 날짜 window 교체, 복구 sync와 공유 수정·회전·폐기가 열린 화면에 갱신 신호를 보냅니다. stream heartbeat도 현재 세션·폐기·접근 시간을 다시 확인합니다.

## 운영과 ARM64 이미지

- `/health/live`는 프로세스 생존, `/health/ready`는 DB 읽기·rollback 쓰기 probe·migration 상태를 검사합니다.
- 관리자 인증이 필요한 `/api/v1/admin/operations`는 마지막 sync, 캘린더 lag/error, queue, watch 만료, 최근 공개 API latency를 제공합니다.
- HTTP와 sync 작업은 token·일정 상세를 제외한 구조화 JSON 로그를 stdout에 기록합니다.
- SIGTERM/SIGINT는 scheduler를 멈추고 실행 중인 작업을 기다린 뒤 DB를 닫습니다. 중단돼 `RUNNING`으로 남은 작업은 다음 시작에서 즉시 `RETRY`로 복구합니다.
- `Dockerfile`과 `deploy.json`은 `calendar`, `https://calendar.app.hurdoo.kr`, `ghcr.io/hurdoo/calendar-share`, Linux ARM64, 영속 `/data`, 여섯 names-only secret 계약을 고정합니다.
- T-010에서는 로컬 ARM64 빌드와 보안·백업 smoke만 수행했으며 이미지 push와 실제 배포는 하지 않았습니다.
