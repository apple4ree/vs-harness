# Witch semantic analysis policy

<!-- witch-doc-languages: ko,en -->

> **한국어:** Python·Rust·TypeScript 중심의 심층 분석, System–Component–Workflow 계층, Inferred/Authored 대조와 변경 이력에 대한 핵심 정책입니다.
>
> **English:** This core policy defines deep analysis for Python, Rust, and TypeScript; the System–Component–Workflow hierarchy; Inferred/Authored comparison; and auditable change history.

> Python · Rust · TypeScript를 중심으로 한 Agent/금융 시스템 분석 계약

- 결정일: 2026-08-30
- 상태: v1 공통 IR·polyglot call·정적 workflow control-flow·bounded Pyright/rust-analyzer corroboration·evidence-first workflow rooting·coverage UI·progressive overview·persistent incremental symbol index 구현
- 범위: 구조 분석, Workflow, Inferred/Authored 대조, 자동 승인과 이력
- 현재 구현: `witch.semantic/v1`, Python/Rust/TS 심볼, 확인된 containment/import/export와 TS/JS direct call, Python/Rust inferred call 및 bounded LSP corroboration, relation/claim 충돌 질문, provisional `precedes`/`branches-to`/`retries`, focused graph/sequence/branch-collapse Workflows, revision delta, Meaning 렌즈, 검증된 Agent dossier
- 다음 범위: framework adapter, authored/observed ordering, runtime trace, GUI question resolution, provider type hierarchy, cross-language artifact flow

## 1. 결정 요약

Witch의 1차 심층 분석 언어는 다음 세 가지로 고정한다.

1. Python
2. Rust
3. TypeScript / JavaScript

제품의 기본 탐색 계층은 다음처럼 보인다.

```text
System
├─ Workflows
│  └─ Steps
│     └─ participating Component / Symbol / Evidence
└─ Components
   └─ Module / Package
      └─ File
         └─ Symbol
            └─ Evidence
```

Workflow는 UI에서 System과 Component 사이를 잇는 관점으로 보이지만, canonical model에서 Component의 부모로 취급하지 않는다. 하나의 Component가 여러 Workflow에 참여할 수 있고 하나의 Workflow가 여러 Component를 가로지를 수 있기 때문이다.

분석 결과는 `Verified`, `Inferred`, `Authored` 세 층으로 유지한다.

- `Verified`: parser, compiler, LSP 또는 관측 도구가 evidence와 함께 확인한 사실
- `Inferred`: framework heuristic 또는 AI가 evidence를 바탕으로 제안한 의미·관계
- `Authored`: 사용자, 프로젝트 설정, 설계 문서가 선언한 의도

`Inferred`는 기본적으로 자동 활성화한다. 단, `Verified`를 변경하거나 덮어쓰지 않고 versioned provisional layer에만 들어간다. 모든 자동 활성화는 before/after, evidence, model, policy와 이유를 기록한다.

