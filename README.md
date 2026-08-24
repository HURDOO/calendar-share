# 캘공

내 Google 캘린더 일정을 사람별로 정한 범위와 기간만큼 안전하게 공유하는 개인용 서비스입니다.

> 현재 상태: T-005 Google OAuth와 일정 동기화 완료. 다음 작업은 공유 정책과 관리 API입니다.

관리자는 비밀번호로 보호된 대시보드에서 공유 링크와 공개 범위를 관리합니다. 방문자는 전달받은 링크를 열어 허용된 캘린더와 기간의 일정만 확인합니다.

## 문서 지도

- `PROJECT_BRIEF.md`: 사용자가 작성한 원본 브리프
- `docs/SPEC.md`: 제품 요구사항과 완료 조건
- `docs/ARCHITECTURE.md`: 제안 기술 구조와 운영 설계
- `docs/TASKS.md`: 구현 순서와 검증 조건
- `docs/DECISIONS.md`: 승인되었거나 제안된 주요 결정

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
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google Cloud OAuth Web application client 값

관리자 화면은 공개 화면에 링크하지 않으며 주소창에서 `/admin`으로 직접 들어갑니다.

## 검증 명령

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## 데이터베이스와 마이그레이션

개발과 운영 서버는 시작할 때 `${STORAGE_DIR}/calendar-share.db`를 열고 추적된 SQL 마이그레이션을 자동 적용합니다. 파일 DB에는 foreign key, WAL, 5초 busy timeout, `synchronous=FULL`을 설정합니다.

스키마를 변경할 때는 기존 migration을 수정하지 않고 새 migration을 생성·검사합니다.

```bash
pnpm db:generate
pnpm db:check
```

테스트는 실제 migration을 적용한 격리된 in-memory SQLite fixture를 사용합니다.

## 비밀값 CLI

다음 명령은 민감한 결과를 터미널에 출력하므로 사용자가 직접 실행하고 결과를 채팅이나 Git에 남기지 않습니다.

```bash
pnpm admin:hash-password
pnpm secret:generate
```

`admin:hash-password`는 TTY 숨김 입력으로 12자 이상의 비밀번호를 두 번 받고 scrypt verifier를 출력합니다. `secret:generate`는 `SESSION_SECRET`과 `GOOGLE_TOKEN_ENCRYPTION_KEY`에 사용할 256비트 값을 한 번에 하나씩 출력합니다.

## 관리자 인증 보안 계약

- 서버 저장형 세션의 원문 token은 `HttpOnly`, `SameSite=Lax` 쿠키에만 두고 DB에는 SHA-256 hash만 저장합니다.
- 운영 HTTPS에서는 `Secure` 쿠키를 사용하며 로컬 HTTP 개발에서만 `Secure`를 끕니다.
- 유휴 만료는 30분, 절대 만료는 8시간이며 서버에서 강제합니다.
- 로그인과 로그아웃은 정확한 Origin을 검사하고, 인증 후 상태 변경은 세션에 결합된 `X-CSRF-Token`도 요구합니다.
- 로그인 실패는 클라이언트 주소별 15분 동안 5회까지만 허용합니다.

## Google Calendar 동기화 계약

- OAuth는 CalendarList와 Events의 읽기 전용 scope만 요청하며 PKCE, 일회용 state, 관리자 세션 결합을 검증합니다.
- refresh token은 `GOOGLE_TOKEN_ENCRYPTION_KEY`를 사용하는 AES-256-GCM 암호문으로만 DB에 저장하고 access token은 영속 저장하지 않습니다.
- 초기 동기화는 `Asia/Seoul` 오늘 기준 앞뒤 3개월이며, 이후 sync token 변경분과 삭제를 반영합니다. 410 응답은 같은 작업에서 전체 동기화로 복구합니다.
- Google webhook은 검증된 채널의 변경 힌트로만 사용합니다. 실제 일정은 durable SQLite queue와 API 재조회로 반영하며 5분 복구 sync와 만료 전 채널 갱신을 함께 사용합니다.
- 로컬 HTTP에서는 watch가 비활성화되고 복구 sync가 변경을 보완합니다. 운영 watch endpoint는 `https://calendar.app.hurdoo.kr/api/v1/google/webhook`입니다.
