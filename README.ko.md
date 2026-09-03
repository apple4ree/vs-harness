# Witch Desktop

[한국어](README.ko.md) · [English](README.md)

Witch는 코드를 파일 목록으로만 읽지 않고 **구조, 의미, Workflow, Behavior, 실제 관측 결과**로 탐색하면서 AI Agent 작업까지 이어가는 로컬 우선 Desktop ADE입니다.

현재 버전은 실제 프로젝트를 열어 편집·검색·실행·디버그할 수 있는 preview입니다. VS Code 전체 호환 제품은 아니며, Git UI와 원격 파일 Workspace 등은 아직 지원하지 않습니다.

## 제품 모델

Witch는 보통 서로 다른 도구로 나뉘는 세 가지 활동을 하나로 연결합니다.

```text
Source와 Language Service
  → 검증된 Architecture / Semantic / Behavior / Runtime Reading
  → 근거와 불확실성을 표시하는 Interactive Constellation
  → 범위가 제한된 Agent Context
  → 격리 변경, 검증, Diff Review, 선택 적용
  → 승인된 Source 재분석
```

Witch는 VS Code fork도, 하나의 Agent CLI를 감싼 skin도, AI가 그림만 생성하는
Viewer도 아닙니다. Monaco는 Editor를 제공하고, 로컬 Language Server가 IDE
Intelligence를 제공하며, 결정적 분석기가 versioned Reading을 만듭니다. Codex와
Claude Code는 교체 가능한 Agent Provider로 연결합니다.

| 계층                     | 현재 Witch                                                                                      | 의도적인 경계                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Code intelligence        | Python, Rust, TypeScript/JavaScript 구조·호출·Workflow·Behavior·Framework와 선택적 Runtime 근거 | Dynamic dispatch와 미지원 Framework magic은 명시적 공백으로 유지 |
| Interactive architecture | Summary-first System → Component → Workflow → Calls → Source 탐색과 evidence·provenance         | 화면 projection이 canonical validated graph를 대체하지 않음      |
| Local ADE                | Explorer, Monaco, Search, LSP, Task, Terminal, Node/Python Debug, File Watch, Settings          | VSIX host, Git UI, Remote File Workspace는 아직 없음             |
| Agent engineering        | Codex/Claude adapter, bounded context, isolated copy, verification journal, selective apply     | 격리 복사본은 review 경계이며 VM 보안 sandbox가 아님             |
| Computer use             | 선택적인 bounded observation                                                                    | Agent 클릭·타이핑은 비활성 상태                                  |

![Witch Runtime Trace Compare](docs/screenshots/product/runtime-trace-compare.png)

## 실제로 할 수 있는 일

### 1. 저장소를 열고 구조부터 읽기

1. **Open repository**에서 로컬 프로젝트를 선택합니다.
2. Witch가 파일을 실행하지 않고 정적으로 인덱싱합니다.
3. **Constellation**에서 Modules, Files, Meaning, Focus 관점을 전환합니다.
4. 노드나 연결을 선택하면 해당 판단의 파일·행·코드 근거를 확인할 수 있습니다.

편집 중인 파일에서 **Reveal in Constellation**을 누르면 해당 파일과 직접 연결된 import/imported-by 관계만 남깁니다. 과거 분석 결과는 **Before · Delta · After**로 비교할 수 있으며, 변경된 노드와 관계만 보여주고 영향도를 임의로 추정하지 않습니다.

분석 결과는 다음 계약으로 서로 분리됩니다.

| Reading                     | 실제 용도                                                   |
| --------------------------- | ----------------------------------------------------------- |
| `witch.architecture/v1`     | 파일·모듈·import 구조                                       |
| `witch.semantic/v1`         | System·Component·Workflow·Symbol 의미 계층                  |
| `witch.behavior/v1`         | 호출 인자 전달·반환·상태 접근·side effect 후보              |
| `witch.framework/v1`        | 명시적인 route·task·graph·spawn registration                |
| `witch.knowledge/v1`        | ADR/RFC 결정·package·dependency·프로젝트 설정               |
| `witch.graph-meta/v1`       | System에서 Symbol까지 단계적으로 확대하는 derived 탐색 계층 |
| `witch.graph-federation/v1` | 분리된 검증 Reading 사이의 Cross-repository Package Link    |
| `witch.runtime-trace/v1`    | 승인된 한 번의 Task 실행에서 관측한 구조 이벤트             |
| `witch.visual-quality/v1`   | 결정적인 graph projection geometry 검사                     |
| `witch.rendered-graph/v1`   | 실제 React Flow DOM/SVG의 paint 후 측정                     |
| `witch.graph-delivery/v1`   | Source·projection·rendered의 전달 승인 상태                 |

