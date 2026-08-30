# Witch Desktop · 0.2.0 preview

Witch는 저장소 구조를 읽고, 파일을 편집하고, 그래프의 컴포넌트를 AI 대화에 연결하는 독립형 Electron ADE입니다. 아직 VS Code 전체를 대체하는 완성 제품은 아닙니다.

## 실행

소스에서 실행하려면 Node.js 22 이상과 npm이 필요합니다.

```sh
npm ci
npm run dev
```

`npm run build`는 운영체제나 shell과 관계없이 프로젝트의 Node build wrapper를 사용하고 renderer 번들에 4 GB heap 한도를 적용합니다. 별도의 `NODE_OPTIONS` 설정은 필요하지 않습니다. Pull request와 `main` push는 Windows와 macOS에서 typecheck, unit tests, production build, 전체 개발 Electron E2E를 자동 실행합니다.

**Open repository**로 로컬 프로젝트 폴더를 선택합니다. 구조 분석은 로컬에서 실행되며, AI 없이도 편집기·검색·그래프·터미널을 사용할 수 있습니다.

처음에는 [작은 체험 프로젝트](examples/playground/README.md)를 열어 그래프·드래그 첨부·검토 흐름을 확인할 수 있습니다. 별도의 npm 의존성 설치는 필요하지 않습니다.

## 현재 기능

| 영역            | 구현 범위                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 프로젝트 / 파일 | 폴더 열기, 최근 프로젝트, 빈 폴더 탐색, 새 파일·폴더, 이름 변경·이동·휴지통 삭제                                                                      |
| 편집기          | Monaco, 여러 파일 탭, 문법 강조, 저장·모두 저장, 파일 내 검색, 미저장 표시, UTF-8/BOM 보존                                                            |
| 검색 / 언어     | 빠른 파일 열기, 프로젝트 검색, TS/JS와 Python 언어 서버, 선택적 rust-analyzer, 자동완성·툴팁·진단·정의·참조·Outline·검토형 리팩터링                   |
| 실행 / 디버그   | Node.js와 선택 Python 환경/debugpy launch, 브레이크포인트·스텝·지역 변수·콜스택, 프로젝트 launch 구성                                                 |
| 터미널 / 작업   | 최대 8개 실제 PTY 탭, 로컬 shell, tasks/npm scripts, 선택 Python 환경과 uv/Poetry/Ruff/Cargo 기반 탐지 Task, 시스템 OpenSSH 대화형 원격 터미널        |
| 설정 / 확장     | 설정 저장, 3개 Witch 테마, 사용자 단축키, 명령 팔레트, 선택적 자동 저장, 로컬 스니펫 확장                                                             |
| 외부 파일 변경  | 자동 감시, 깨끗한 버퍼 새로고침, 미저장 충돌 보존, 디스크와 diff 검토                                                                                 |
| 구조 / AI       | 검증 가능한 source IR + 의미 IR, Python/Rust/TS 심볼, 6개 Meaning 렌즈, TS/JS direct-call graph, 검증된 의미 dossier를 쓰는 Codex 격리 편집·diff 승인 |

TS/JS 관계는 TypeScript AST와 모듈 해석을 사용합니다. Python은 클래스·함수·메서드·async·decorator와 import 범위를, Rust는 `struct`·`enum`·`trait`·`impl`·함수/메서드·`mod/use` 범위를 정적으로 추출합니다. 확인된 결과는 `witch.architecture/v1`, 의미 계층은 별도로 검증되는 `witch.semantic/v1`에 저장됩니다. **Meaning**은 Overview, Components, Workflows, Calls, Questions, Verified/Authored 렌즈로 복잡도를 나누며 System, Component, Workflow, WorkflowStep, File, Symbol의 근거와 추론 관계를 탐색합니다. Calls는 TypeScript checker가 프로젝트 내부의 direct identifier를 실제 선언으로 해석한 경우만 `Verified`로 표시하며 property/dynamic dispatch는 제외합니다. `Verified`, `Inferred`, `Authored`는 섞지 않고 표시합니다. 이름·annotation 기반 역할/워크플로 추론은 자동으로 `provisional` 계층에만 활성화되고, 소스 사실을 덮어쓰지 않습니다. `.witch/analysis.json`의 Authored claim과 충돌하면 추론을 임시 추천값으로 유지하면서 OpenQuestion과 양쪽 근거를 남깁니다. Meaning 카드를 Agent에 첨부하면 메인 프로세스가 현재 검증된 그래프에서 파일 범위·label·trust를 다시 계산하고, 선택 노드 주변 관계·claim·질문·evidence를 bounded dossier로 전달합니다. 이 자동 승인은 코드 변경·터미널 실행·Git 작업·금융 주문에는 적용되지 않습니다. 상세 계약은 [semantic analysis policy](docs/semantic-analysis-policy.md)와 [Symbol call graph v0](docs/symbol-call-graph-v0.md)을 참고하세요.

