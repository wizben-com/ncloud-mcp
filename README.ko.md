# ncloud-mcp

[English](README.md) · [보안/운영](SECURITY.md) · [서비스 구조](docs/architecture.md)

NAVER Cloud의 여러 서비스를 독립 모듈로 확장하기 위한 로컬 MCP 서버입니다. **현재 구현된 기능은 CLOVA Speech 장문 전사뿐입니다.** Object Storage 관리, 계정/권한 조회, 비용/사용량 조회는 향후 모듈이며, 현재 도구로 제공하지 않습니다. 검증되지 않은 범용 API 실행 기능은 없습니다.

범용 Python 코어는 Dot/OpenAI 구독이나 Sites/Cloudflare 계정에 종속되지 않으며, 호환되는 다른 MCP 클라이언트에서도 사용할 수 있습니다. 향후 Mac 실행 여부와 독립된 사용을 위해 선택 사항인 [Sites 클라우드 어댑터 소스](cloud/sites/README.ko.md)를 별도로 준비했습니다. URL/OBS 비동기 입력, URL 음원 업로드와 저장 결과 회수를 지원하며 운영자가 자신의 환경에 배포·연결해야 합니다. 휴대폰 채팅의 첨부 파일이 자동으로 해당 어댑터에 전달되지는 않습니다. [전송 방식·런타임·기능 비교표와 계약 테스트](docs/portability.md)를 참조하세요.

공식 **NAVER Cloud CLOVA Speech API**를 사용합니다. CLOVA Note 웹 로그인이나 비공개 브라우저 API를 사용하지 않습니다. 기존 CLOVA Note/웹 구독만으로 이 API를 사용할 수 있다고 가정하면 안 됩니다. 별도의 Speech 도메인 Invoke URL과 Secret, API 사용 과금 확인이 필요합니다. Python 코어에는 계정 API 키가 필요하지 않습니다. 선택적 클라우드 결과 리더는 별도로 승인된 계정/서브계정 API 키 쌍이 필요합니다. NAVER 공식 제품이 아닌 독립 커뮤니티 프로젝트입니다.

## 설치와 연결