모든 Reading은 source revision, endpoint, evidence, provenance와 validation receipt를 유지합니다. `Verified`, `Inferred`, `Authored`, `Observed`는 합쳐서 하나의 사실처럼 저장하지 않습니다.

저장소를 분석한 뒤 **Intelligence → Knowledge**에서 ADR/RFC rationale, manifest에 선언된 npm/Python/Cargo package와 dependency, 알려진 설정 파일을 확인할 수 있습니다. Witch는 authored 결정과 inferred System 연결을 분리하며 임의 설정 값을 knowledge graph에 복사하지 않습니다.

**Intelligence → Map**은 전체 그래프를 한 번에 축소하지 않고 System → Community → Component → Workflow → Symbol 순서로 확대합니다. 실선 계층과 점선 집계 관계를 분리하며, derived fallback을 실제 architecture claim으로 취급하지 않습니다.

**Intelligence → Federation**은 활성 Reading과 최근 프로젝트의 최신 저장 Reading을 연결합니다. 저장소를 선택해 읽기 전용 System Map을 만들면 Witch는 정확히 일치하는 npm/Python/Cargo Package Identity만 연결하고 각 저장소 Revision을 보존합니다. 휴대 가능한 `.witch/federation.json` Key로 Provider Mapping을 작성할 수 있습니다. 중복 추론 Provider는 명시적으로 승인하기 전까지 Grill-me 질문으로 남고, 선택은 Source가 아니라 Revision-bound App-data Receipt로 기록됩니다. Approval History는 적용·오래됨·대체됨·현재 Map 밖·폐기 상태를 구분하며, 폐기할 때 History를 지우지 않고 Audit Event를 추가합니다.

### 2. 큰 Workflow를 요약부터 세부 순서까지 보기

**Meaning → Workflows**는 먼저 Workflow catalog를 보여줍니다. 하나를 열면 Graph 또는 위에서 아래로 흐르는 Sequence로 전환하고, branch-only 경로를 접거나 펼칠 수 있습니다.

![Workflow sequence](docs/screenshots/product/workflow-sequence.png)

현재 깊은 분석 대상은 TypeScript/JavaScript, Python, Rust입니다.

- TypeScript/JavaScript: TypeChecker로 확인한 direct identifier call과 타입 관계
- Python: 함수·클래스·async·decorator·import와 보수적인 내부 호출
- Rust: struct·enum·trait·impl·함수·mod/use와 보수적인 내부 호출
- Pyright 및 설치된 `rust-analyzer`: 진단·정의·참조·Outline·call hierarchy 보강

Workflow는 호출 위치와 명시적 문법을 사용해 `precedes`, `branches-to`, `retries`를 만듭니다. 정적 후보는 실제 실행 순서라고 주장하지 않고 provisional 상태로 남습니다.

### 3. Framework registration과 데이터 흐름 확인하기

**Meaning → Frameworks**는 현재 다음 source-only adapter를 사용합니다.

- Python: FastAPI, LangGraph, Celery
- TypeScript/JavaScript: Express, NestJS, Next.js
- Rust: Axum, Tokio

동적 path, lambda/property handler, 해석할 수 없는 endpoint는 관계로 조용히 승격하지 않고 exclusion diagnostic으로 남깁니다.

**Meaning → Behavior**에서는 direct call의 parameter binding, return, module state access와 framework relation을 탐색합니다. object field, 메시지·DB lineage, dynamic dispatch 전체를 해결한다고 주장하지 않습니다.

### 4. 정적 분석과 실제 실행을 비교하기

Runtime Trace는 기본적으로 꺼져 있습니다.

1. `.witch/tasks.json` 또는 지원되는 `.vscode/tasks.json`에 Task를 준비합니다.
2. **Meaning → Behavior → Optional Runtime Trace**에서 Task를 선택합니다.
3. 표시된 실제 명령과 작업 폴더를 확인하고 **Run & trace**를 승인합니다.
4. **Static / Observed / Compare**로 정적 관계와 관측 관계를 비교합니다.

프로젝트의 test harness나 instrumentation은 다음과 같은 한 줄 marker를 출력할 수 있습니다.