편집 중인 분석 대상 파일은 **Reveal in Constellation**으로 직접 찾아갈 수 있으며, Focus 뷰는 해당 파일의 정확한 1-hop import/imported-by와 evidence line만 표시합니다. 노드를 선택하면 확인된 관계만 따라 upstream/downstream reach를 확인하거나 두 노드 사이의 최단 방향 경로를 추적할 수 있습니다. 이전 reading과 현재 reading은 **Before · Delta · After**로 비교하며, 추가·변경·삭제된 노드와 관계만 정확히 표시하고 영향도를 추정하지 않습니다. 검증된 IR은 단일 오프라인 HTML 또는 JSON으로 원자적으로 저장할 수 있습니다. 큰 프로젝트는 20,000개 탐색 항목·64 MB 소스 읽기, 화면은 220개 노드·600개 연결로 제한됩니다. 검색과 모듈 상세 보기로 범위를 좁힐 수 있고, 연결을 선택하면 실제 import 위치와 코드 근거가 표시됩니다. 지원 관점과 정적 분석의 진실성 경계는 [architecture views](docs/architecture-views.md)에 정리했습니다.

왼쪽·오른쪽 패널과 터미널의 크기를 드래그나 키보드로 조절할 수 있으며 크기와 브레이크포인트는 재실행 후에도 유지됩니다. 편집기 새로고침 시 기존 터미널에 다시 연결합니다. 앱을 완전히 종료하면 터미널 프로세스는 종료됩니다.

Settings → Remote에서 SSH 호스트 프로필을 저장하고 터미널 상단의 연결 선택기로 실제 원격 shell을 열 수 있습니다. Witch는 비밀번호·passphrase·개인 키 본문을 저장하지 않으며 인증과 host-key 확인을 시스템 OpenSSH, `ssh-agent`, `~/.ssh/config`에 위임합니다. 현재 단계는 **원격 터미널만** 지원합니다. 파일 탐색기·편집기·검색·LSP·Task·Debugger는 아직 열린 로컬 프로젝트에서 실행되며, 원격 파일 Workspace는 후속 단계입니다. 상세 계약은 [Remote Workspace v0 명세](docs/remote-workspace-spec-v0.md)를 참고하세요.

큰 폴더의 탐색기는 화면 주변 항목만 렌더링합니다. 방향키·Home/End로 화면 밖 파일도 선택할 수 있고, 빠른 파일 열기에서 선택한 항목으로 자동 이동합니다. 저장 중 종료 요청은 저장이 끝난 뒤 이어서 처리하며, 정상 종료는 언어 서버 정리와 받아 둔 프로필 기록의 저장을 기다립니다.

## 구조에서 작업하기

1. 프로젝트를 열고 **Constellation**에서 **Read structure**를 누릅니다.
2. 모듈을 더블클릭하면 파일로 들어갑니다. Source에서 **Reveal in Constellation**을 누르면 활성 파일의 직접 의존성만 집중해서 보고, evidence 줄이나 **Open source**로 다시 편집기에 돌아갈 수 있습니다.
3. 과거 reading의 **Compare reading**을 누르면 현재 구조와의 정확한 차이를 보고, **Export architecture**에서 오프라인 HTML이나 검증된 IR JSON을 저장할 수 있습니다.
4. **Meaning**에서 Overview, Components, Workflows, Calls, Questions, Verified/Authored 렌즈를 전환하며 컴포넌트·direct call·임시 워크플로와 claim/question 근거를 검토합니다.
5. 카드의 드래그 손잡이를 오른쪽 채팅에 놓거나 inspector의 **Add to Agent context**를 누릅니다. 의미 컨텍스트 chip은 kind와 trust를 함께 표시합니다.
6. **Ask**는 질문, **Change · isolated copy**는 분리된 복사본에서 변경을 수행합니다.
7. 변경 검토 화면에서 실제 파일 diff를 확인하고 적용할 파일만 선택합니다. 원본은 승인 후 바뀝니다.
8. 원본 충돌이 있으면 적용을 거부하며, 그래프는 저장된 실제 코드에서 다시 계산됩니다.