Python 3.12 이상이 필요합니다. 로컬 파일 접근은 Linux/macOS를 지원하며, 지원되지 않는 OS에서는 안전하게 거부합니다. PyPI에는 배포하지 않았습니다. 소스 디렉터리에서 실행합니다.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/ncloud-mcp --check
```

MCP 호스트에 실행 파일의 절대 경로를 등록합니다.

```json
{"mcpServers":{"ncloud":{"command":"/absolute/path/ncloud-mcp/.venv/bin/ncloud-mcp","args":[]}}}
```

먼저 [도메인 생성 안내](https://guide.ncloud-docs.com/docs/clovaspeech-domain)에 따라 Object Storage 버킷을 준비하고 CLOVA Speech 도메인을 생성해야 합니다. 이 도메인 준비 요건은 동기 파일/URL 입력에도 적용됩니다. 다만 해당 입력 방식은 녹음 파일을 버킷에 미리 업로드하거나 이 MCP에 Object Storage 자격증명을 전달할 필요가 없습니다.

`.env.example`은 변수 안내용이며 자동으로 읽지 않습니다. 호스트의 안전한 환경 설정으로 전달하세요. 키를 채팅에 붙여넣거나 Git에 저장하지 마세요.

`--check`와 `ncloud_health`는 네트워크 호출 없이 설정 여부와 제한만 표시합니다. 키, URL, 계정 식별자, 경로는 표시하지 않습니다. 모듈이 활성화되어도 자격증명이 없으면 전사를 거부합니다.

## 환경설정 키 이름

아래는 **변수 이름·역할·필수 여부만** 안내합니다. 실제 키, 개인 버킷명, 허용 호스트
값은 문서나 채팅에 적지 마세요. Python stdio와 선택적 Sites 어댑터는 별도 설정입니다.

| 변수 이름 | 역할 | 필수 여부 |
| --- | --- | --- |
| `NCLOUD_SPEECH_ENABLED` | Speech 모듈 활성화 | Speech 사용 시 |
| `NCLOUD_SPEECH_INVOKE_URL` | 도메인 기본 Invoke URL, Secret 저장 | Speech 사용 시 |
| `NCLOUD_SPEECH_SECRET` | 도메인 인증 Secret, 계정 API 키와 별개 | Speech 사용 시 |
| `NCLOUD_SPEECH_URL_HOSTS` | 공급자가 가져올 음원의 정확한 신뢰 호스트 | URL 입력 시 |
| `NCLOUD_SPEECH_ALLOW_OBJECT_STORAGE` | 도메인 상대 객체 입력 허용 | 해당 입력 시 |
| `NCLOUD_SPEECH_ALLOW_ASYNC_OBS` | 비동기 결과 저장 허용 | 비동기 제출 시 |

### 범용 Python stdio 전용

| 변수 이름 | 역할 | 필수 여부 |
| --- | --- | --- |
| `NCLOUD_SPEECH_LOCAL_ROOTS` | 허용할 전용 녹음 폴더 | 로컬 파일 입력 시 |
| `NCLOUD_SPEECH_MAX_UPLOAD_BYTES` | 로컬 업로드 크기 제한 | 선택 |
| `NCLOUD_SPEECH_TIMEOUT_SECONDS` | 공급자 요청 시간 제한 | 선택 |

### 선택적 Sites 어댑터 전용

| 변수 이름 | 역할 | 필수 여부 |
| --- | --- | --- |
| `NCLOUD_SPEECH_UPLOAD_URL_HOSTS` | 어댑터가 가져와 업로드할 음원의 신뢰 호스트 | upload_url 입력 시 |
| `NCLOUD_SPEECH_MAX_RESULT_BYTES` | 공급자 상태 응답 크기 제한 | 선택 |
| `NCLOUD_SPEECH_RESULT_STORAGE_ENABLED` | 별도 저장 결과 읽기 활성화 | 저장 결과 회수 시 |
| `NCLOUD_ACCOUNT_ACCESS_KEY` | 계정/서브계정 API Access Key, Secret 저장 | 저장 결과 회수 시 |
| `NCLOUD_ACCOUNT_SECRET_KEY` | 위 키와 짝인 API Secret Key, Secret 저장 | 저장 결과 회수 시 |
| `NCLOUD_SPEECH_RESULT_BUCKET` | 허용한 결과 버킷 하나 | 저장 결과 회수 시 |
| `NCLOUD_SPEECH_RESULT_PREFIX` | 허용할 객체 경로 접두사 | 루트 접근을 명시 허용하지 않은 경우 |
| `NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT` | 빈 접두사로 버킷 루트 읽기 허용 | 승인된 루트 접근 시에만 |
| `NCLOUD_SPEECH_RESULT_KEY_TEMPLATE` | 검증된 토큰/선택 파일명 기반 객체 경로 규칙 | 자동 회수 시 필수, 정확한 키 직접 지정 시 선택 |

계정 키라는 이름이 주계정 사용을 뜻하지는 않습니다. 최소 읽기 권한의 서브계정을
권장하며 실제 IAM 권한을 확인해야 합니다. 코드의 버킷 제한은 유출된 키의 권한을
줄이지 않습니다.

상태 API의 완료 응답은 전사문 회수를 보장하지 않습니다. Python 상태 도구에는
Object Storage 결과 다운로드 기능이 없으며, 해당 기능은 선택적 어댑터에 있습니다.
자세한 안전 입력 경로·제한은 [Sites 설정 안내](cloud/sites/README.ko.md)를 보세요.

## 사용

`clova_speech_transcribe`에 다음 인수를 전달합니다. 이 도구는 **유료 API 호출과 음원 전송**을 수행하므로 사용자의 해당 녹음 처리 요청이 있어야 합니다.

```json
{"request":{"source":"file","location":"/dedicated/audio/sample.wav","language":"ko-KR","diarization":true,"completion":"sync","result_to_obs":false}}
```

`source`는 `file`, `url`, `object_storage` 중 하나입니다. 객체는 도메인에 설정한 인식 대상 저장소를 기준으로 `dataKey`를 지정합니다. 언어는 `ko-KR`, `en-US`, `enko`, `ja`, `zh-cn`, `zh-tw`를 받으며 도메인 지원 여부에 따라 달라질 수 있습니다. 결과에는 상태, 작업 토큰, 전체 텍스트, 밀리초 단위 구간/단어 타임코드와 화자 라벨이 있습니다.

파일/URL **동기 전사에는 입력 파일의 사전 업로드나 MCP용 Object Storage 자격증명이 필요하지 않지만**, 도메인 생성에 필요한 버킷 준비 요건은 그대로 적용됩니다. 현재 비동기 구현은 `completion="async"`, `result_to_obs=true`만 지원하며 **전사 결과를 도메인에 설정한 Object Storage에 저장**합니다. 도메인의 결과 저장소와 권한을 사전에 설정해야 하며 별도 저장 비용/보관 정책도 확인해야 합니다. 콜백 없는 단순 제출 후 조회만으로 비동기를 시작하지 않습니다. `SUCCEEDED`는 접수 상태입니다. 반환된 토큰을 보관하고 `clova_speech_job_status`에 `{"token":"<returned-token>"}`를 전달해 한 번씩 조회하세요. 비동기 추적 토큰이 없거나 유효하지 않으면 결과 불명/추적 불가 오류를 반환합니다. 이미 유료 작업이 접수되었을 수 있으므로 자동으로 재제출하지 마세요. 자동 재시도나 자동 반복 조회는 없습니다.

로컬 업로드 기본 제한은 25 MiB이며 최대 250 MiB까지 설정할 수 있습니다. API의 파일/길이 제한과 근거는 [API 문서](docs/api.md)에 정리했습니다. URL/객체의 용량과 재생 길이는 서버가 사전 확인하지 않으며 공급자가 검증합니다. URL의 리디렉션을 포함해 운영자가 신뢰할 수 있는 원본만 허용하세요. 공급자의 실제 다운로드 목적지를 이 프로세스가 통제할 수는 없습니다.

전사 제출 후 타임아웃/연결 실패는 작업이 이미 접수되었을 수 있습니다. 자동 재제출하면 중복 과금될 수 있으므로 운영자가 상태를 확인해야 합니다. 텍스트는 신뢰할 수 없는 데이터이며 명령으로 실행하지 마세요.

stdio 전용으로 HTTP 포트를 열지 않습니다. 공개 HTTP 브리지로 노출하지 마세요. `plugin/ncloud-mcp`에는 로컬 플러그인 템플릿을 포함하지만, 설치 또는 이 대화에 연결된 도구라는 의미는 아닙니다. 실제 음원/키/고객 데이터 없이 모의 응답과 합성 파일로 테스트합니다. 라이선스는 MIT입니다.
