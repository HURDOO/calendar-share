# 보안·접근성·호환성 기준

기준일은 2026-08-25이며 T-009 구현과 검증 결과를 기록한다. 실제 production reverse proxy, Raspberry Pi 이미지, 실기기 smoke test는 T-010/T-011의 운영 경계다.

## 1. 신뢰 경계와 보호 자산

```text
관리자/방문자 브라우저
        |
   공개 HTTPS + 비신뢰 입력
        v
Reverse proxy ── X-Forwarded-For 정규화, 앱 포트 차단
        |
   TRUST_PROXY allowlist
        v
Fastify ── 인증/CSRF/정책 평가/보안 응답 header
   |                         |
SQLite 영속 데이터       Google OAuth/Calendar API
   |                         |
hash·암호문 중심 저장     PKCE/state/watch token 검증
```

보호 자산은 관리자 비밀번호 verifier와 세션, Google OAuth client secret·refresh token·암호화 키, `SHARE_LINK_SECRET`, 공유 원문 token·방문자 세션, 공개 허용 전 일정 상세, SQLite 파일과 로그다. 인터넷 요청, forwarded header, OAuth callback query, Google webhook header, 캘린더 설명, 공유 URL은 모두 비신뢰 입력으로 취급한다.

## 2. 위협 모델

| 위협 | 적용한 통제 | 남은 위험/운영 조건 |
| --- | --- | --- |
| 비밀번호 대입·client IP 위조 | 15분 5회 실패 제한, `TRUST_PROXY` IP/CIDR allowlist, 성공 시 bucket reset | proxy가 앱 포트 직접 접근을 막고 forwarded header를 정규화해야 한다. 프로세스 재시작 시 메모리 bucket은 초기화된다. |
| 관리자 세션 탈취·CSRF | hash-only 서버 세션, HttpOnly/Secure/SameSite=Lax, 유휴·절대 만료, exact Origin + session-bound CSRF | 사용자 기기 자체 침해와 브라우저 확장은 방어 범위 밖이다. |
| 공유 token/일정 누출 | 별도 256비트 secret의 HMAC 파생 token, DB hash+version only, 즉시 제거하는 URL fragment, exact-origin 세션 교환, 매 요청 정책 재평가, 회전·폐기, `no-referrer`, URL·body 로그 redaction | 링크를 받은 사람이 직접 재전달하는 행위와 메신저에 남은 복사본은 막지 못한다. 전역 share secret 유실·변경 시 기존 링크 재표시에 공유별 회전이 필요하다. |
| OAuth·Google token 노출 | PKCE/state/admin-session 결합, refresh token AES-256-GCM, 최소 read-only scope, callback query·cookie log redaction | 암호화 키 유실 시 재연결이 필요하고 실제 OAuth smoke test는 Google 설정 후 수행한다. |
| XSS·clickjacking·MIME 혼동 | React text escaping, 설명 plain text, same-origin script CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` | 동적 캘린더 색상 때문에 style에만 `unsafe-inline`이 남는다. inline script는 허용하지 않는다. |
| cache·검색·Referer 잔존 | 동적/HTML `no-store`, `X-Robots-Tag: noindex`, HTML robots meta, `Referrer-Policy: no-referrer` | 사용자 화면 캡처·클립보드·브라우저 확장은 통제할 수 없다. |
| 오류·로그를 통한 내부 정보 노출 | 500 응답은 `INTERNAL_ERROR`, 4xx 안정 code, URL/query/token/password/cookie/CSRF redaction | 운영 log sink 권한·보존 정책은 T-010에서 확정한다. |
| 과대 요청·서비스 고갈 | 64KiB body limit, 15초 request timeout, 외곽 proxy rate/body limit 전제 | SSE 장기 연결과 Google API/SQLite 자원 고갈은 관측성·부하 검증이 더 필요하다. |
| webhook 위조·재전송 | 저장된 channel/resource/token 대조, 알림은 데이터가 아닌 sync hint, durable dedupe queue | Google 전달 지연과 누락은 5분 recovery sync 범위 안에서만 복구된다. |

## 3. 응답과 캐시 정책

- 모든 Fastify 응답은 CSP, `Cross-Origin-Resource-Policy: same-origin`, 제한된 `Permissions-Policy`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow, noarchive`를 받는다.
- HTML, API, redirect, 오류, health는 기본 `Cache-Control: no-store`다. `/assets/이름-8자리이상hash.확장자` 형태의 성공한 GET/HEAD만 `public, max-age=31536000, immutable`이다.
- `Strict-Transport-Security: max-age=31536000`은 production HTTPS 경계에서만 적용하며 다른 하위 도메인에 영향을 주지 않도록 `includeSubDomains`와 preload는 사용하지 않는다.
- SSE는 Fastify reply lifecycle을 hijack하므로 전역 보안 header를 raw 응답에도 동일하게 복사한다.