미적용 변경안은 **Archive without applying**으로 보관할 수 있습니다. 원본은 바꾸지 않고, 전체 diff와 격리 폴더를 앱 데이터에 남깁니다. 보관을 취소하면 기존 검토 상태를 유지합니다. 보관본을 검토 화면으로 복원하는 기능은 아직 없습니다.

현재 실제 채팅·변경 실행은 **이미 로그인한 로컬 Codex CLI**를 사용합니다. **AI providers**에서 CLI 설치 여부와 키 저장 상태를 확인할 수 있습니다. Claude Code와 직접 OpenAI/Anthropic API 추론은 아직 연결하지 않았습니다. API 키 저장과 해당 키를 사용한 추론은 별개입니다.

CLI 탐색은 파일 존재 여부만 확인하며 앱을 열었다는 이유로 CLI나 shell 초기화 스크립트를 실행하지 않습니다. macOS Finder 실행 시에도 Homebrew·사용자 설치 경로·nvm 설치를 탐색합니다. 자동 탐색이 안 되면 `WITCH_CODEX_PATH`에 CLI의 절대 경로를 지정할 수 있습니다. 실제 로그인·연결 상태는 요청을 시작할 때 확인합니다.

AI에 요청하면 관련 소스가 해당 공급자에게 전달됩니다. 로컬 그래프 생성·편집·검색은 AI 호출이 아닙니다.

## 단축키 / 설정

`Mod`는 Windows의 Ctrl, macOS의 Cmd입니다. Settings에서 앱 단축키를 바꿀 수 있습니다.

- `Mod+P`: 파일 열기 · `Mod+Shift+F`: 프로젝트 검색
- `Mod+S`: 저장 · `Mod+Shift+S`: 모두 저장
- `Mod+Shift+P`: 명령 팔레트 · `Mod+,`: 설정
- 편집기 `F2`: 이름 변경 · `F12`: 정의 · `Shift+F12`: 참조 · `Mod+.`: 코드 액션
- 편집기 `Mod+K` 다음 `Mod+I`: 타입·설명 툴팁 · `Mod+Shift+Space`: 매개변수 안내
- 탐색기 방향키·Home/End: 이동 · `F2`: 파일 이름 변경 · `Delete`: 휴지통 이동 확인
- `F9`: 브레이크포인트 · `F5`: 디버그 시작/계속 · `Shift+F5`: 중지

자동 저장은 기본적으로 꺼져 있으며 외부 변경 충돌이 있는 파일에는 적용하지 않습니다. 확장은 실행 코드가 없는 Witch JSON 스니펫 형식만 지원합니다. [샘플 확장](examples/extensions/witch-typescript.witch.json)을 Settings → Extensions에서 가져올 수 있습니다.

열린 탭과 미저장 버퍼는 별도 복구 기록에 저장합니다. 프로젝트를 다시 열면 복원하지만, 복구한 미저장 내용은 직접 확인하고 저장해야 합니다. 복구 기록은 250 ms 간격이므로 비정상 종료 직전의 마지막 입력까지 보장하지 않습니다. **Close without saving** 또는 프로젝트 전환 시 **Discard and open**을 명시적으로 선택하면 해당 초안은 버립니다.

## 실행 구성과 제한

터미널의 **Edit tasks**, Run and debug의 구성 버튼에서 `.witch/tasks.json`, `.witch/launch.json`을 생성·편집합니다. 기존 `.vscode/tasks.json`과 `.vscode/launch.json`의 지원되는 항목도 읽습니다. 프로젝트 명령은 자동 실행하지 않으며 실제 명령·경로를 확인한 뒤 실행합니다.

