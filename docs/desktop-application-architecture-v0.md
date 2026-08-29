# Witch Desktop — 애플리케이션 아키텍처 v0

이 문서는 초기 설계 기록입니다. 아래의 Git worktree·Claude 어댑터·분석 Worker 등은 현재 구현을 의미하지 않습니다. 최신 구현 범위와 검증 결과는 [구현 현황](implementation-status.md)을 기준으로 확인하세요.

작성일: 2026-08-28<br>
상태: MVP 구현 진행 중 — Milestone 3 Codex 읽기 전용 분석 연결 완료<br>
대상: Windows 우선, 이후 macOS/Linux 확장

## 1. 결정 요약

Witch는 **Electron + React + TypeScript**로 시작한다. 첫 릴리스에서는 로컬 저장소와 설치된 Codex/Claude Code를 사용하며, 별도 클라우드 백엔드나 자체 모델 계정은 요구하지 않는다.

Electron을 선택한 이유는 Windows에서 Git, PowerShell, `node-pty` 기반 터미널, 설치된 CLI 에이전트, Monaco 편집기를 한 앱에서 빠르게 통합하기 위해서다. 더 작은 바이너리나 더 엄격한 Rust 경계가 중요한 단계에는 Tauri 재검토가 가능하지만, 첫 제품은 에이전트와 PTY 통합의 구현 위험을 낮추는 것이 우선이다.

배포는 Electron Builder를 사용한다. Windows에는 x64 NSIS 설치 파일을 만들고, macOS에는 Intel과 Apple Silicon을 함께 포함한 universal DMG/ZIP을 만든다. macOS는 macOS runner에서만 build하며, 외부 배포 전에는 Apple Developer ID 서명과 notarization이 필요하다. CI의 초기 workflow는 publish하지 않고 unsigned artifact만 보관한다.

| 영역 | 초기 선택 | 책임 |
| --- | --- | --- |
| Desktop shell | Electron | 창·메뉴·업데이트·권한 경계 |
| UI | React + TypeScript | Witch 작업공간, 그래프, 파일, Inspector, 터미널 |
| 코드 편집 | Monaco Editor | 파일 열기·읽기·편집·diagnostics 표시 |
| 통합 터미널 | xterm.js + node-pty | PowerShell, Codex, Claude Code, test 세션 |
| Git/worktree | `git` CLI wrapper | repo 열기, 상태, diff, worktree 생성/삭제 |
| 코드 인텔리전스 | 별도 Worker Process | 파일/설정/import 그래프, snapshot 저장 |
| 저장소 | Versioned app-data JSON → SQLite + artifacts | 사용자 설정, 실행 메타데이터, analysis snapshot |
| Codex | App Server adapter | thread, turn, approval, streaming event 통합 |
| Claude Code | PTY adapter | 설치된 CLI 실행과 출력/상태 표준화 |
| CUA Driver | Optional MCP adapter | 외부 앱·창 관찰과 승인 기반 Computer Use |

## 2. 앱 경계와 프로세스 모델

```text
┌──────────────────────────── Witch Desktop (Electron) ───────────────────────────┐
│ Renderer process (React)                                                        │
│  Workspace · graph · files · AI Inspector · xterm view · diff                   │
│                  │ typed, allow-listed IPC only                                 │
│ Preload bridge  │                                                               │
│                  ▼                                                               │
│ Main process                                                                    │
│  Workspace manager · Git/worktree manager · PTY manager · permission broker    │
│  Agent runtime registry · SQLite repository · process lifecycle                 │
│       │                         │                            │                  │
│       ▼                         ▼                            ▼                  │
│ Code Intelligence Worker    Codex App Server (stdio)      Claude Code PTY       │
│ static scan / snapshots     JSONL JSON-RPC                terminal stream       │
│       │                         │                            │                  │
└───────┼─────────────────────────┼────────────────────────────┼──────────────────┘
        ▼                         ▼                            ▼
    local worktree           installed Codex CLI           installed Claude CLI
```

### Renderer