## 4. 자동 검증 결과

| 항목 | 결과 |
| --- | --- |
| 서버 단위·통합 | Vitest 103개 통과: header/cache/HSTS, 64KiB 제한, 오류 마스킹, trusted proxy별 rate limit, legacy migration, fragment token 교환, 방문자 보기 전환·24시간 시간표·월간 날짜 연계·멀티데이 표시와 비신뢰 forwarded header 무시 포함 |
| 접근성 | axe WCAG 2 A/AA·2.1 AA·2.2 AA tag 검사에서 홈, 로그인, 방문자 달력, 관리자 공유 폼 위반 0건 |
| 키보드 | 로그인 Enter 제출, 공유 폼 autofocus·radio Space 선택, 월 이동·보기 전환 Enter가 Chromium/WebKit에서 통과 |
| Chromium | 데스크톱·390px 모바일에서 목록·주간·월간 전환, Galaxy S9+ touch viewport와 KakaoTalk형 UA 시나리오 통과 |
| WebKit | 로그인, 공유 수명주기, clipboard fallback, 모바일·데스크톱 목록/주간/월간, axe·키보드 시나리오 통과 |
| API 부재 fallback | EventSource가 없으면 일정은 유지하고 “새로고침으로 업데이트” 상태를 표시함 |
| 비밀값 | client bundle 3개 파일에서 server secret 이름, Google API key, private key, `.env.local` 흔적 없음 |
| 의존성 | `pnpm audit --prod` 알려진 취약점 0건 |

자동 검사는 접근성 전체를 증명하지 않으며 Playwright 기기 emulation은 실제 KakaoTalk 앱 자체가 아니다.

## 5. 배포 전 실기기 수동 점검표

- [ ] 최신 macOS/iOS Safari에서 로그인, 공유 생성·수정, 링크 복사 fallback, 월 이동과 뒤로가기를 확인한다.
- [ ] 최신 Android Chrome과 KakaoTalk 인앱 브라우저에서 `#share=` 링크 교환 후 주소에 token이 남지 않고 세로/가로 화면에 수평 스크롤이 없는지 확인한다.
- [ ] iOS KakaoTalk 인앱 브라우저에서 방문자 목록, 긴 제목·장소·여러 줄 설명, 만료/폐기 안내를 확인한다.
- [ ] 키보드만으로 로그인부터 공유 폼의 모든 항목·취소·저장까지 이동하며 포커스 링이 가려지지 않는지 확인한다.
- [ ] 200% 확대와 큰 시스템 글자 크기에서 콘텐츠·버튼이 겹치거나 잘리지 않는지 확인한다.
- [ ] VoiceOver 또는 TalkBack으로 제목 계층, 폼 legend/label, 상태·오류 안내, 이전/다음 달 버튼 이름을 확인한다.
- [ ] production reverse proxy가 앱 포트 직접 접근을 차단하고 실제 peer 주소만 `TRUST_PROXY`에 등록됐는지 확인한다.
- [ ] production 응답에서 HSTS/CSP/no-store/no-referrer/noindex header와 fingerprint asset immutable cache를 확인한다.
- [ ] reverse proxy와 앱 log에 레거시 `/s/:token`, public session request body, OAuth `code/state`, Cookie, CSRF, Google channel token 원문이 남지 않는지 확인한다.

실기기와 production 경계 확인은 사용자가 제어하는 T-011 배포 검증 때 기록한다.