```text
WITCH_TRACE_V1 {"phase":"enter","path":"src/worker.ts","symbol":"run"}
WITCH_TRACE_V1 {"phase":"exit","path":"src/worker.ts","symbol":"run","outcome":"ok"}
```

Witch는 symbol ID, 부모 호출, 순서, duration, outcome만 저장합니다. 인자·반환값·환경값·일반 터미널 출력은 저장하지 않으며, 허용되지 않은 필드가 포함된 marker는 전체를 폐기합니다. 현재 source/semantic revision과 다른 오래된 Trace는 보존하되 그래프에 겹치지 않습니다.

자동 instrumentation, Debug launch trace, cross-process causal trace는 아직 없습니다.

### 5. 그래프에서 AI Agent 작업으로 이어가기

Meaning 카드의 **Add to Agent context**를 누르거나 카드 손잡이를 오른쪽 대화에 끌어놓습니다. Renderer가 보낸 label이나 path를 그대로 신뢰하지 않고, Main process가 현재 검증된 그래프에서 컨텍스트를 다시 해석합니다.

- **Ask**: 프로젝트를 변경하지 않는 질문
- **Change · isolated copy**: 별도 Workspace 복사본에서 변경

Change 실행은 다음 흐름을 거칩니다.

```text
Context → Plan → Isolated execution → Verification → Bounded repair
        → Checkpoint → Diff review → Selected apply → Re-analysis
```

AI의 “완료했습니다” 문장은 완료 근거가 아닙니다. Witch는 실제 변경 파일, immutable baseline, syntax/architecture verification receipt, checkpoint와 diff를 사용합니다. 실패 수리는 최대 2회이며 동일한 실패 fingerprint가 반복되면 중단합니다.

![Agent change review](docs/screenshots/product/agent-review.png)

검토 화면에서 적용할 파일만 선택할 수 있습니다. 원본이 외부에서 바뀌었으면 apply를 거부합니다. 미적용 review는 보관하고 다시 복원하거나 현재 baseline에서 child run으로 이어갈 수 있습니다.

### 6. 일반 ADE 작업하기

![Source editor and terminals](docs/screenshots/product/source-terminals.png)

- 파일·폴더 생성, 이름 변경, 이동, 휴지통 삭제
- Monaco 다중 탭, 저장·모두 저장, UTF-8/BOM/CRLF 보존
- 프로젝트 검색, 빠른 파일 열기, Outline
- 자동완성, hover, signature help, 진단, 정의·참조, review-only rename/code action
- Node.js와 Python/debugpy 디버깅
- 최대 8개 PTY, 여러 탭, Project Task 실행
- 프로젝트별 Python 환경 선택과 uv/Poetry/Ruff/Cargo Task 탐지
- 설정, 단축키, 3개 Witch 테마, 실행 코드 없는 snippet extension
- 파일 감시, 외부 변경 자동 반영, 미저장 충돌 diff
- 시스템 OpenSSH를 통한 대화형 원격 터미널

SSH는 현재 터미널만 원격입니다. Explorer, Editor, Search, LSP, Task, Debugger와 Agent는 열린 로컬 Workspace를 사용합니다.

## AI Provider 연결

**AI providers**에서 로컬 CLI 설치·로그인 상태 또는 API key 설정 상태를 확인합니다.

| Provider                 | 현재 사용 위치                        |
| ------------------------ | ------------------------------------- |
| 로그인된 Codex CLI       | Ask, 격리 Change, Semantic Composer   |
| 로그인된 Claude Code CLI | Ask, 격리 Change, Semantic Composer   |
| OpenAI API key           | Semantic Composer                     |
| Anthropic API key        | Semantic Composer                     |
| Rules only               | AI 호출 없는 결정적 Semantic Composer |

저장된 API key는 Electron `safeStorage`로 암호화되며 Renderer에서 다시 읽을 수 없습니다. 로컬 구조 분석, 편집, 검색은 AI 요청이 아닙니다. Agent나 AI Composer를 실행하면 선택된 bounded source context가 해당 Provider로 전달될 수 있습니다.

Codex와 Claude의 현재 adapter는 native resume/fork capability를 노출하지 않습니다. Provider가 지원한다고 확인되지 않은 control은 UI에 표시하지 않습니다.

## 시작하기

Node.js 22 이상과 npm이 필요합니다.

```sh
npm ci
npm run dev
```

처음에는 [작은 체험 프로젝트](examples/playground/README.ko.md)를 열면 별도 의존성 설치 없이 구조 분석, 카드 첨부와 검토 흐름을 확인할 수 있습니다.

