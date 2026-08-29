# 독립형 AI-native ADE — 제품 설계 v0

이 문서는 초기 제품 설계 기록입니다. 현재 구현과 향후 계획을 구분하려면 [구현 현황](implementation-status.md)을 확인하세요. Git 관리와 Claude 어댑터는 이번 구현 범위에서 제외했습니다.

작성일: 2026-08-28<br>
상태: 초기 제품/기술 설계

## 1. 제품 정의

**목표:** Codex와 Claude Code 같은 사용자의 기존 코딩 에이전트를 실행·관리하면서, 코드베이스의 구조와 변경 영향을 사람이 직접 탐색할 수 있게 하는 독립 데스크톱 ADE(Agent Development Environment)를 만든다.

이 제품은 특정 에이전트나 기존 IDE의 확장 기능이 아니다. 에이전트 실행, Git worktree, 편집/터미널, 코드 인텔리전스 그래프를 하나의 로컬 우선 작업공간에 결합한다.

### 해결하려는 문제

- 에이전트가 여러 파일을 바꾸면 개발자가 시스템 수준의 영향을 파악하기 어렵다.
- 대규모/낯선 저장소에서는 파일 트리와 채팅만으로 모듈 경계와 요청 흐름을 복원하기 어렵다.
- Codex, Claude Code 등 에이전트마다 세션·결과·권한·작업공간이 분절된다.
- 단순 Mermaid 문서는 생성 후 곧바로 낡고, 실제 소스와 연결되지 않는다.

### 제품 한 문장

> 에이전트가 코드를 바꾸는 과정과 사람이 코드베이스를 구조적으로 검증하는 과정을 연결하는, 로컬 우선·모델 중립 ADE.

## 2. 사례 조사와 설계 반영

