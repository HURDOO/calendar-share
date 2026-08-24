# 결정 기록

## 2026-08-25: SQLite를 영속 저장소로 사용

- 상태: 승인
- 맥락: 개인용 Raspberry Pi 서비스에 관리자 설정, 공유 정책, Google 동기화 상태와 일정 read model을 저장해야 한다.
- 결정: `PROJECT_BRIEF.md`에 따라 SQLite를 사용한다. 단일 호스트 로컬 영속 볼륨과 WAL 모드를 전제로 한다.
- 고려한 대안: PostgreSQL, 외부 관리형 데이터베이스.
- 결과와 트레이드오프: 운영이 단순하고 비용이 없지만 writer가 하나이며 네트워크 파일시스템과 다중 인스턴스에는 적합하지 않다.

## 2026-08-25: Google Calendar API로 읽기 전용 연동

- 상태: 승인
- 맥락: 개인 Google 캘린더의 여러 하위 캘린더와 일정을 자동으로 가져와야 한다.
- 결정: Google OAuth 2.0과 Google Calendar API를 사용하고 캘린더 쓰기는 MVP에서 제외한다.
- 고려한 대안: iCal 내보내기/구독, 수동 입력, Google 캘린더 직접 공개.
- 결과와 트레이드오프: 공식 변경 데이터를 받을 수 있지만 Google Cloud 설정, refresh token 관리, quota와 OAuth 정책을 운영해야 한다.

## 2026-08-25: 단일 Node.js 프로세스의 모듈형 웹 애플리케이션

- 상태: 승인
- 맥락: Raspberry Pi 한 대에서 관리자 UI, 방문자 UI, API, Google webhook과 동기화 스케줄러를 운영해야 한다.
- 결정: Node.js 24 LTS, TypeScript, Fastify, React/Vite를 하나의 pnpm 프로젝트로 구성한다. Fastify가 API와 빌드된 정적 자산을 제공하고 프로세스 내 worker가 SQLite durable queue를 처리한다.
- 고려한 대안: Next.js 단일 앱, 서버와 worker 분리, Python/Django, 여러 서비스.
- 결과와 트레이드오프: 배포와 로컬 추론이 단순하고 한 언어를 공유한다. 프로세스 중단 중 webhook을 놓칠 수 있어 재시작 복구 sync가 필요하며 확장 시 worker 분리가 필요하다.

## 2026-08-25: Push notification과 증분 동기화를 결합

- 상태: 승인
- 맥락: 새 일정이 거의 실시간으로 보여야 하지만 Google push 알림에는 변경 본문이 없고 채널과 sync token은 만료될 수 있다.
- 결정: Events watch는 동기화 힌트로만 사용하고 저장한 sync token으로 증분 조회한다. 5분 복구 sync, 채널 사전 갱신, 410 전체 재동기화를 둔다.
- 고려한 대안: 1분 polling만 사용, 방문할 때마다 Google API 직접 조회.
- 결과와 트레이드오프: 일반 변경 반영이 빠르고 quota 사용이 낮다. 공개 HTTPS webhook과 갱신 스케줄러가 필요하며 Google 알림 전송 시간 자체는 보장할 수 없다.

## 2026-08-25: 공유 토큰을 제한된 방문자 세션으로 교환

- 상태: 승인
- 맥락: 링크 클릭만으로 접근해야 하지만 원문 token이 주소창, Referer, 로그에 계속 남으면 유출 위험이 커진다.
- 결정: 고엔트로피 token을 `/s/:token`에서 한 번 검증해 HttpOnly 방문자 세션으로 교환하고 clean URL로 redirect한다. DB에는 원문 token 대신 hash를 저장하고 매 요청마다 공유 상태를 다시 확인한다.
- 고려한 대안: 모든 요청의 URL에 token 유지, 방문자 계정/OTP, 일회용 링크.
- 결과와 트레이드오프: 링크 사용성은 유지하면서 노출 면을 줄이고 즉시 폐기할 수 있다. 쿠키를 사용할 수 없는 브라우저는 지원하기 어렵고 링크 전달 자체를 막지는 못한다.

## 2026-08-25: 캘린더 범위를 ALL과 SELECTED로 구분

- 상태: 승인
- 맥락: 전체 캘린더 공유에는 새 캘린더를 자동 반영하되, 하나라도 제외한 제한 공유에는 의도치 않은 새 일정이 노출되면 안 된다.
- 결정: 공유에 `ALL`/`SELECTED` 모드를 저장한다. `ALL`은 현재와 미래의 활성 캘린더 전체를 포함하고, 하나라도 제외하면 `SELECTED`가 되어 저장된 allowlist만 사용한다.
- 고려한 대안: 모든 공유를 생성 시점 allowlist snapshot으로 고정, 미래 캘린더를 모든 공유에 자동 포함.
- 결과와 트레이드오프: 가족용 전체 공유는 관리 부담이 없고 제한 공유는 안전한 기본값을 유지한다. 모드 전환과 새 캘린더 동작을 명시적으로 테스트해야 한다.

