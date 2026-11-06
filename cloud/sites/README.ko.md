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
`SUCCEEDED`는 접수, `COMPLETED`는 완료이며 상태를 구분합니다. 반환 토큰이 없거나
잘못된 경우 이미 유료 작업이 접수되었을 수 있으므로 추적 불가/결과 불명 오류를
반환하고 자동 재제출하지 않습니다. 상태 조회는 한 번만 실행하며 자동 반복 조회나
재시도는 없습니다. 결과 텍스트는 명령이 아닌 신뢰할 수 없는 데이터로 다뤄야 합니다.

상태 점검은 네트워크 없이 설정 여부의 불리언만 표시합니다. 키 값, URL, 토큰,
식별자를 표시하지 않으며 실제 인증/버킷/과금 상태를 확인하지도 않습니다.
현재 Site, 실서비스 인증, 모바일 플러그인 연결, 플랫폼 비용/실제 요청 시간 제한은
검증하지 않았습니다. HTTP JSON 요청 16 KiB, 공급자 응답 1 MiB, 공급자 호출 10초
제한을 코드에 두었습니다. 큰 전사 결과에는 이 응답 제한이 적용됩니다.

Node.js 24에서 `npm run check`, `npm test`, `npm run build`, `npm run validate`로
로컬 검증합니다. 외부 런타임 의존성, D1/R2, 프로젝트 ID는 없습니다. 테스트는
모의 응답만 사용하며 기존 Python 구현은 보존됩니다. 세부 요청 형식, 공식 API
근거와 향후 배포 절차는 영문 문서를 참조하세요.