운영 번들을 만들려면:

```sh
npm run build
```

Windows와 macOS 패키지 정의가 분리되어 있습니다.

```sh
npm run package:win
# macOS 13+ 호스트에서 universal DMG + ZIP
npm run package:mac
```

macOS preview는 ad-hoc 서명이며 Apple Developer ID 서명·공증을 완료한 정식 배포본이 아닙니다.

## 자주 사용하는 단축키

`Mod`는 Windows의 Ctrl, macOS의 Cmd입니다. Settings에서 앱 단축키를 바꿀 수 있습니다.

- `Mod+P`: 빠른 파일 열기
- `Mod+Shift+F`: 프로젝트 검색
- `Mod+S` / `Mod+Shift+S`: 저장 / 모두 저장
- `Mod+Shift+P`: 명령 팔레트
- `F2` / `F12` / `Shift+F12`: 이름 변경 / 정의 / 참조
- `Mod+.`: 코드 액션
- `Mod+K`, `Mod+I`: hover
- `Mod+Shift+Space`: signature help
- `F9` / `F5` / `Shift+F5`: breakpoint / debug / stop

## Project 설정

Witch는 지원 범위 안에서 `.witch/tasks.json`, `.witch/launch.json`, `.vscode/tasks.json`, `.vscode/launch.json`을 읽습니다. 프로젝트를 열었다는 이유만으로 Task, build, test, migration 또는 shell 초기화 스크립트를 실행하지 않습니다.

Rust LSP는 시스템 `rust-analyzer` 또는 절대 경로 `WITCH_RUST_ANALYZER_PATH`를 사용합니다. Rust build script와 proc macro는 자동으로 활성화하지 않습니다. Python debugging은 선택한 환경에 `debugpy`가 이미 설치되어 있어야 하며 자동 설치하지 않습니다.

## Evaluation과 검증

Witch는 외부 벤치마크 코드를 저장소에 복사하지 않고, 어떤 데이터·버전·지표·실행 경계로 성능을 측정했는지를 공개합니다. [제품 벤치마크](docs/evaluation/product-benchmark.ko.md)는 분석 충실도, 설명 사용성, IDE/ADE Workflow, Agent Harness, 안전성과 규모를 하나의 점수로 숨기지 않고 분리합니다. 세부 기준은 [Evaluation 문서](docs/evaluation/README.ko.md), [재현 절차](docs/evaluation/reproducibility.ko.md), [한계](docs/evaluation/limitations.ko.md)에서 확인할 수 있습니다.

제품 Suite는 코드 구조 탐색기, IDE, ADE, Agent Harness와 Computer-use Agent를
구분합니다. 비교표의 근거도 문서상 `documented`, 직접 재현한 `observed`, 같은
Task로 실행한 `measured`로 표시합니다. 제품 유형 밖의 기능은 `not-applicable`로
남기지만, 지원한다고 주장한 기능의 실패는 `fail`로 보존합니다.

현재 검증 수와 2026-09-02 source checkpoint에 고정된 Benchmark 결과입니다. Call graph의 micro·macro 및 development·holdout 결과는 서로 합산하지 않습니다.

| 검증 축                   |                        결과 | 해석 경계                                                         |
| ------------------------- | --------------------------: | ----------------------------------------------------------------- |
| 단위·통합 테스트          |                  173 passed | 실제 filesystem·LSP·debugger·PTY와 로컬 Provider test double 포함 |
| Electron E2E              |                   25 passed | 임시 Workspace·profile에서 실제 UI와 IPC 실행                     |
| SWARM-CG Python           |            Scoped F1 87.64% | development micro; oracle edge coverage 17.99%                    |
| PyAnalyzer macro C        |            Scoped F1 58.20% | holdout macro; oracle edge coverage 31.68%                        |
| Witch Rust v1             |                   F1 93.75% | development micro; 별도 Rust macro holdout은 아직 없음            |
| DyPyBench 5-project pilot | Dynamic agreement F1 62.73% | upstream test에서 관측된 호출과의 합의이며 정적 정답 전체가 아님  |

상세 수치와 프로젝트별 결과는 [Call-graph result](docs/evaluation/results/callgraph-2026-09-02.ko.md), 제품 검증 범위는 [Product-quality result](docs/evaluation/results/product-quality-2026-09-02.ko.md)에 고정되어 있습니다.