## 2026-08-25: 공개 일정 필드 제한

- 상태: 승인
- 맥락: Google 이벤트에는 방문자 공유 목적에 필요하지 않은 참석자, 연락처, 첨부, 회의 정보가 포함될 수 있다.
- 결정: 일반 일정은 제목, 날짜·시간, 장소, 설명만 저장·표시한다.
- 고려한 대안: Google 이벤트 전체 표시, 공유별 필드 선택.
- 결과와 트레이드오프: MVP와 데이터 노출 면이 단순해진다. 공유별 상세 수준은 후속 범위이며 설명은 일반 텍스트로 정규화해야 한다.

## 2026-08-25: private 일정 상세 마스킹

- 상태: 승인
- 맥락: 공개 필드 결정만으로 Google의 `private` 표시를 가진 일정 상세를 방문자에게 노출할지 확정되지 않는다.
- 결정: 개인정보 보호 기본값으로 날짜·시간과 `비공개 일정` 대체 제목만 표시하고 제목, 장소, 설명은 저장·응답하지 않는다.
- 고려한 대안: 일반 일정과 동일하게 표시, 일정 전체를 숨김, 공유별 private 표시 권한 추가.
- 결과와 트레이드오프: 의도치 않은 상세 노출을 방지한다. 사용자가 원하면 구현 전 다른 정책으로 대체할 수 있다.

## 2026-08-25: 일정 read model은 오늘 기준 앞뒤 3개월만 보존

- 상태: 승인
- 맥락: SQLite에 Google 캘린더 전체 이력을 복제할 필요가 없고 방문 목적에 가까운 일정만 필요하다.
- 결정: `Asia/Seoul` 오늘 기준 과거 3개월부터 미래 3개월까지를 이동식 sync/보존 구간으로 사용한다. 매일 새 구간의 전체 sync가 성공한 후 범위 밖 이벤트를 제거하고 삭제 tombstone은 별도 장기 보존하지 않는다.
- 고려한 대안: 전체 이력 보존, 고정 기간 보존, 방문 시 Google API 직접 조회.
- 결과와 트레이드오프: 저장량과 개인정보 노출 면이 줄어든다. `syncToken`과 시간 필터 제약 때문에 날짜 경계에서는 새 window 전체 sync가 필요하다.

## 2026-08-25: 공개 origin과 deployd 환경 계약

- 상태: 대체
- 맥락: OAuth callback과 Google webhook에 안정된 공개 HTTPS 주소가 필요하고 배포는 deploy-project 플랫폼 계약을 따라야 한다.
- 결정: 앱 ID는 `calendar-share`, 공개 origin은 `https://calendar-share.app.hurdoo.kr`다. 플랫폼 제공 `APP_BASE_URL`과 `STORAGE_DIR`를 사용하며 별도 DNS나 앱별 host path를 만들지 않는다. 로컬 OAuth callback은 Vite proxy origin인 `http://localhost:5173/api/v1/admin/google/callback`을 사용한다.
- 고려한 대안: 사용자 지정 도메인, LAN 전용 주소, 앱 자체 origin 환경변수.
- 결과와 트레이드오프: wildcard DNS와 deployd 정책을 재사용한다. Google OAuth redirect URI와 watch 채널은 origin 변경에 함께 갱신해야 한다.

## 2026-08-25: 공개 앱 ID와 origin을 calendar로 변경

- 상태: 승인
- 맥락: 사용자가 프로젝트 디렉터리명 기반 기본 주소보다 짧은 공개 주소 `calendar.app.hurdoo.kr`를 선택했다.
- 결정: deployd 앱 ID를 `calendar`, 공개 origin을 `https://calendar.app.hurdoo.kr`로 사용한다. OAuth callback은 `https://calendar.app.hurdoo.kr/api/v1/admin/google/callback`, webhook은 `https://calendar.app.hurdoo.kr/api/v1/google/webhook`이다.
- 고려한 대안: 기존 앱 ID `calendar-share`와 `https://calendar-share.app.hurdoo.kr`, 별도 사용자 지정 도메인.
- 결과와 트레이드오프: 짧은 주소를 사용한다. `deploy.json`과 dashboard app mapping은 프로젝트 디렉터리명과 다른 명시적 앱 ID를 일관되게 사용해야 하며 Google OAuth redirect URI도 새 주소로 교체해야 한다.

## 2026-08-25: 관리자와 Google 자격 증명은 managed secrets로 주입

