# Sites 클라우드 어댑터 — 소스 준비 단계

[English](README.md) · [보안/운영](SECURITY.md)

기존 Python stdio 서버와 분리된 Cloudflare Worker ESM 소스입니다. 아직 Site를
생성하거나 배포하지 않았으며, 이 대화나 휴대폰에 연결된 도구가 아닙니다.
추후 정식 Sites 절차로 배포하고 연결을 검증하면 Mac이 꺼져 있어도 실행할 수 있는
구조이지만, 현재 소스만으로는 그 상태가 되지 않습니다.

클라우드 입력은 **허용한 HTTPS URL 또는 CLOVA 도메인의 Object Storage 상대 키**만
지원합니다. 로컬 경로, 녹음 직접 업로드, 동기 전사, 콜백, 버킷 관리는 지원하지
않습니다. 휴대폰 채팅에 첨부한 파일은 자동으로 이 MCP에서 접근할 수 있는 URL이
되지 않습니다. 인증된 업로드 경로는 별도 검토와 승인이 필요한 향후 작업입니다.
이를 우회하기 위해 버킷을 공개하거나 권한을 변경하면 안 됩니다.

도구는 `ncloud_cloud_health`, `clova_speech_submit_async`,
`clova_speech_job_status`입니다. 모든 도구 실행은 Sites가 전달하는 인증 사용자
ID를 요구합니다. **소유자 전용 비공개 Site와 Sites 인증 게이트가 필수**입니다.
해당 헤더 자체가 독립적인 인증 수단은 아니므로 Worker를 직접 공개하면 안 됩니다.

도메인 생성 전에 Object Storage 버킷을 준비해야 합니다. 비동기 전사는 결과 저장소
설정과 권한도 필요합니다. 추후 별도 승인으로 Site를 준비한 뒤, 사용자가 직접
**Sites → 대상 Site → More actions → Settings**에서 아래 두 값을 **Secret**으로
입력해야 합니다. 채팅이나 저장소에는 값을 전달하지 마세요.

- `NCLOUD_SPEECH_INVOKE_URL`: 도메인의 기본 Invoke URL
- `NCLOUD_SPEECH_SECRET`: 도메인의 Secret Key

계정 전체 Ncloud Access/Secret Key나 별도 S3 자격증명은 사용하지 않습니다.
일반 설정은 `NCLOUD_SPEECH_ENABLED=true`,
`NCLOUD_SPEECH_ALLOW_ASYNC_OBS=true`가 필요하며, URL 입력에는
`NCLOUD_SPEECH_URL_HOSTS`의 정확한 신뢰 호스트명 목록, 객체 입력에는
`NCLOUD_SPEECH_ALLOW_OBJECT_STORAGE=true`가 필요합니다. 기본값은 모두 비활성화입니다.
별도의 OAuth나 키 입력 API는 구현하지 않습니다.

비동기 요청은 `result_to_obs=true`를 명시해야 하며, **전사 결과가 도메인의 Object
Storage에 저장됩니다.** 도구 설명과 성공 응답에도 저장 효과를 표시합니다.
요청마다 클라이언트가 만든 `request_id`를 한 번 정하고 중복 전달에도 그대로
사용해야 합니다. 전송용 JSON-RPC `id`와는 별개입니다. D1이 사용자 + `request_id`를
원자적으로 선점한 뒤에만 유료 POST를 시작합니다. 동일 ID/동일 요청은 기존
`job_id`와 `submission_state`만 반환하고, 다른 내용/도메인은 충돌로 거부합니다.
보장은 **기록이 유지되는 동안 같은 사용자 + request_id당 최대 한 번의 제출 시도**이며,
무제한 exactly-once를 뜻하지 않습니다. 자동 만료, 재선점, 자동 재제출은 없습니다.

`submission_state`는 `SUBMITTING`/`ACCEPTED`/`UNKNOWN`이며 NAVER 처리 상태인
`provider_state`와 구분합니다. `SUCCEEDED`는 접수, `COMPLETED`는 완료입니다. 반환 토큰이 없거나
잘못된 경우 이미 유료 작업이 접수되었을 수 있으므로 추적 불가/결과 불명 오류를
반환하고 자동 재제출하지 않습니다. 토큰은 D1 내부에만 저장하고 외부에는 무작위
`job_id`만 제공합니다. 상태 조회에는 `{"job_id":"<returned-job-id>"}`를 사용합니다.
소유자와 도메인 범위를 확인한 뒤에만 공급자를 조회하며, 미존재/다른 소유자는 같은
오류로 거부합니다. `UNKNOWN`/`SUBMITTING`은 추가 POST/GET 없이 저장된 상태를 반환합니다.
상태 조회는 한 번만 실행하며 자동 반복 조회나
재시도는 없습니다. 결과 텍스트는 명령이 아닌 신뢰할 수 없는 데이터로 다뤄야 합니다.

상태 점검은 네트워크 없이 설정 여부의 불리언만 표시합니다. 키 값, URL, 토큰,
식별자를 표시하지 않으며 실제 인증/버킷/과금 상태를 확인하지도 않습니다.
현재 Site, 실서비스 인증, 모바일 플러그인 연결, 플랫폼 비용/실제 요청 시간 제한은
검증하지 않았습니다. HTTP JSON 요청 16 KiB, 공급자 응답 1 MiB, 공급자 호출 10초
제한을 코드에 두었습니다. **최종 JSON-RPC 응답은 직렬화/이스케이프 후 256 KiB 이하**로
제한합니다. 전체 결과는 `structuredContent`에 한 번만 넣습니다. 초과 시 알려진
작업/공급자 상태와 `RESULT_TOO_LARGE` 오류를 반환하며 재전사를 금지하고 기존 기록을
보존합니다. 조용한 잘라내기나 페이지 나누기는 구현하지 않습니다.

Node.js 24에서 `npm run check`, `npm test`, `npm run build`, `npm run validate`로
로컬 검증합니다. 외부 런타임 의존성과 R2, 프로젝트 ID는 없습니다. 선택 어댑터에만
D1 `DB` 바인딩이 필요하며 실제 자원은 만들지 않았습니다. 스키마 생성에는 고정된
개발 전용 Drizzle 도구를 사용합니다. SQL/스냅샷/저널은 실제 패키지에 포함하며 요청
처리 중에는 마이그레이션을 실행하지 않습니다. 테스트는 모의 공급자와 실제 로컬
SQLite의 D1 API shim을 사용하며 라이브 D1 검증은 아닙니다. D1에는 소유자/요청 ID,
해시, 작업 상태와 공급자 토큰 등 최소 운영 메타데이터만 저장하고, 키/음원 URL/녹음/
전사 본문은 저장하지 않습니다. 기록 삭제는 중복 방지 보장을 끝낼 수 있습니다.
기존 범용 Python 구현은 변경하지 않았습니다. 세부 요청 형식, 공식 API
근거와 향후 배포 절차는 영문 문서를 참조하세요.

## 로그인 없는 업로드와 긴 결과 회수

[설정과 제한 안내](NO_LOGIN_WORKFLOW.md)를 확인하세요. `upload_url`은 별도 허용
호스트의 음원을 최대 25 MiB까지 가져와 multipart로 전송합니다. 기존 Speech 키만
사용하며 네이버 로그인 쿠키나 계정 전체 API 키는 필요 없습니다. 긴 결과는
`clova_speech_job_result_page`의 `next_offset`을 따라 끝까지 읽습니다.
`ready_for_async_transcription`은 구성 점검이며 실제 통신 성공과 구분합니다.