Renderer는 시스템 권한을 갖지 않는다. `contextIsolation`을 켜고 Node integration은 끈다. 파일 접근·명령 실행·Git·PTY·에이전트 연결은 오직 preload가 노출한 허용 목록 IPC를 통해서만 요청한다.

파일·폴더 생성, 이동, 이름 변경, 삭제도 Main process의 workspace 경계를 통과한다. 모든 경로는 열린 workspace의 상대 경로여야 하며 workspace root 밖으로 나갈 수 없다. 새 항목의 부모 폴더는 이미 존재해야 하고, symbol link는 이 UI에서 변경하지 않는다. 삭제는 Renderer의 확인 대화상자와 Main process의 명시적 `confirmed` 값이 모두 필요하며, root 삭제는 허용하지 않는다.

### Main process

Main process는 아래 리소스의 소유자다.

- 열린 저장소와 worktree 경로
- Git 실행과 diff/branch 상태
- PTY 생성, 입력 전달, 출력 fan-out, 종료
- Codex App Server 및 Claude Code 하위 프로세스
- 파일 쓰기와 저장 경로 검증
- 사용자 승인 대기와 권한 정책

### Code Intelligence Worker

분석은 Electron main process를 막지 않는 별도 Node worker process로 둔다. Worker는 읽기 전용으로 시작하며 다음 산출물을 냄다.

1. 파일 인덱스: 경로, 언어, 크기, hash, `.gitignore` 상태
2. 사실 그래프: import/export, package, entrypoint, config, route 단서
3. 후보 그래프: 모듈 군집과 중요도
4. snapshot artifact: `commit SHA + analyzer version + timestamp`에 고정된 JSON

AI는 이 결과를 설명/계층화/흐름 후보로 보강할 뿐, 사실 그래프를 직접 덮어쓰지 않는다.

## 3. Codex와 Claude Code 런타임

### 공통 `AgentRuntime` 계약

```ts
type AgentRuntimeId = "codex" | "claude-code";
type PermissionProfile = "analysis-readonly" | "workspace-edit" | "full-terminal";

interface AgentRuntime {
  id: AgentRuntimeId;
  detect(): Promise<{ installed: boolean; version?: string }>;
  startSession(input: {
    worktreePath: string;
    profile: PermissionProfile;
    task: string;
  }): Promise<{ sessionId: string }>;
  send(sessionId: string, message: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  subscribe(sessionId: string, listener: (event: AgentEvent) => void): () => void;
}
```

`AgentEvent`는 모델에 상관없이 `message`, `command`, `file-change`, `approval-request`, `status`, `error`로 정규화한다. UI는 이 공통 이벤트만 보고, 제공자별 원본 로그는 Terminal 탭에 보존한다.

### Provider 연결과 자격증명

Witch는 독립 ADE이므로 특정 AI 제공자에 종속되지 않는다. `AI providers` 화면은 두 종류의 연결을 분리한다.

| 연결 방식 | 예시 | Witch의 처리 |
| --- | --- | --- |
| CLI 계정 재사용 | Codex CLI, Claude Code | 설치·버전만 감지하고, 로그인 token은 각 CLI가 소유한다. |
| 직접 API | OpenAI API, Anthropic API | 사용자가 입력한 key는 Windows `safeStorage`(DPAPI)로 암호화한 뒤 app-data에 저장한다. UI에는 저장 여부와 수정 시간만 다시 노출한다. |

직접 API 실행 adapter는 Provider 설정과 분리된 다음 milestone이다. 모든 API 호출은 Electron main process에서만 실행하며, renderer에는 key를 다시 전달하지 않는다.

### Codex adapter — 기본 구현 경로