- 상태: 승인
- 맥락: 관리자 비밀번호 verifier, 세션 키, Google OAuth credentials와 token 암호화 키는 저장소나 handoff에 포함할 수 없다.
- 결정: 프로젝트 CLI가 숨김 입력으로 `ADMIN_PASSWORD_HASH`를 만들고 256비트 `SESSION_SECRET`과 `GOOGLE_TOKEN_ENCRYPTION_KEY`를 생성한다. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`과 함께 names-only required secret으로 선언하며 사용자가 deployd 대시보드 **Secrets**에 직접 입력한다.
- 고려한 대안: 평문 관리자 비밀번호 환경변수, 저장소 `.env`, handoff JSON, 앱 내부 비밀번호 변경 화면.
- 결과와 트레이드오프: 실제 값은 browser-encrypted dashboard 경계를 벗어나지 않고 다음 사용자 승인 container recreation에 적용된다. 초기 등록 뒤 required secret을 설정하고 배포를 재시도하는 온보딩 단계가 필요하다.

## 2026-08-25: Raspberry Pi 배포는 deploy-project 경로만 사용

- 상태: 승인
- 맥락: 브리프가 공개 배포 환경과 운영 방식을 지정했다.
- 결정: 사용자가 별도로 배포를 지시하면 이 프로젝트에서 `deploy-project` 스킬로 Raspberry Pi 이미지와 dashboard handoff를 준비·검증한다.
- 고려한 대안: 임의 SSH 배포, 관리형 클라우드, 수동 파일 복사.
- 결과와 트레이드오프: 프로젝트별 안전 계약과 사용자 제어 배포를 따른다. bootstrap 단계에서는 배포 파일이나 외부 상태를 만들지 않는다.

## 2026-08-25: 로컬 개발 포트를 8464와 8465로 변경

- 상태: 승인
- 맥락: 일반적으로 사용하는 개발 포트와 충돌하지 않도록 프로젝트 전용 포트가 필요하다.
- 결정: Vite 개발 서버는 `http://localhost:8464`, Fastify API는 `http://127.0.0.1:8465`를 사용한다. Vite가 API 요청을 Fastify로 proxy하며 로컬 Google OAuth callback은 `http://localhost:8464/api/v1/admin/google/callback`이다.
- 고려한 대안: 기존 5173/3000 유지, Google callback을 API 포트에 직접 연결.
- 결과와 트레이드오프: Google Cloud OAuth 클라이언트의 개발용 승인된 리디렉션 URI를 새 Vite origin으로 갱신해야 한다. API 포트는 외부 callback URI로 등록하지 않는다.

## 2026-08-25: 관리자 세션은 서버 저장형 token과 이중 CSRF 방어 사용

- 상태: 승인
- 맥락: 단일 관리자 대시보드도 탈취·고정·CSRF와 장기 세션 재사용을 막아야 하며, 로컬 HTTP 개발도 가능해야 한다.
- 결정: 로그인마다 256비트 token을 발급하고 DB에는 SHA-256 hash만 저장한다. 운영 쿠키는 Secure/HttpOnly/SameSite=Lax/Path=/, 유휴 만료 30분, 절대 만료 8시간이다. 상태 변경은 정확한 Origin과 세션 ID에 HMAC으로 결합한 CSRF header를 모두 검증한다. 로컬 HTTP에서만 Secure 속성을 끈다.
- 고려한 대안: stateless JWT, 암호화 cookie session, SameSite만 사용, CSRF cookie, 무기한 세션.
- 결과와 트레이드오프: 즉시 서버 폐기와 명확한 만료가 가능하고 CSRF token을 브라우저 저장소에 영속화하지 않는다. 매 인증 요청에 SQLite 조회·갱신이 발생하며 프로세스 재시작 뒤 로그인 rate-limit 기록은 초기화된다.

## 2026-08-25: Google token과 동기화 상태의 로컬 보안 경계

- 상태: 승인
- 맥락: 단일 프로세스가 OAuth callback, Google API 호출, webhook과 재시도 작업을 처리하되 원문 refresh token과 이벤트 원문 노출을 최소화해야 한다.
- 결정: OAuth transaction은 AES-256-GCM 암호화 쿠키에 두고 state, S256 PKCE verifier, 관리자 session ID, 10분 만료를 함께 검증한다. refresh token도 목적별 AAD를 둔 AES-256-GCM 암호문으로만 SQLite에 저장한다. Google API는 공식 Node client 뒤의 최소 adapter 계약으로 격리하며 webhook에는 token hash만 저장하고 durable 작업 큐에 변경 힌트만 등록한다.
- 고려한 대안: 평문 refresh token DB 저장, access token 영속화, webhook 수신 중 즉시 Google API 호출, 네트워크가 필요한 통합 테스트.
- 결과와 트레이드오프: DB 또는 로그만 유출됐을 때 원문 자격 증명 노출을 줄이고 fake adapter로 오류·페이지 경계를 결정적으로 검증할 수 있다. 암호화 키 유실 시 기존 연결을 복구할 수 없으므로 재연결이 필요하며 키 회전 절차는 운영 준비 작업에서 다룬다.
