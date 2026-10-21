# 캘공 운영 Runbook

기준일은 2026-08-25다. 이 문서는 단일 Linux ARM64 인스턴스, 영속 로컬 `/data`, deployd reverse proxy를 전제로 한다. 실제 배포·재시작·롤백과 live DB 교체는 사용자의 명시적 지시 뒤 `deploy-project` 절차로만 수행한다.

## 1. 고정 배포 계약

- 앱 ID: `calendar`
- 공개 origin: `https://calendar.app.hurdoo.kr`
- 이미지 저장소: `ghcr.io/hurdoo/calendar-share`
- 컨테이너 포트: `8465`
- 영속 데이터: `/data/calendar-share.db`와 `/data/backups`
- readiness: `GET /health/ready`
- liveness: `GET /health/live`
- 플랫폼 제공 환경변수: `APP_BASE_URL`, `STORAGE_DIR`, `NODE_ENV`, `HOST`, `PORT`
- 검토 가능한 환경변수: `APP_TIME_ZONE`, `LOG_LEVEL`, `TRUST_PROXY`
- 필수 secret 이름: `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `SHARE_LINK_SECRET`

실제 secret 값은 저장소, `deploy.json`, 로그, 명령 인자에 넣지 않는다. `TRUST_PROXY`는 Fastify 바로 앞 proxy 주소만 허용하며 T-011에서 실제 container network peer와 일치하는지 확인한다.

## 2. 상태 확인과 관측

`/health/live`는 프로세스 event loop가 응답하는지만 확인한다. `/health/ready`는 DB 읽기, rollback되는 쓰기 probe, 추적된 migration 개수를 확인한다. Google 장애는 readiness를 실패시키지 않아 재시작 루프를 만들지 않는다.

관리자 인증 뒤 `GET /api/v1/admin/operations`에서 다음을 확인한다.

- 프로세스 시작 시각과 uptime
- 마지막 성공 Google 동기화 시각
- 활성 캘린더별 sync 상태, 안전한 오류 code, lag
- queue 상태별 개수, 처리 대기 깊이, 누적 실패 수
- 활성 watch 수와 다음 만료까지 남은 시간
- 현재 프로세스의 최근 공개 events API 최대 512개 표본 count, p95, max latency

이 endpoint는 내부 캘린더 ID를 포함하므로 공개 모니터링에 연결하지 않는다. 프로세스 메모리 latency 표본은 재시작하면 초기화된다.

애플리케이션은 stdout에 JSON 구조화 로그만 기록한다. HTTP 로그는 `request_id`, route template, status, result, duration을, worker 로그는 `job_id`, job kind, result, duration, 안전한 오류 code를 기록한다. URL, query, cookie, 비밀번호, OAuth code/state, Google channel token, 일정 상세와 sync payload는 기록하지 않는다. 운영 수집기는 접근을 관리자에게 제한하고 14일 또는 256MiB 중 먼저 도달하는 경계로 회전해야 하며 T-011에서 실제 설정을 확인한다.

초기 경보 기준은 다음과 같다.

- readiness가 연속 3회 실패
- 연결 상태인데 마지막 성공 sync가 10분 이상 지연
- queue depth가 5분 이상 0보다 크거나 `FAILED`가 증가
- 활성 캘린더가 `ERROR`, 또는 watch 만료가 24시간 이내
- 공개 events API p95가 최근 표본에서 500ms 초과

## 3. 재시작과 작업 복구

SIGTERM 또는 SIGINT를 받으면 HTTP listener를 닫고 새 요청과 scheduler tick을 중단한 뒤 현재 실행 중인 sync 작업을 기다리고 DB를 닫는다. 같은 프로세스에 여러 신호가 와도 종료는 한 번만 수행한다.

강제 종료로 `RUNNING`에 남은 durable job은 다음 시작 시 즉시 `RETRY`로 되돌리고, Google 연결 상태면 deduplicated recovery sync를 등록한다. 이후 5분 recovery sync와 1시간 stale-lock/watch/window 유지 작업이 계속 보완한다. 정상 재시작 뒤 다음을 확인한다.

1. 종료 로그의 `Graceful shutdown completed`와 exit code 0
2. 시작 로그의 `startup_recovery_completed` 및 복구 작업 수
3. readiness 200
4. 관리자 operations에서 queue depth가 다시 0으로 수렴하고 마지막 sync가 갱신됨

## 4. 온라인 백업

백업은 SQLite Online Backup API로 WAL을 포함한 일관 snapshot을 만든다. 결과 DB와 SHA-256 sidecar는 각각 mode `0600`, 새 backup 디렉터리는 `0700`으로 만든다. 생성 직후 checksum, `integrity_check`, `foreign_key_check`, migration 개수를 검증한다. 기존 대상은 덮어쓰지 않으며 자동 삭제도 하지 않는다.

로컬 저장소에서 실행:

```bash
pnpm db:backup -- --source ./data/calendar-share.db
```

빌드된 컨테이너에서 실행:

```bash
node dist/server/backup-database.js --source /data/calendar-share.db
```

정상 출력의 `snapshotPath`, `checksumPath`, `sha256`을 배포 기록에 남긴다. secret이나 DB 내용을 기록하지 않는다. 최소한 매일 한 번, 배포·migration·secret 변경 직전, Google 연결 해제 직전에 백업한다. 보존 정리는 검증된 대체 백업과 복구 지점을 확인한 뒤 별도 승인으로 수행한다.

## 5. 복원 검증과 live 복구

복원 CLI는 checksum과 DB 무결성·foreign key·migration을 먼저 검증하고, 존재하지 않는 별도 대상에만 복사한다.

```bash
pnpm db:restore -- --backup ./data/backups/calendar-share-BACKUP.db --target ./data/verification/restored.db
```

컨테이너 이미지의 빌드 결과도 같은 CLI를 제공한다.

```bash
node dist/server/restore-database.js --backup /data/backups/calendar-share-BACKUP.db --target /data/verification/restored.db
```

AC-012 복구 드릴은 복원된 DB에서 `integrity_check=ok`, foreign key 위반 0, migration 개수 일치와 공유 정책 row 조회를 확인한다.

live DB 교체는 데이터 변경 작업이다. 다음 순서를 생략하지 않는다.

1. 대상 앱, 현재 이미지 digest, live DB 경로, 선택한 backup과 checksum을 확인한다.
2. 현재 live DB의 온라인 백업을 하나 더 만들고 복구 지점으로 기록한다.
3. 서비스를 정상 중지하고 프로세스가 완전히 종료됐는지 확인한다.
4. 선택한 backup을 `/data`의 새 candidate 경로로 복원 검증한다.
5. 사용자 승인을 받은 뒤 live DB와 정확히 대응하는 `-wal`, `-shm` 파일을 함께 격리 디렉터리로 이동하고 candidate를 `calendar-share.db`로 원자 전환한다. 파일을 삭제하지 않는다.
6. 서비스를 시작해 readiness, 관리자 로그인, Google 상태, 기존 공유 정책을 확인한다.
7. 실패하면 서비스를 다시 중지하고 격리한 원본 세트를 복귀한 뒤 이전 검증 이미지로 롤백한다.

이 저장소의 restore CLI 자체는 live 파일을 덮어쓰거나 삭제하지 않는다. 최종 전환은 T-011의 승인된 유지보수 경계에서만 수행한다.

## 6. 이미지와 배포 전 점검

`Dockerfile`은 Node.js 24.22.1 Bookworm slim digest와 pnpm 11.12.0을 고정한 multi-stage Linux ARM64 이미지다. `better-sqlite3`는 build stage에서 ARM64 native module로 컴파일된다. runtime은 `node` 사용자, read-only root filesystem, writable `/data`, `/tmp` tmpfs, 모든 capability drop, `no-new-privileges`를 전제로 한다.

이미지는 기본적으로 `node` 사용자로 실행되지만 deployd managed runtime은 현재 UID `0:0`으로 덮어쓴 뒤 모든 capability를 제거한다. capability 없는 UID 0도 migration을 읽을 수 있도록 runtime의 `/app/drizzle` tree는 모든 사용자에게 읽기 권한과 디렉터리 탐색 권한만 제공해야 한다. Dockerfile의 `chmod -R a+rX /app/drizzle`을 제거하거나 migration을 mode 0600/0700으로 되돌리지 않는다.

배포 전 다음을 통과시킨다.

```bash
pnpm db:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm security:bundle-check
pnpm test:e2e
docker build --platform linux/arm64 --tag calendar-share:t010 .
```

이미지 smoke는 readiness/UI/API, `process.arch=arm64`, native SQLite migration, 온라인 backup→별도 restore, read-only root와 writable `/data`, SIGTERM exit 0, 같은 volume 재시작 후 데이터 지속성을 확인한다.

## 7. T-011 사용자 제어 배포 체크리스트

- [x] `@hurdoo/calendar-share` 저장소에 `@hurdooagent` collaborator 초대 및 push 방식 확인
- [x] GHCR package 경로와 ARM64 image digest 확인
- [x] deployd dashboard의 여섯 required secret이 모두 준비 상태인지 names-only API로 확인
- [ ] `TRUST_PROXY`가 실제 바로 앞 proxy peer와 일치하는지 확인
- [ ] 사용자 승인 뒤 배포하고 readiness/HSTS/CSP/cache header 확인
- [ ] production OAuth callback과 Google 연결·동기화 확인
- [ ] HTTPS Google webhook/watch 생성과 recovery sync 확인
- [ ] fragment 공유 링크의 clean URL, 방문자 세션, 목록·주간·월간 확인
- [ ] 배포 직전 backup과 검증된 rollback image digest 기록

T-010은 로컬 이미지와 절차 준비까지만 완료한다. GHCR push, deployd 상태 변경, 대시보드 secret 입력, Raspberry Pi 배포는 포함하지 않는다.