Codex는 App Server를 사용한다. OpenAI 공식 문서에 따르면 App Server는 인증, 대화 이력, 승인, 스트리밍 에이전트 이벤트가 필요한 자체 제품 통합용 인터페이스이며, 기본 transport는 표준 입출력 JSONL이다. [OpenAI Docs — Codex App Server](https://learn.chatgpt.com/docs/app-server)

초기 lifecycle:

```text
spawn "codex app-server"
  → initialize / initialized
  → thread/start (worktree cwd + profile)
  → turn/start (분석 또는 작업 요청)
  → item/started · item/completed · agent delta · approval 이벤트 수신
  → turn/completed 또는 turn/interrupt
```

- `stdio`를 기본으로 쓴다. 로컬 앱에 가장 단순하고, 원격 노출을 만들지 않는다.
- App Server의 WebSocket transport는 공식 문서에서 experimental/unsupported라고 명시하므로 MVP에서 사용하지 않는다.
- 앱은 설치된 Codex 버전에서 TypeScript/JSON Schema를 생성해 해당 버전의 protocol 계약을 동기화한다.
- 분석 run은 `analysis-readonly` 프로파일로 시작해 쓰기/네트워크를 기본 차단한다. UI는 에이전트의 승인 요청을 자체 확인 대화상자로 명시적으로 보여 준다.

현재 MVP는 이 경로를 실제로 연결했다. 선택한 workspace마다 `thread/start`와 `turn/start`를 사용한 ephemeral 분석 thread를 만들고, `agentMessageDelta`와 `turn/completed`를 Inspector로 streaming한다. thread에는 `sandbox: "read-only"`, turn에는 `{ type: "readOnly", networkAccess: false }`, 승인에는 `untrusted`를 적용한다. 서버가 별도 action approval을 요청하면 Witch가 거절 응답을 보내므로, 분석 화면이 권한 상승 대기 상태로 남지 않는다.

### Claude Code adapter — 호환성 구현 경로

Claude Code는 우선 PTY에 실행한다. 초기에는 CLI의 표준 입출력과 exit status를 공통 이벤트로 변환하고, 완전한 도구 단위 추적이 가능한 공식/안정 프로토콜이 제공될 경우 별도 adapter를 추가한다.

이 차이를 숨기지 않는다. Witch UI에는 adapter의 event fidelity를 표시한다.

- Codex App Server: `structured`
- Claude Code PTY: `terminal-observed`

### CUA Driver adapter — 외부 컴퓨터 사용

CUA Driver는 Witch의 코드 분석 엔진이 아니라 **선택적인 OS 자동화 도구 제공자**다. Witch는 `cua-driver mcp --direct`를 stdio MCP 프로세스로 실행하며, Renderer가 Driver에 직접 접근하지 않도록 Main process가 연결과 lifecycle을 소유한다.

초기 구현은 `bounded-observe` 프로파일만 제공한다. 사용자가 UI에서 명시적으로 연결해야 시작하며, Witch가 생성한 capability manifest는 `list_windows`, `list_apps`, 접근성·창 상태 등 관찰 도구만 허용한다. 클릭·키 입력·클립보드·앱 실행·프로세스 종료·브라우저 조작은 manifest에서 차단한다.

```text
Witch Renderer → allow-listed IPC → Main / CUA MCP client → cua-driver (bounded) → Windows desktop
```

Codex/Claude가 CUA를 통해 실제 조작을 할 수 있게 하는 `computer-action` 프로파일은 별도 승인 UI, 액션별 audit log, 허용 앱/창 범위, 즉시 revoke를 구현한 뒤에만 추가한다. 관찰 세션은 앱 종료 시 함께 종료한다.

## 4. 통합 터미널 설계

각 탭은 하나의 `TerminalSession`이다.

```ts
type TerminalSession = {
  id: string;
  kind: "shell" | "codex" | "claude-code" | "test";
  worktreeId: string;
  cwd: string;
  shellOrCommand: string;
  status: "starting" | "running" | "exited";
};
```

- PTY는 main process에서만 생성한다.
- Renderer의 xterm은 입력을 IPC로 보내고, 출력 이벤트를 구독한다.
- 새 Agent Run은 해당 worktree에 묶인 Codex/Claude 터미널 탭을 자동 추가한다.
- 사람의 shell 탭은 같은 worktree를 선택할 수 있지만 Agent Run의 권한 정책을 승격시키지 않는다.
- 선택된 terminal line의 파일 경로/`file:line` 패턴은 클릭해 Source로 이동할 수 있다.

## 5. Git과 worktree

### Worktree는 격리 경계

| 사용자 행동 | Witch 동작 |
| --- | --- |
| 기존 repo 열기 | Git root와 기본 worktree를 등록 |
| 에이전트에 구현 작업 위임 | 새 branch + worktree 생성, 해당 위치에서 Agent Run 시작 |
| 구조 분석 | 선택 worktree의 commit 기준 snapshot 생성 |
| 검토 | 기본 branch와 agent worktree의 diff/snapshot을 비교 |
| 병합 | MVP에서는 Git CLI 또는 사용자의 기존 흐름으로 수행; 자동 merge 없음 |

worktree 삭제는 해당 worktree의 활성 PTY/Agent Run이 모두 종료된 뒤에만 가능하다. 삭제 전 명확한 대상 경로와 Git 상태를 확인한다.

## 6. 로컬 데이터 모델

앱 메타데이터는 프로젝트 원본 소스와 분리한다.

현재 MVP는 `{app-data}/state/witch-state.json`에 versioned JSON을 저장한다. 최근 프로젝트, 정적 구조 snapshot(Commit·analyzer version 포함), Codex 작업 실행 상태와 최종 요약을 최대 개수 제한과 함께 보관한다. 빠른 파일 열기는 메모리의 안전한 파일 목록을 사용하고, 텍스트·심볼 검색은 요청 시 지원되는 소스 파일만 크기와 결과 개수 상한 안에서 읽는다. 이 형태는 설치·업데이트가 간단하고 renderer에 DB 권한을 주지 않는다. 지속 검색 인덱스·심볼·diff·다중 worktree 관계가 늘어나는 다음 단계에서 같은 domain schema를 SQLite tables와 JSON artifact로 이전한다.

```text
{app-data}/Witch/
 ├─ witch.sqlite                 # repositories, worktrees, sessions, settings
 ├─ snapshots/{repo-id}/         # analysis graph JSON, index manifests
 ├─ terminal-logs/{session-id}/  # 선택적 로컬 로그
 └─ cache/                       # 재생성 가능한 parser/cache 데이터
```

저장 원칙:

- 사용자 소스 파일과 Git 설정을 앱이 임의 변경하지 않는다.
- 원격 전송 여부와 무관하게 snapshot에는 commit SHA와 analyzer version을 넣는다.
- API 키나 bearer token은 SQLite에 저장하지 않는다. OS credential store 또는 연결된 CLI의 기존 인증 상태를 쓴다.
- `Clear project data`는 snapshot, logs, index만 삭제하며 저장소와 worktree를 삭제하지 않는다.

## 7. IPC API v0

Renderer는 다음 capability만 호출한다. 모든 request에는 `workspaceId` 또는 `worktreeId`가 필요하고, main process가 등록된 경로와 비교 검증한다.

```ts
window.witch = {
  workspace: { openRepo, list, close },
  worktrees: { list, create, status },
  files: { list, read, save },
  git: { status, diff },
  terminal: { create, write, resize, close, onData },
  analysis: { start, getSnapshot, compareSnapshots, onProgress },
  agents: { detect, start, send, interrupt, approve, onEvent },
};
```

금지 사항:

- renderer가 임의 shell command나 임의 절대경로를 main process로 전송하는 API
- renderer가 App Server credential/token을 직접 읽는 API
- UI 상태만으로 권한이 승인되었다고 가정하는 API

## 8. 보안과 권한 UX

| 프로파일 | 파일 | 명령 | 네트워크 | 용도 |
| --- | --- | --- | --- | --- |
| `analysis-readonly` | 읽기 | 분석용 허용 명령만 | 기본 차단 | 구조 분석, 문서화 |
| `workspace-edit` | 지정 worktree 수정 | 승인된 build/test | 기본 차단 | 기능 구현, 수정 |
| `full-terminal` | 사용자 범위 | 사용자가 직접 입력한 명령 | 사용자 선택 | 수동 터미널 |

- 모든 Agent Run 시작 화면은 worktree, 프로파일, 네트워크, 예상 파일 쓰기 범위를 보여 준다.
- 단일 실행의 권한 승인은 다른 Agent Run 또는 터미널 탭에 전파되지 않는다.
- 외부 GitHub/웹 조사 커넥터는 Phase 2이며, 초기값은 off다.
- Electron security checklist: `contextIsolation`, sandboxed renderer, CSP, navigation/새 창 차단, IPC 입력 검증, 안전한 external URL open을 적용한다.

## 9. 초기 모노레포 구조

```text
witch/
 ├─ apps/
 │   └─ desktop/
 │       ├─ src/main/          # Electron main, IPC, PTY, Git, process lifetime
 │       ├─ src/preload/       # typed bridge only
 │       └─ src/renderer/      # React UI and Witch theme
 ├─ packages/
 │   ├─ contracts/             # IPC, graph, session, event schemas
 │   ├─ domain/                # repository/worktree/snapshot state machine
 │   ├─ code-intelligence/     # scan/import graph/normalization/validation
 │   ├─ agent-runtime/         # common contract and runtime registry
 │   ├─ agent-codex/           # App Server JSONL client
 │   └─ agent-claude-code/     # PTY based adapter
 ├─ fixtures/                  # 작은 JS/TS/Python repository fixtures
 ├─ docs/
 └─ tooling/
```

`contracts`와 `domain`은 Electron 의존성을 갖지 않는다. 따라서 향후 CLI, headless analyzer, 또는 다른 desktop shell에서도 재사용할 수 있다.

## 10. 구현 순서

### Milestone 0 — 앱 셸

- Electron/Vite/React/TypeScript 앱과 Witch design tokens
- context-isolated preload, 빈 typed IPC bridge
- repository 선택 및 최근 프로젝트 목록

### Milestone 1 — 로컬 작업공간

- Git root 감지, 파일 트리, Monaco 읽기/저장
- PowerShell PTY + xterm 탭
- Git status/diff 표시

현재 구현: 선택 workspace 안에서만 동작하는 Explorer tree, 다중 파일 tab, Monaco 기반 편집, dirty 표시, Ctrl/Cmd+S 저장을 제공한다. save IPC는 existing file·workspace boundary·1.5MB 편집 한도를 검증한다.

### Milestone 2 — 구조 인텔리전스

- JS/TS import scanner, snapshot JSON, React Flow 그래프
- 노드 ↔ 파일 ↔ 근거 이동
- SQLite에 workspace/snapshot metadata 저장

### Milestone 3 — Codex 분석

- Codex detect와 App Server stdio client
- thread/turn lifecycle, streamed item UI, 읽기 전용 분석 요청
- 구조화 결과 검증 및 Inspector 표시

### Milestone 4 — Agent worktrees

- worktree 생성, Codex 편집 run, PTY 연결
- before/after architecture snapshot 비교
- Claude Code PTY adapter

## 11. 첫 릴리스 완료 조건

1. Windows에서 로컬 Git repo를 열 수 있다.
2. PowerShell과 Codex가 각각 독립 terminal tab으로 실행되며 output이 유실되지 않는다.
3. JS/TS repo의 import 그래프에서 노드를 클릭해 정확한 파일을 연다.
4. Codex `analysis-readonly` run의 상태/메시지/승인 이벤트가 UI에 표시된다.
5. AI가 제안한 그래프 관계는 실제 파일/심볼 근거를 검사한 뒤에만 verified로 보인다.
6. Agent 구현 run은 전용 worktree에서 실행되고 기본 worktree를 수정하지 않는다.
7. 소스·snapshot·로그가 사용자의 명시적 설정 없이 외부로 업로드되지 않는다.

## 12. 구현 전 마지막 확인 사항

- Windows 최소 지원 버전과 ARM64 지원 범위
- 처음 포함할 편집 범위: Monaco 기반 전체 편집기 또는 Source viewer 우선
- Codex와 Claude Code를 동시에 MVP에 넣을지, Codex App Server로 먼저 종단간 흐름을 완성할지
- 코드 인텔리전스에서 JS/TS만 우선 지원할지, Python을 첫 scanner부터 함께 포함할지
