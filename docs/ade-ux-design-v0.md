# 독립형 AI-native ADE — UX 설계 v0

<!-- witch-doc-languages: ko,en -->

> **한국어:** Witch의 현자·비전가 테마와 첫 Vertical Slice의 화면 구조, 상호작용 및 접근성 원칙을 기록한 초기 UX 설계입니다.
>
> **English:** This historical UX design records Witch's sage-and-seer visual direction plus the layout, interactions, and accessibility principles of the first vertical slice.

이 문서는 초기 UX 설계 기록입니다. 실제 구현 범위와 제한은 [구현 현황](implementation-status.md)을 기준으로 확인하세요.

작성일: 2026-08-28<br>
범위: 첫 Vertical Slice의 데스크톱 화면과 상호작용

## 비주얼 방향 — Witch

Witch는 공포·사악함·할로윈 장식이 아니라, 복잡한 지식을 해석하는 **현자/비전가**의 은유다. 이 제품에서 코드는 신비화할 대상이 아니라, 사용자가 근거를 따라 이해할 수 있도록 밝혀야 하는 체계다.

- **정서:** 차분함, 지성, 집중, 은은한 신비
- **기본 바탕:** 거의 검정에 가까운 자주빛 밤색. 긴 작업에도 눈부심이 없도록 검정보다 약간 따뜻하게 둔다.
- **핵심 색:** 지혜/선택은 violet, 분석 중 흐름은 lavender, 검증됨은 mint, 주의는 amber로 쓴다.
- **상징:** 작은 초승달, 별가루 같은 점 격자, 연결된 별자리 형태의 그래프. 빗자루·해골·핏빛·뾰족한 모자 같은 공격적/클리셰 장식은 사용하지 않는다.
- **상태 표현:** ‘마법’ 같은 불명확한 표현 대신 `Observed`, `Inferred`, `Verified`처럼 근거 수준을 명시한다.

### 토큰 초안

| 역할 | 색감 | 용도 |
| --- | --- | --- |
| Night | 검정에 가까운 aubergine | 창 배경, 터미널 |
| Ink | 깊은 남보라 | 패널 표면, 구획 |
| Amethyst | 맑은 보라 | 선택, 주 행동, 활성 그래프 관계 |
| Moonlit | 옅은 라벤더 | 텍스트 강조, hover, 보조 분석선 |
| Sage | 흐린 mint | 검증된 근거/성공 상태 |
| Ember | muted amber | 승인 대기, 불확실성 경고 |

## 설계 목표

사용자가 에이전트에게 일을 시킨 뒤에도 “무엇이 바뀌었고, 시스템 구조에서 어디에 영향을 주는가?”를 30초 안에 파악하게 한다.

### 핵심 UX 원칙

- **그래프 우선, 파일로 귀결:** 아키텍처 화면의 모든 노드는 실제 파일·심볼·근거로 이동한다.
- **에이전트는 관찰 가능:** 실행 중인 에이전트의 작업공간, 권한, 도구 활동, 변경 사항을 숨기지 않는다.
- **관점 분리:** 구조(Graph), 코드(Source), 영향(Diff)을 같은 컨텍스트에서 탭으로 전환한다.
- **스냅샷 기반:** “현재 구조”가 아니라 commit SHA에 고정된 `Analysis Snapshot`을 보고 비교한다.
- **복잡도는 점진 공개:** 첫 진입에는 시스템 수준 그래프만 보이고, 노드 선택 시에만 파일·근거·세부 흐름을 연다.

## 화면 정보 구조

```text
Workspace
 ├─ Project rail
 │   ├─ repository / branch
 │   ├─ worktrees
 │   └─ architecture snapshots
 ├─ Main surface
 │   ├─ Graph
 │   ├─ Source
 │   └─ Diff
 ├─ Inspector
 │   ├─ selected architecture node
 │   ├─ evidence
 │   └─ related agent changes
 └─ Activity rail
     ├─ active agent runs
     ├─ approval requests
     └─ test / terminal events
```

## 첫 화면: Architecture Workspace

### 기본 상태

- 왼쪽: **Project, Search, Tasks**를 전환하는 작업 rail. 현재 저장소·branch/worktree 및 실행 중인 작업을 빠르게 전환한다.
- 가운데: 시스템 레벨 그래프. `entrypoint`, `module`, `data-store`, `external` 노드를 형태와 라벨로 구분한다.
- 오른쪽 상단: **파일 목록**. 검색 결과, 변경 파일, 현재 선택 모듈의 관련 파일을 보여 주며 파일 선택이 곧 Inspector의 분석 대상이 된다.
- 오른쪽 하단: **AI file analysis**. 선택 파일의 책임, 외부/내부 의존성, 코드 근거, 신뢰도, 관련 Agent Run을 표시한다.
- 하단: Orca처럼 여러 세션을 탭으로 둘 수 있는 **통합 터미널**. `PowerShell`, `Codex`, `Claude Code`, `Tests` 터미널을 유지하고, 작업 로그와 사람이 직접 입력하는 명령을 모두 수용한다.