현재 디버거는 `.js/.cjs/.mjs` Node launch와 `.py` debugpy launch를 지원합니다. Python은 번들된 Pyright를 사용하고 `.venv`, `venv`, `env`, Conda와 시스템 Python 후보 중 프로젝트별 환경을 선택할 수 있습니다. 탐지는 실행 없이 이뤄지며 선택은 저장소 밖 앱 데이터에 저장됩니다. Python 디버깅은 선택 환경에 `debugpy`가 이미 설치되어 있어야 하며 자동 설치하지 않습니다. Rust는 시스템 `rust-analyzer` 또는 절대 `WITCH_RUST_ANALYZER_PATH`가 있을 때 활성화됩니다. Rust build script와 proc macro는 프로젝트를 열었다는 이유만으로 실행하지 않습니다. 탐지된 Python/Rust Task 역시 사용자가 명령·경로를 확인하고 승인해야 시작됩니다. TypeScript source map, attach, Rust 디버거, VS Code 확장 호스트(VSIX), 임의의 language-server 설치, Git UI는 아직 지원하지 않습니다. 상세 계약은 [Workspace Intelligence v0](docs/workspace-intelligence-v0.md), [Workspace Toolchains v0](docs/workspace-toolchains-v0.md), [Python Debugger v0](docs/python-debugger-v0.md)을 참고하세요.

Witch에서 파일·폴더를 옮기면 저장된 브레이크포인트도 경로를 따라 이동하며, 삭제한 경로의 브레이크포인트는 제거합니다. 실행 중인 디버거가 있으면 먼저 중지해야 파일을 이동·삭제할 수 있습니다.

## 안전 경계

- Renderer는 Node 접근이 없는 sandbox/context isolation과 제한된 preload IPC를 사용합니다.
- 편집·이동·삭제는 선택한 프로젝트 내부 경로만 받으며 심볼릭 링크·junction·Git 메타데이터를 차단합니다.
- 저장은 원본 해시를 확인한 뒤 완성된 임시 파일로 교체합니다. 다른 프로그램이 파일을 바꾸면 충돌을 알립니다.
- 삭제는 운영체제 휴지통으로 이동하며 복구할 수 있습니다.
- 암호화된 API 키는 공급자별 변경을 순서대로 저장해 동시 저장 시 서로 덮어쓰지 않습니다. 손상된 키 파일은 빈 파일로 교체하지 않고 오류를 알립니다. 키 삭제 후 이전 키를 담은 별도 백업은 남기지 않습니다.
- 언어 서버 제안은 텍스트 편집으로 검토합니다. 파일 생성·외부 명령 같은 부수효과를 가진 서버 명령은 실행하지 않으며, 프로젝트 로컬 TypeScript 플러그인도 자동 실행하지 않습니다.
- Agent 변경은 Git worktree가 아닌 **격리 복사본**에서 실행합니다. 복사본은 VM/컨테이너가 아닙니다.
- `.env`, 일반적인 인증 파일·개인 키·클라우드 자격증명 경로는 복사본에서 제외합니다. 파일 이름 기반의 보호이므로 임의의 소스에 포함된 모든 비밀을 탐지하는 것은 아닙니다.
- Codex 실행은 쓰기 범위와 네트워크 제한을 요청하고 외부 MCP/app 도구를 끕니다. 이는 시스템 전체 읽기 차단을 보장하지 않습니다. 신뢰하지 않는 코드를 위한 강한 격리가 필요하면 VM/컨테이너를 사용하세요.
- 승인된 파일만 원본에 반영하며 복구 사본·작업 기록을 앱 데이터에 남깁니다. 디스크 충돌을 임의로 덮어쓰지 않습니다.
- 중단된 Agent가 일부 파일을 수정했다면 프로세스 종료를 확인한 뒤 부분 변경을 검토할 수 있습니다. 완료되지 않은 작업이라는 경고가 표시되며 자동 적용하지 않습니다.
- 프로젝트 전환과 파일 변경은 동시에 실행하지 않습니다. 같은 앱 데이터로 중복 실행하면 기존 창을 표시해 설정·기록의 중복 쓰기를 막습니다.
- 터미널·프로젝트 작업·디버거는 사용자의 로컬 권한으로 실행합니다. 신뢰할 수 있는 프로젝트만 실행하세요.
- SSH 터미널도 Agent sandbox가 아니며 로컬 OpenSSH 설정의 `ProxyCommand` 같은 helper와 원격 명령은 사용자 권한으로 실행될 수 있습니다. 접속 전 대상과 실행 파일을 확인하세요.
- API 키는 Electron safeStorage로 암호화해 앱 데이터에 저장합니다. Renderer에서 저장된 키를 다시 읽을 수 없습니다.
- CUA는 선택적인 읽기 전용 창 관찰만 지원합니다. Agent의 클릭·타이핑·외부 앱 제어는 연결하지 않았습니다.