`Inferred`와 `Authored`가 충돌하면 분석을 중단하지 않는다. AI의 추론 방향을 provisional view에 적용하면서 동시에 open question을 남긴다. 질문은 [Grillme](https://github.com/idanlo/grillme)처럼 한 번에 하나의 결정만 묻고, 추천 답과 코드 근거를 먼저 보여 준다.

## 2. 제품 원칙

### 2.1 사실, 추론, 의도를 섞지 않는다

다음 세 문장은 서로 다른 종류의 결과다.

```text
Verified
order_service.py imports risk_engine.py

Inferred
RiskEngine은 주문 전 위험 검증을 담당하는 것으로 보인다.

Authored
모든 주문은 RiskApproval Workflow를 통과해야 한다.
```

같은 화면에 표시할 수는 있지만 동일한 edge 또는 동일한 신뢰 상태로 저장하지 않는다.

### 2.2 Workflow는 정적 call graph와 다르다

Workflow는 다음 정보를 가져야 한다.

- 명시적 시작 조건
- 순서가 있는 step
- branch와 guard
- retry, timeout, cancel, compensation
- input/output artifact
- step을 수행하는 Component와 Symbol
- 근거와 신뢰 상태

정적 함수 호출 순서만으로 Workflow를 만들지 않는다. decorator, route, task registration, event subscription, test, configuration, trace 등 추가 근거가 있어야 `Inferred Workflow`가 된다.

### 2.3 자동 승인은 의미 graph에만 적용한다

이 문서의 자동 승인은 코드 변경, terminal 실행, Git commit 또는 금융 주문 실행의 자동 승인이 아니다.

자동 승인 대상은 다음뿐이다.

- component 역할 추론
- workflow 후보와 step 의미
- architecture label과 grouping
- framework relation 후보
- semantic annotation

소스 변경과 외부 실행은 Witch의 별도 Agent permission과 diff review 계약을 따른다.

### 2.4 질문이 남아도 탐색은 계속할 수 있다

Authored와 Inferred가 충돌할 때 사용자의 즉시 응답을 강제하지 않는다.

```text
Conflict detected
→ AI inference를 Provisional로 활성화
→ OpenQuestion 생성
→ 관련 node/edge에 unresolved badge 표시
→ 이후 분석과 Agent context에 불확실성 포함
→ 사용자가 답하면 새 revision에서 재평가
```

이는 질문을 숨기는 자동화가 아니라, 질문과 임시 결정을 모두 보존하는 자동화다.

## 3. 공통 canonical model

### 3.1 공통 노드

| 노드             | 의미                                                  |
| ---------------- | ----------------------------------------------------- |
| `System`         | 분석 대상 제품 또는 배포 단위                         |
| `Workflow`       | 사용자·업무·Agent·금융 실행 흐름                      |
| `WorkflowStep`   | 순서·분기·재시도 의미를 가진 단계                     |
| `Component`      | 책임과 경계를 가진 고수준 기능 단위                   |
| `Package`        | 언어 또는 빌드 시스템의 package/crate                 |
| `Module`         | 언어별 module/namespace                               |
| `File`           | revision과 hash가 있는 소스 파일                      |
| `Symbol`         | class, function, trait 등 언어 심볼                   |
| `Artifact`       | message, order, quote, feature, position 등 흐르는 값 |
| `ExternalSystem` | broker, exchange, model provider, database, API       |
| `Evidence`       | file range, config, test, trace, log 등 근거          |
| `OpenQuestion`   | 아직 해결되지 않은 claim 또는 relation 충돌           |

### 3.2 공통 관계

| 관계                       | 예시                                           |
| -------------------------- | ---------------------------------------------- |
| `CONTAINS`                 | System contains Component                      |
| `DEFINES`                  | File defines Function                          |
| `IMPORTS` / `USES`         | Module imports Module                          |
| `CALLS`                    | Function calls Function                        |
| `REFERENCES`               | Symbol references Symbol                       |
| `EXTENDS` / `IMPLEMENTS`   | Class extends Class, impl implements Trait     |
| `TRIGGERS`                 | Scheduler triggers Workflow                    |
| `NEXT`                     | WorkflowStep A precedes B                      |
| `BRANCHES_TO`              | guard 결과에 따른 분기                         |
| `EXECUTED_BY`              | WorkflowStep executed by Component/Symbol      |
| `READS` / `WRITES`         | step reads Quote, writes OrderIntent           |
| `PUBLISHES` / `SUBSCRIBES` | event producer/consumer                        |
| `CALLS_TOOL`               | Agent step calls tool                          |
| `GUARDS`                   | RiskCheck guards OrderSubmission               |
| `OBSERVED_AS`              | static relation과 runtime trace 연결           |
| `SUPPORTS` / `CONTRADICTS` | Evidence가 Inferred/Authored claim을 지지·반박 |

### 3.3 Workflow step 종류

Agent 개발과 금융 시스템을 함께 표현하기 위해 다음 step kind를 기본으로 한다.

```text
trigger
ingest
validate
transform
infer
plan
decide
guard
tool_call
execute
persist
publish
observe
retry
compensate
cancel
```

`infer`는 모델 추론, `decide`는 정책 또는 전략 결정, `guard`는 위험·권한·한도 확인, `execute`는 실제 주문·외부 side effect를 구분하는 데 사용한다.

## 4. 언어별 심볼 추출 방향

세 언어가 동일한 graph schema를 억지로 공유하지 않도록 공통 symbol kind와 언어 확장을 함께 둔다.

### 4.1 Python

#### Verified 노드 후보

- package, module, file
- class, function, async function, method
- protocol, abstract base class
- dataclass, enum
- decorator와 decorated target
- module-level variable과 명시적 constant
- test와 fixture

#### Verified 관계 후보

- import/from import와 alias 해석
- definition, reference, inheritance
- 해석 가능한 direct call
- decorator application
- context manager와 async task 생성
- 명시적인 event/topic registration

#### Inferred adapter 후보

- FastAPI/Flask route → handler
- Pydantic model → API/data contract
- Celery/RQ/Prefect/Airflow task와 workflow
- LangGraph/CrewAI/AutoGen 등 Agent node·tool·handoff
- broker/exchange SDK call → market data/order operation
- pandas/Polars transformation chain → data artifact flow

Python의 monkey patch, dynamic import, dependency injection, decorator 내부 동작은 자동 Verified로 승격하지 않는다. framework adapter 또는 runtime evidence가 있으면 Inferred로 생성한다.

### 4.2 Rust

#### Verified 노드 후보

- crate, module, file
- struct, enum, trait, type alias
- impl block, function, method, associated item
- macro definition과 invocation
- test, feature flag, unsafe block

#### Verified 관계 후보

- `mod`, `use`, re-export
- definition, reference
- trait implementation
- type/method resolution이 성공한 call
- generic bound와 associated type relation
- async spawn과 channel 생성의 직접 근거

#### Inferred adapter 후보

- Tokio task/channel → concurrent workflow
- Axum/Actix route → handler
- serde type → wire/data contract
- event bus producer/consumer
- broker/exchange client → order·market-data boundary
- unsafe/FFI boundary → risk annotation

macro expansion을 얻을 수 없는 환경에서 macro 이름만으로 내부 call을 Verified로 만들지 않는다. rust-analyzer 또는 compiler expansion이 있으면 evidence로 사용한다.

### 4.3 TypeScript / JavaScript

#### Verified 노드 후보

- package, module, file
- class, interface, type, enum
- function, arrow function, method
- namespace, exported symbol
- test와 fixture

#### Verified 관계 후보

- import, export, re-export
- definition, reference
- extends, implements
- TypeScript checker가 해석한 call
- JSX component reference
- 명시적 event registration

#### Inferred adapter 후보

- React component, hook, context와 route
- Electron main/preload/renderer IPC
- Express/Nest/Fastify route와 handler
- Agent SDK tool registration과 handoff
- websocket/message-bus producer/consumer
- frontend component ↔ API endpoint ↔ backend handler

동적 property access, string-based event, runtime plugin은 static Verified로 단정하지 않는다.

## 5. Component 추론

Component는 폴더 이름 하나로 결정하지 않는다. AI와 heuristic은 다음 증거 묶음을 사용한다.

- import/call cohesion
- public API와 entry point
- package/crate/module boundary
- framework registration
- configuration과 deployment unit
- tests와 fixtures
- naming과 documentation
- runtime trace가 있으면 실제 traffic

Component claim은 다음 형식으로 남긴다.

```json
{
  "claim": "Risk Engine validates order intents before submission",
  "status": "inferred",
  "confidence": 0.86,
  "evidenceIds": ["ev:order-service:42", "ev:test-risk:18"],
  "alternatives": ["Risk Engine may only calculate limits"],
  "policyVersion": "witch.semantic-policy/v1"
}
```

각 Component는 다음 설명을 가질 수 있다.

- responsibility
- inputs / outputs
- public surface
- participating workflows
- invariants와 architecture rules
- inferred tasks
- unresolved questions

## 6. Workflow 추론

### 6.1 Workflow 후보의 시작 신호

- HTTP/RPC/CLI entry point
- scheduler/cron/task decorator
- message/event subscription
- Agent graph entry와 handoff
- test scenario
- broker/exchange callback
- runtime trace root

### 6.2 Step 연결 근거

우선순위는 다음과 같다.

1. runtime trace 또는 명시적 workflow definition
2. framework registration과 compiler-resolved call
3. direct call과 data artifact relation
4. test scenario와 configuration
5. AI/heuristic 추론

낮은 단계의 근거만 있을수록 confidence를 낮추고 `Inferred`로 유지한다.

### 6.3 Agent Workflow 예시

```text
UserRequest
→ ContextAssembly
→ ModelInference
→ PlanDecision
→ ToolPermissionGuard
→ ToolCall
→ Observation
→ Retry or FinalResponse
```

### 6.4 금융 Workflow 예시

```text
MarketDataIngest
→ Normalize
→ FeatureCalculation
→ StrategyInference
→ RiskGuard
→ OrderIntent
→ BrokerSubmission
→ Fill/Rejection
→ PositionReconciliation
```

이 예시는 기본 template이지 실제 프로젝트의 사실이 아니다. 해당 node와 relation은 코드·설정·trace evidence가 있을 때만 프로젝트 graph에 생성한다.

## 7. Inferred와 Authored 대조

### 7.1 대조 결과

| 결과             | 처리                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `corroborated`   | 서로 같은 의미다. Inferred를 자동 활성화하고 Authored evidence를 연결한다.    |
| `supplementary`  | 충돌 없이 서로 보완한다. 두 claim을 유지한다.                                 |
| `conflicting`    | AI 추론을 provisional로 활성화하고 OpenQuestion을 생성한다.                   |
| `stale-authored` | 코드 revision 이후 Authored가 오래됐을 가능성을 표시한다.                     |
| `weak-inference` | evidence가 부족하다. 표시할 수 있지만 Agent 변경 근거로 단독 사용하지 않는다. |

### 7.2 Grillme-style OpenQuestion

질문은 한 번에 하나의 결정만 다룬다.

```text
Question
Authored 문서는 모든 주문이 RiskApproval을 거친다고 하지만,
현재 코드에서는 BatchRebalance가 RiskEngine을 우회합니다.
어느 쪽이 의도입니까?

Recommended
현재 코드를 provisional truth로 유지하고 문서가 오래됐다고 표시합니다.

Evidence
- rebalance.py:88 → broker.submit(...)
- architecture.md:42 → "All orders require RiskApproval"

Options
1. 현재 코드가 의도다.
2. Authored 문서가 의도이며 코드를 수정해야 한다.
3. BatchRebalance는 명시적 예외다.
4. 보류한다.
```

질문이 해결되기 전까지 AI는 recommended inference를 사용할 수 있지만, Agent context에는 반드시 `provisional`, question ID와 반대 evidence를 함께 전달한다.

OpenQuestion은 claim 충돌이면 `claimIds`, source binder와 language-server target 충돌이면 `relationIds`로 양쪽을 참조한다. LSP 응답 부재나 다중 target이 있는 모호한 한 줄은 질문을 만들지 않는다.

## 8. 자동 승인 정책

### 8.1 기본값

- Verified fact: validator 통과 시 자동 canonical 반영
- Inferred claim: 자동으로 provisional semantic layer에 활성화
- Authored claim: provenance와 revision을 보존해 별도 유지
- Inferred/Authored conflict: Inferred 방향으로 provisional 진행 + OpenQuestion 생성
- source code mutation: 이 정책의 자동 승인 대상이 아님

### 8.2 자동 승인을 거부하는 조건

다음 경우에는 semantic layer에도 새 결과를 활성화하지 않고 invalid candidate로 보관한다.

- 존재하지 않는 node 또는 evidence를 참조
- project/revision이 다른 evidence를 혼합
- source hash가 현재 revision과 불일치
- graph schema 또는 endpoint validator 실패
- relation 방향과 kind가 schema에서 허용되지 않음
- 같은 claim revision에서 모순된 값을 동시에 생성

confidence가 낮거나 Authored와 충돌하는 것은 거부 조건이 아니다. 해당 상태를 표시하고 질문을 남기는 조건이다.

### 8.3 변경 기록

모든 자동·수동 semantic 변경은 `AnalysisRevision`으로 남긴다.

- revision ID와 parent revision
- timestamp
- analyzer, adapter, AI provider/model
- prompt/policy/schema version
- source commit 또는 workspace content hash
- added/removed/changed node, relation, claim
- evidence와 confidence 변화
- auto-approval reason
- 연결된 OpenQuestion
- 이전 revision으로 되돌릴 수 있는 inverse delta

사용자는 다음을 확인할 수 있어야 한다.

```text
Before
→ AI/adapter가 왜 바꿨는가
→ Delta
→ 현재 Provisional/Resolved 상태
→ After
```

## 9. 그래프 표시 계약

| 상태                   | 기본 표현                                      |
| ---------------------- | ---------------------------------------------- |
| Verified               | 실선, source badge, evidence 열기 가능         |
| Inferred / provisional | 점선, confidence와 inference badge             |
| Authored               | 이중선 또는 authored badge, 문서·설정 evidence |
| Corroborated           | Verified/Inferred/Authored 출처를 함께 표시    |
| Conflicting            | 경고 outline과 OpenQuestion badge              |
| Observed               | trace/metric badge와 관측 시각                 |
| Stale                  | 흐린 표시와 revision mismatch 경고             |

필터는 출처를 숨길 수 있지만 canonical data를 변경하지 않는다. 모든 Workflow step에서 `왜 이 순서인가?`, `어떤 코드가 수행하는가?`, `반대 근거가 있는가?`를 열 수 있어야 한다.

현재 UI는 한 화면에 모든 의미 노드를 섞지 않고 다음 읽기 렌즈를 제공한다.

| 렌즈                | 표시 목적                                               |
| ------------------- | ------------------------------------------------------- |
| Overview            | System, Component, Workflow, WorkflowStep의 고수준 지도 |
| Components          | System→Component→File 경계와 소스 범위                  |
| Workflows           | Workflow/Step, provisional 순서·branch·retry와 근거     |
| Calls               | verified TS/JS와 inferred Python/Rust 내부 call         |
| Questions           | open question의 subject와 인접 근거                     |
| Verified / Authored | inferred-only 항목을 제외한 확인·선언 계층              |

선택 노드 inspector는 인접 reasoning relation의 방향, kind, trust, status, confidence와 첫 source evidence를 표시한다. 이는 관계를 설명하는 UI이며 정적 관계를 런타임 순서로 승격하지 않는다.

### 9.1 Agent context 계약

Meaning 카드를 Agent에 첨부할 때 renderer의 drag payload는 권한 있는 데이터로 취급하지 않는다. 메인 프로세스는 현재 source revision과 semantic validation receipt를 다시 확인하고, node ID를 기준으로 label과 source path를 재구성한다. stale/invalid semantic graph는 거부한다.

Agent에는 선택한 의미 노드와 제한된 인접 노드·relation·claim·open question·evidence만 `witch.semantic/v1` dossier로 전달한다. `Verified`, `Inferred`, `Authored`와 `accepted`, `provisional`, `conflicting` 상태를 유지하고, static workflow order·branch membership·retry structure가 runtime proof가 아니라는 boundary 문구와 관계별 설명을 포함한다. 따라서 Agent가 의미 계층을 활용할 수는 있지만 불확실성을 검증 사실처럼 전달받지는 않는다.

## 10. 사용자 정의 규칙 방향

현재 첫 계약은 의존성을 늘리지 않는 `.witch/analysis.json`의 Authored claim이다.

```json
{
  "schemaVersion": 1,
  "claims": [
    {
      "subjectId": "component:src/services",
      "key": "responsibility",
      "value": "Validates risk before an order reaches a broker.",
      "reason": "Declared by the project maintainer."
    }
  ]
}
```

`subjectId`는 `component:<module>`, `file:<path>`, `symbol:<source-symbol-id>` 또는 Meaning IR의 전체 ID를 받을 수 있다. `key`는 `boundary`, `responsibility`, `workflow`, `behavior` 중 하나다. 존재하지 않는 subject는 그래프에 억지로 만들지 않고 분석 warning으로 남긴다.

향후 더 넓은 규칙 설정은 다음 의도를 표현한다.

```yaml
languages:
  priority: [python, rust, typescript]

architecture:
  components:
    - id: risk-engine
      include: ["python/risk/**", "rust/crates/risk/**"]
      authoredResponsibility: "Validate exposure and order limits"

workflows:
  hints:
    - id: order-lifecycle
      entrypoints: ["submit_order", "OrderIntentHandler"]

rules:
  forbidden:
    - from: ui
      to: broker-adapter
      relation: CALLS

inference:
  autoActivate: true
  conflictPolicy: provisional-inference-with-question
```

이 설정은 실제 import/call을 삭제하거나 조작하지 않는다. grouping, authored intent, workflow hint와 violation 검사를 추가한다.

## 11. v1 구현 상태와 다음 완료 조건

현재 구현된 항목:

- 공통 의미 IR과 fail-closed validator
- claim provenance, confidence, trust/status 분리
- Python/Rust/TypeScript 최소 정적 fixture
- Inferred/Authored 대조와 추천 우선 OpenQuestion
- 동일 분석 중복을 만들지 않는 부모 revision/delta 기록
- 6개 Meaning 렌즈와 claim/evidence/reasoning inspector
- TypeChecker-resolved TS/JS direct call, Python/Rust inferred/corroborated/conflicting call과 provisional Workflow control-flow
- 검증된 Meaning 선택을 source 범위와 semantic dossier로 Agent에 전달

다음 심층 단계에는 아래 항목이 필요하다.

1. Agent/금융 framework registration adapter
2. provider type hierarchy와 cross-language bridge
3. authored/observed Workflow 순서·선택 branch·error contract
4. OpenQuestion 답변과 상태 전이 UI
5. semantic auto-approval rollback
6. Artifact와 read/write/publish data-flow IR
7. Agent/금융 reference workflow fixture
8. false positive, dynamic dispatch, stale evidence 평가 corpus
9. opt-in runtime trace와 static/observed 대조
10. 대형 저장소용 persistent incremental symbol index

## 12. 승인된 방향과 남은 제품 질문

### 승인된 방향

- Python, Rust, TypeScript/JavaScript를 1차 언어로 한다.
- System 아래에 Workflow와 Component를 두고 Workflow step이 Component/Symbol을 참조한다.
- Verified, Inferred, Authored를 구분한다.
- Inferred를 허용하고 기본 자동 활성화한다.
- Authored와 충돌하면 AI inference로 provisional 진행하며 질문을 남긴다.
- 모든 자동 활성화와 변경을 versioned delta로 보존한다.

### 구현을 막지 않는 열린 질문

- confidence를 UI에 수치로 직접 표시할지 단계형으로 표시할지
- 자동 생성 OpenQuestion의 보관 한도와 우선순위
- 프로젝트 규칙을 YAML, JSON 또는 GUI 중 무엇으로 편집할지
- runtime trace를 어느 단계에서 1차 기능에 포함할지
- Python/Rust/TypeScript 중 실제 구현 순서를 Python-first로 할지 공통 schema-first로 할지

열린 질문은 기본 추천값으로 진행할 수 있으며, 선택 결과는 이후 revision에 남긴다.