### 노드 선택

1. 사용자가 그래프 노드를 클릭한다.
2. 노드와 직접 연결된 엣지만 강조하고, Inspector에 역할·근거·연결 관계를 보인다.
3. 근거 파일을 클릭하면 가운데 화면이 Source 탭으로 전환되고 해당 위치로 이동한다. 오른쪽의 파일 선택도 같은 방식으로 Source/Inspector를 동기화한다.
4. `이 변경의 영향 보기`를 누르면 Diff 탭으로 전환되어 선택 노드와 연결된 변경 파일만 우선 표시한다.

### Snapshot 비교

- snapshot 두 개를 고르면 가운데 그래프가 `added`, `removed`, `changed` 상태를 표시한다.
- 삭제/추가는 색만으로 전달하지 않고 +/− 아이콘 및 목록에도 반영한다.
- 비교 결과는 “어떤 파일 변화가 이 관계 변화를 만들었는지”를 근거로 연결한다.

## 에이전트 실행 UX

### 분석 실행

`Analyze architecture`는 다음을 분명히 표시한다.

- 실행할 런타임(Codex / Claude Code)
- 대상 worktree와 commit
- 권한 프로파일: `Read-only`, `Network off`가 기본
- 사용될 입력: 코드 스캔 결과, 중요 파일, 기존 스냅샷
- 실행 중 일어난 도구 호출과 사용자의 승인 대기 상태

### 작업 실행

- 각 Agent Run은 반드시 하나의 worktree에 묶인다.
- 완료 상태에서 `Inspect diff`, `Compare architecture`, `Open terminal`, `Create review`를 제공한다.
- 그래프가 수정된 경우 자동으로 새 snapshot을 제안하지만, 원격 전송이나 브랜치 병합은 자동 수행하지 않는다.

### 통합 터미널

- 터미널은 화면 하단에 상시 표시하되 높이를 조절하거나 접을 수 있다.
- Agent Run마다 전용 PTY 탭을 자동 생성한다. 사용자는 해당 탭을 열어 에이전트의 실제 CLI 대화를 보거나 필요한 명령을 직접 실행할 수 있다.
- 터미널 출력의 파일 경로/테스트 실패는 클릭 가능한 이벤트가 되어 Source와 Impact diff로 이동한다.
- Agent가 명령을 실행할 때는 탭 이름, worktree, 권한 프로파일을 함께 보인다. 사람이 입력하는 PowerShell/Bash 세션과 혼동되지 않게 구분한다.

## 설계 검증 시나리오

### 시나리오 A — 낯선 프로젝트 이해

“이 프로젝트의 인증 요청이 어디서 시작해 어디까지 가는가?”라는 질문에 사용자는 Graph에서 `Web UI → API → Auth Module → Identity Provider` 관계를 고르고 각 단계의 코드 근거로 이동할 수 있어야 한다.

### 시나리오 B — 에이전트 변경 검토

“Codex가 결제 기능을 수정했다”는 상황에서 사용자는 worktree의 diff뿐 아니라 새 외부 의존성과 데이터 계층 연결 변화를 graph compare로 확인할 수 있어야 한다.

### 시나리오 C — 근거 없는 AI 추론 차단

AI가 존재하지 않는 `Notification Service`를 제안하면, 근거 검증에서 관계가 보류되고 사용자는 누락 원인을 볼 수 있어야 한다.

## 초기 UI 결정

| 항목 | 결정 |
| --- | --- |
| 기본 화면 | Architecture Workspace |
| 좌측 rail | Project, Search, Tasks를 한 곳에 두고 전체 작업 맥락을 전환 |
| 그래프 범위 | 시스템/모듈 수준부터 시작, 파일 수준은 드릴다운 |
| 우측 inspector | 파일 목록과 AI file analysis를 세로로 배치해 코드 탐색과 해석을 함께 제공 |
| 코드 편집 | MVP에서는 읽기·파일 이동 중심, 완전한 IDE 기능은 이후 확장 |
| 에이전트 실행 | 우측 Activity rail에서 관찰·중단·후속 지시 |
| 터미널 | 하단 고정형, worktree/agent별 복수 PTY 탭 |
| 상태 표현 | 색상 외에 아이콘·텍스트·근거 목록으로 중복 표현 |

## 다음 와이어프레임

1. Architecture Workspace — 현재 제작됨
2. Agent Run 생성 및 권한 확인
3. Snapshot Compare
4. Source + evidence 드릴다운