기본 테스트는 외부 AI를 호출하거나 대상 프로젝트 코드를 실행하지 않습니다.

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

E2E는 임시 프로젝트·프로필에서 실제 Editor, LSP, PTY, Debugger, 분석, 격리 diff와 Runtime Trace UI를 실행합니다. Provider protocol만 로컬 test double을 사용합니다. 소스 테스트 통과가 현재 commit의 Windows/macOS package 생성·서명·공증을 뜻하지는 않습니다.

동일 fixture에서 Provider 결과를 비교하는 offline evaluation:

```sh
npm run eval:offline
```

Fake Provider 결과는 결정적이며, replay는 Provider나 command를 다시 실행하지 않습니다. Live evaluation은 코드의 `allowLive`, 명시 승인, `WITCH_LIVE_EVAL=1`을 모두 요구하며 기본 CI에서 실행하지 않습니다.

분석 benchmark:

```sh
npm run benchmark:repository
npm run benchmark:behavior
npm run benchmark:frameworks
npm run benchmark:callgraph:rust
npm run benchmark:product:check
npm run benchmark:composer
npm run benchmark:comprehension:check
npm run capture:visual-matrix -- path/to/project test-results/visual-matrix
```

[Graph 전달 protocol](docs/evaluation/visual-validation.ko.md)은 결정적 layout과
실제로 paint된 DOM/SVG를 모두 검사합니다. 이후 candidate가 유효하지 않으면
마지막 검증 화면을 덮어쓰지 않고 보존합니다. Composer 첫 candidate는
Provider별로 동결하며, 사람 이해도 결과는 이름을 기록한 reviewer가 고정 과제를
마칠 때까지 `pending`으로 유지합니다.

외부 call-graph 평가는 `benchmarks/callgraph`의 manifest와 `scripts/benchmark-callgraph.ts`를 사용합니다. 저장소에는 외부 소스·동적 trace·로컬 절대 경로·blind-holdout 상세 실패를 커밋하지 않습니다.

Call-graph corpus 외에도 SWE-bench, IDE-Bench, Terminal-Bench, OSWorld,
AgentDojo를 적용 가능한 축에 mapping했습니다. Adapter가 mapping되었다고 측정
결과가 생기는 것은 아니며, live Agent·container·VM·CUA 평가는 계속 명시적
opt-in으로만 수행합니다.

## 중요한 안전 경계

- Terminal, Task, Debugger, SSH는 사용자 권한으로 실행되며 Agent sandbox가 아닙니다.
- Agent Workspace copy는 원본 분리와 review를 위한 것이며 VM/container 보안 경계가 아닙니다.
- Git worktree와 Git stage/commit/branch UI는 아직 구현하지 않았습니다.
- CUA는 현재 선택적인 bounded observation만 연결되어 있고 Agent 클릭·타이핑은 허용하지 않습니다.
- TypeScript source map, Rust debugger, VSIX extension host, Remote file Workspace는 아직 없습니다.
- `.env`, 알려진 credential/private-key 경로는 Agent 복사본에서 제외하지만 소스에 섞인 모든 secret을 탐지한다고 보장하지 않습니다.
- 앱 데이터에는 분석 Reading, Agent journal, checkpoint, review와 Runtime Trace가 남습니다. 자동 삭제하지 않습니다.

세부 구현 범위와 비지원 사항은 [구현 현황](docs/implementation-status.ko.md), [Engineering Core 명세](docs/engineering-core-spec-v0.ko.md), [Graph Intelligence v1 명세](docs/graph-intelligence-v1.ko.md), [Architecture Knowledge v1 명세](docs/architecture-knowledge-v1.ko.md), [Multi-resolution Meta Graph v1 명세](docs/multi-resolution-meta-graph-v1.ko.md), [다중 저장소 Federation v1 명세](docs/multi-repository-federation-v1.ko.md), [Runtime Trace·Evaluation](docs/evaluation-runtime-trace.ko.md)을 참고하세요. 문서의 언어판 관리 원칙은 [문서 언어 정책](docs/documentation-policy.ko.md)에 고정되어 있습니다.

## 프로젝트 상태

Witch는 현재 개발 preview입니다. 소스에서 실행하고 테스트할 수 있지만, VS Code 호환성이나 상용 배포 안정성을 주장하지 않습니다. 특히 대형 monorepo, dynamic dispatch 중심 프로젝트, unsupported framework와 원격 Workspace는 제한을 먼저 확인해야 합니다.