| 사례 | 관찰한 강점 | 우리 제품에 반영할 원칙 |
| --- | --- | --- |
| [Orca](https://github.com/stablyai/orca) | 여러 CLI 에이전트, worktree 격리, 터미널과 diff 검토를 한 공간에서 관리 | 작업 단위는 **Agent Run + Worktree**로 모델링하고, 결과를 비교/병합할 수 있게 한다. |
| [Cursor](https://docs.cursor.com/background-agent) | 에이전트의 비동기 실행 상태를 UI에서 추적하고 필요 시 후속 지시 | 긴 분석과 구현은 백그라운드 작업으로 실행하되, 권한·네트워크·데이터 보존 상태를 사용자가 보게 한다. |
| [Zed](https://zed.dev/docs/ai/agents) | 내장 에이전트·외부 에이전트·터미널 스레드를 별도 경로로 제공 | 런타임을 통일하지 않는다. `Codex`, `Claude Code`, 이후 ACP/CLI 런타임을 어댑터로 수용한다. |
| [CodeBoarding](https://github.com/Codeboarding/CodeBoarding) | 정적 분석과 LLM 의미 해석을 결합한 인터랙티브 구조 다이어그램 | 그래프의 사실 관계는 정적으로 수집하고, AI는 모듈 명명·군집화·설명을 맡는다. 모든 AI 관계에는 소스 근거를 남긴다. |
| [OpenCode](https://github.com/anomalyco/opencode) | 공급자 중립 및 클라이언트/서버 분리 | UI, 에이전트 런타임, 분석 서비스를 독립 경계로 분리해 특정 제공자 교체 비용을 낮춘다. |

Codex는 단순 터미널 래핑뿐 아니라 제품 내 깊은 통합을 위한 App Server 프로토콜을 제공한다. 공식 문서는 인증, 대화 기록, 승인, 스트리밍 이벤트가 필요한 제품 통합에 App Server를 사용하도록 안내한다. [OpenAI 공식 문서](https://learn.chatgpt.com/docs/app-server)

## 3. 제품 원칙

1. **로컬 우선:** 소스, 분석 결과, 인덱스, 대화 로그는 기본적으로 사용자 컴퓨터에 둔다. 외부 웹 조사와 원격 에이전트 실행은 명시적 선택이다.
2. **모델 중립:** 제품은 모델 구독을 판매하거나 자체 모델에 잠기지 않는다. 사용자가 로그인한 Codex/Claude Code 등의 런타임을 연결한다.
3. **근거 기반 그래프:** 모든 노드와 엣지는 파일, 심볼, import, 라우트, 스키마, 설정 파일, 에이전트 분석 결과 중 하나 이상으로 추적할 수 있다.
4. **그래프는 탐색 인터페이스:** 보기 좋은 한 장의 그림보다, 클릭해 코드·근거·변경 내역으로 들어가는 탐색성을 우선한다.
5. **안전한 자동화:** 분석은 기본 읽기 전용이다. 수정, 명령 실행, 네트워크 접근, 원격 push는 에이전트별/작업별로 권한을 보인다.

## 4. 핵심 개념 모델

```text
Repository
 ├─ Worktree (기본 브랜치 또는 에이전트별 격리 작업공간)
 │   ├─ Agent Run (Codex / Claude Code / 기타)
 │   ├─ Analysis Snapshot (특정 commit + 설정 기준 그래프)
 │   └─ Change Set (diff, 테스트, 승인 기록)
 └─ Project Knowledge (문서/웹 근거, 아키텍처 주석, 사용자 정의 경계)
```

- **Repository:** 원격 URL이 아니라 로컬 clone을 진실의 원천으로 삼는다.
- **Worktree:** 독립 실행/분석/비교의 단위다. 여러 에이전트가 같은 파일을 경쟁적으로 수정하지 않게 한다.
- **Analysis Snapshot:** commit SHA와 분석 설정에 고정된 그래프다. 재현 및 before/after 비교가 가능해야 한다.
- **Project Knowledge:** 코드에서 확정할 수 없는 도메인 설명·ADR·공식 문서를 URL과 발췌 근거로 연결한다.

## 5. MVP 경험 설계

### 주요 사용자 흐름

1. 사용자가 로컬 Git 저장소를 연다.
2. 앱이 읽기 전용으로 파일 트리, 언어, 빌드 설정, import/심볼/라우트 관계를 스캔한다.
3. 사용자가 `구조 분석`을 누르고 Codex 또는 Claude Code 런타임을 고른다.
4. 에이전트는 정적 분석 산출물을 바탕으로 시스템·모듈·외부 연동·주요 흐름을 설명하는 구조화된 그래프를 생성한다.
5. 그래프에서 `결제 API` 같은 노드를 클릭하면 책임, 근거 파일, 인접 의존성, 관련 실행/변경 내역이 보이고 파일을 연다.
6. 에이전트가 작업을 마치면 `변경 전/후` 그래프를 겹쳐 보고 새 의존성, 사라진 경계, 영향받은 흐름을 확인한다.

### 첫 화면 레이아웃

```text
┌ Project / Worktrees ┬──────── Code / Architecture Canvas ────────┬ Agent Runs ┐
│ repo, branch         │  graph · source · diff 탭                   │ 상태, 승인  │
│ snapshots            │  노드 클릭 → 근거/파일/흐름                │ 대화, 로그  │
├──────────────────────┴────────────────────────────────────────────┴───────────┤
│ Integrated terminal · 테스트 결과 · 작업 이벤트                                  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### MVP에 포함

- Windows 우선 데스크톱 앱, 로컬 Git 저장소 열기
- Codex와 Claude Code CLI 실행/세션 표시 (먼저 둘 중 하나로 시작해도 런타임 인터페이스는 공통)
- worktree 생성, 에이전트 실행 디렉터리 고정, diff/명령 로그 표시
- JS/TS와 Python의 파일·import 관계 추출
- 모듈 그래프, 파일 검색, 노드 → 파일/심볼 이동
- Codex/Claude 분석을 통한 모듈 설명·계층화·주요 요청 흐름 생성
- snapshot 저장과 기본적인 before/after 그래프 비교

### MVP에서 제외

- 자체 LLM 호스팅, 모델 과금 대행
- 완전한 VS Code 확장 호환성/마켓플레이스
- 모든 언어의 정밀 call graph
- 자동 merge/push 및 기본 허용의 자율 배포
- 여러 웹사이트를 무제한 크롤링하는 기능

## 6. 권장 기술 아키텍처

**초기 가정:** 현재 사용 환경을 고려해 Windows 우선으로 시작하고, 빠른 프로토타이핑과 CLI 에이전트/터미널 연동을 위해 Electron + TypeScript를 채택한다. macOS/Linux 배포 가능성은 유지한다.

```text
Electron Desktop Shell
 ├─ Renderer (React)
 │   ├─ Workspace / editor / diff UI
 │   ├─ Architecture canvas (React Flow 계열)
 │   └─ Agent run / approval UI
 ├─ Main Process
 │   ├─ Git + worktree manager
 │   ├─ PTY / terminal manager
 │   ├─ Agent Runtime Adapter host
 │   └─ IPC permission boundary
 └─ Local Services (worker processes)
     ├─ Static analyzer: tree, imports, symbols, routes, configs
     ├─ Knowledge store: SQLite + graph snapshot JSON
     ├─ Analysis orchestrator: evidence package → agent → schema validation
     └─ Optional connector service: GitHub/docs/web sources (opt-in)
```

### 의도적인 경계

| 경계 | 책임 | 이유 |
| --- | --- | --- |
| Desktop shell | 창, 권한, 보안 IPC, 로컬 파일 접근 | 브라우저 UI와 시스템 권한을 분리한다. |
| Agent Runtime Adapter | 시작/중단, 이벤트 정규화, 권한 요청, 세션 식별 | Codex와 Claude Code의 구체적 CLI/protocol 차이를 UI에서 숨긴다. |
| Static analyzer | 확정 가능한 코드 관계 생성 | AI 환각 없이 그래프의 뼈대를 만든다. |
| Semantic analysis | 군집, 역할명, 흐름, 설명, 불확실성 표시 | AI가 가장 잘하는 의미 해석만 맡긴다. |
| Graph canvas | 탐색, 필터, 비교, 근거 이동 | renderer는 분석/에이전트 실행 권한을 직접 갖지 않는다. |

## 7. 에이전트 연동 설계

`AgentRuntime` 인터페이스를 제품의 안정된 계약으로 둔다.

```ts
interface AgentRuntime {
  id: "codex" | "claude-code" | string;
  detect(): Promise<RuntimeAvailability>;
  createSession(input: SessionInput): Promise<SessionHandle>;
  stream(session: SessionHandle): AsyncIterable<AgentEvent>;
  respondToApproval(request: Approval, decision: Decision): Promise<void>;
  cancel(session: SessionHandle): Promise<void>;
}
```

- **Codex adapter:** 초기에는 설치된 CLI를 PTY에서 구동하고, 깊은 채팅·승인·이벤트 통합 단계에서는 Codex App Server를 사용한다. App Server는 자체 클라이언트에 적합한 방식으로 공식 문서에 명시되어 있다.
- **Claude Code adapter:** CLI 세션을 별도 PTY로 실행하고 출력/도구 활동을 공통 이벤트로 정규화한다. 이후 지원되는 안정된 프로토콜을 추가 어댑터로 도입한다.
- **분석 전용 run:** `read-only`, `network off`를 기본 프로파일로 제안한다. 분석 결과는 반드시 아래 JSON 스키마를 통과해야 그래프에 반영된다.

## 8. 아키텍처 그래프 계약

```ts
type Evidence = {
  kind: "file" | "symbol" | "import" | "route" | "config" | "doc" | "agent-inference";
  ref: string;              // 파일/심볼/URL 식별자
  location?: { startLine?: number; endLine?: number };
  confidence: "high" | "medium" | "low";
};

type ArchitectureNode = {
  id: string;
  kind: "system" | "module" | "service" | "data-store" | "external" | "entrypoint";
  label: string;
  summary: string;
  evidence: Evidence[];
};

type ArchitectureEdge = {
  from: string;
  to: string;
  relation: "imports" | "calls" | "reads" | "writes" | "publishes" | "depends-on";
  evidence: Evidence[];
};
```

검증 규칙:

- `file`/`symbol` 근거는 해당 snapshot에 실제로 존재해야 한다.
- AI가 만든 `agent-inference` 관계는 최소 하나의 정적 근거 또는 명시적 `low` 신뢰도를 가져야 한다.
- 근거 없는 노드는 그래프의 핵심 관계에 연결하지 않는다.
- 레이아웃은 저장하되, 그래프 의미 데이터와 분리한다.

## 9. Code Intelligence 파이프라인

```text
Scan → Normalize → Deterministic Graph → Semantic Enrichment → Validate → Render

파일/설정 탐색     import·심볼 해석       Codex/Claude 해석          근거·스키마 검사
```

1. `.gitignore`와 민감 파일 제외 정책을 적용하고 파일 목록/언어/빌드 시스템을 만든다.
2. 언어별 parser 또는 LSP로 import, export, symbol, 라우트, ORM/스키마 단서를 수집한다.
3. 파일 그래프를 패키지/폴더/실행 진입점 단위의 결정론적 그래프로 압축한다.
4. 에이전트에 전체 코드를 던지는 대신, 중요한 파일·그래프·설정·README와 스키마를 제공한다.
5. 에이전트는 역할·경계·요청/데이터 흐름 후보를 JSON으로 반환한다.
6. validator가 실제 파일/심볼과 대조하고, UI는 근거·신뢰도를 표시한다.

## 10. 외부 지식(웹/GitHub) 확장 — Phase 2

사용자가 처음 말한 “GitHub와 여러 사이트를 돌아보며 이해하는” 기능은 MVP 뒤에 **명시적 지식 커넥터**로 넣는다.

- GitHub README, Issues, PR, Wiki, ADR 및 공개 API 문서 URL을 사용자가 선택해 가져온다.
- 페이지마다 URL, 수집 시각, 선택 텍스트/요약, 연결된 그래프 노드를 저장한다.
- 에이전트가 웹에서 추론한 사항은 코드 근거와 구분해 `doc`/`agent-inference`로 보인다.
- private 저장소 또는 사내 문서는 기본 외부 전송 금지이며, 커넥터와 에이전트의 접근 범위를 화면에 표시한다.

## 11. 첫 구현 단위와 완료 조건

**첫 Vertical Slice: “한 로컬 JS/TS 저장소를 열어 구조 그래프에서 파일로 이동한다.”**

완료 조건:

- 사용자가 로컬 Git 저장소를 선택하면 파일 트리와 현재 branch가 표시된다.
- import 기반 모듈 그래프를 30초 이내에 생성한다(중간 규모 저장소 기준; 정확한 벤치마크는 구현 전 확정).
- 노드 선택 시 관련 파일, import 관계, 근거 줄 위치가 보이고 편집기로 열린다.
- `Analyze with Codex`를 실행하면 읽기 전용 세션의 상태·승인·출력이 UI에 나타난다.
- 에이전트가 만든 요약은 그래프의 근거와 함께 표시되고, 근거 없는 관계는 자동 반영되지 않는다.
- 모든 데이터는 로컬 프로젝트 메타데이터 폴더에 저장되며, 사용자가 삭제할 수 있다.

## 12. 다음 설계 결정

1. 제품명/브랜딩을 정한다.
2. 첫 지원 런타임을 Codex 우선으로 할지, Codex + Claude Code 동시 MVP로 할지 결정한다.
3. Electron 기반 프로토타입을 만들고, 첫 Vertical Slice의 UX 와이어프레임과 데이터 스키마를 확정한다.
4. 공개 JS/TS 저장소 2~3개로 분석 정확도·시간·그래프 유용성 평가 기준을 만든다.