프로젝트 소스나 AI 작업 기록이 민감하다면 앱 데이터도 같은 수준으로 보호하세요. 기록과 복사본은 자동 삭제하지 않습니다.

구조 분석 기록은 작은 인덱스와 개별 그래프 파일로 저장됩니다. 이전 버전의 큰 인덱스는 원본 백업을 보존한 뒤 변환합니다. 인덱스가 손상되면 직전의 정상 저장본을 사용하고 손상된 원본도 보관합니다. 읽을 수 없는 기록을 빈 기록으로 덮어쓰지 않습니다.

## 검증 / 패키지

```sh
npm run test:all
npm run package:win
# macOS에서 실행: universal DMG + ZIP
npm run package:mac
```

`package:win`과 `package:mac`은 먼저 같은 메모리 안정화 build wrapper를 실행합니다. CI처럼 이미 검증된 최신 `out`이 있을 때만 내부용 `package:win:built` 또는 `package:mac:built`를 사용합니다.

Windows는 x64, macOS는 Intel/Apple Silicon universal을 대상으로 합니다. Electron 44 기반 macOS 최소 버전은 13입니다. macOS 패키지는 macOS 호스트에서 빌드·검증하는 [워크플로](.github/workflows/package-desktop.yml)를 포함합니다. macOS 프리뷰에는 인증서가 필요 없는 로컬 ad-hoc 서명을 요청하며 자동 공증 업로드는 끕니다. 이는 Apple Developer ID 서명·공증이 아니므로 정식 배포용으로 취급하지 마세요.

검증 스크립트는 실제 패키지의 언어 서버·로컬 worker·터미널 실행 파일·아이콘을 점검하고, 패키지 안의 파일이 현재 빌드 산출물과 바이트 단위로 같은지 확인합니다. 기본 테스트는 외부 AI를 호출하지 않습니다. 채팅 통합 테스트의 AI 부분은 로컬 프로토콜 테스트 대역이며 실제 격리 복사·diff·승인·적용·그래프 갱신은 앱 코드가 수행합니다.

```sh
npm run verify:package -- release/win-unpacked
npm run verify:package -- release/mac-universal/Witch.app
```

`WITCH_USER_DATA_DIR`에 기존의 절대 경로를 지정하면 기본 앱 데이터와 분리된 프로필로 실행합니다. 테스트는 임시 프로필과 테스트 소스만 사용합니다. `WITCH_PACKAGED_EXECUTABLE`을 지정하면 같은 E2E 테스트를 패키지 실행 파일에 수행합니다.

AI를 실제로 호출하는 선택적 검증은 `WITCH_LIVE_CODEX_TEST=1 npx tsx scripts/smoke-codex.ts`입니다. 실제 공급자 사용량을 소비하므로 일반 테스트에는 포함하지 않습니다.

`npm run benchmark -- 5000`으로 테스트 소스 5,000개를 생성해 분석·재분석·레이아웃 성능을 측정할 수 있습니다. 실제 저장소는 파일 크기·경로·디스크 상태에 따라 달라집니다. 아이콘은 저장소의 SVG 원본에서 `npm run icons`로 PNG/ICO/ICNS를 생성합니다.

설계 출처와 구현 경계는 [구현 현황](docs/implementation-status.md), 실제 실행 결과와 플랫폼별 남은 검증은 [검증 기록](docs/verification.md)을 참고하세요.
