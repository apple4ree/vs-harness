# ADE·IDE·코드 인텔리전스 제품 벤치마크

[한국어](product-benchmark.ko.md) · [English](product-benchmark.md)

이 문서는 Editor와 코드 그래프 Viewer 중심의 시장이 ADE, Coding Agent Harness,
Computer-use 개발 환경으로 확장되는 상황에서 Witch를 어떻게 평가할지 정의합니다.
기계 판독 원본은
[`benchmarks/product/suite-v1.json`](../../benchmarks/product/suite-v1.json)입니다.

## 1. 하나의 점수가 아니라 Benchmark Suite인 이유

코드 구조 탐색기는 호출 관계가 정확해도 IDE가 아닐 수 있습니다. IDE는 편집과
디버깅이 안정적이어도 Architecture를 설명하지 못할 수 있고, Coding Agent는
Issue를 해결하면서 review 경계를 우회할 수도 있습니다. 서로 다른 주장이므로
Witch는 가중 종합 점수 대신 **능력 범위(capability envelope)**를 공개합니다.

결과는 다음 여섯 축으로 분리합니다.

| 평가 축          | 질문                                                                | 대표 근거                                               |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| 분석 충실도      | 구조·호출·Workflow·Behavior·Framework 관계에 source 근거가 있는가?  | Precision, Recall, F1, oracle coverage, validation 실패 |
| 설명·시각 사용성 | 사람이 Architecture 질문에 답하고 정확한 근거까지 도달할 수 있는가? | Task 성공률, 근거 도달 시간, 잘못된 선택, 생략 공개     |
| 개발 Workflow    | 편집·검색·LSP·실행·디버그·복구 과정에서 작업이 보존되는가?          | Electron scenario, 저장 충실도, latency, package test   |
| Agent Harness    | 완전한 제품 구성이 범위 안에서 검토 가능한 변경을 만드는가?         | Task 해결률, 변경 경로 정밀도, 검증, 개입, token·cost   |
| 안전·거버넌스    | 권한·범위·journal·승인·rollback·secret 경계를 지키는가?             | Fault injection, 무단 변경 수, rollback·receipt 무결성  |
| 규모·효율        | 저장소·그래프·Agent trajectory가 커져도 제한 안에서 반응하는가?     | Cold/warm/incremental 시간, RSS, UI p95, context byte   |

한 축이 다른 축의 실패를 상쇄하지 않습니다. Task 해결률이 높아도 안전 실패는
그대로 실패입니다.

## 2. 비교 가능한 제품 식별자

평가 대상은 모델 하나나 Desktop binary 하나가 아닙니다.

```text
제품 build + Provider/adapter + model + reasoning/configuration
           + benchmark revision + 실행 환경
```

이 중 하나라도 바뀌면 별도 결과입니다. Codex를 연결한 Witch와 Claude를 연결한
Witch는 서로 다른 구성입니다. Rules-only 정적 분석과 AI-assisted composition도
분리해 보고합니다.

## 3. 제품 유형과 적용 가능성

Task를 고르기 전에 평가 제품이 속하는 유형을 선언합니다.

| 제품 유형            | 기대 기능                                | 적용 가능한 평가                       |
| -------------------- | ---------------------------------------- | -------------------------------------- |
| 코드 구조 탐색기     | Index, graph, query, evidence navigation | 분석 충실도, 설명, 규모                |
| IDE                  | Editor, search, LSP, task, debugger      | 개발 Workflow, 플랫폼 신뢰성           |
| ADE                  | IDE와 Agent context·실행·review·복구     | IDE 평가와 Agent Harness·거버넌스      |
| Coding Agent Harness | Issue/task에서 검증된 patch까지          | Task 해결, 범위, 검증, 비용            |
| Computer-use Agent   | Screenshot/UI 관측과 action              | 격리 Desktop Task 성공과 action 안전성 |

제품이 기능을 주장하고 Task가 적용 가능하면 수행 불능은 `fail`입니다. 선언한 제품
유형 밖의 기능이면 0점이나 숨은 제외가 아니라 `not-applicable`입니다. `not-run`과
`partial`도 protocol이 요구하는 denominator에서 임의로 제거하지 않습니다.

## 4. 근거 수준

기능 비교표의 모든 cell은 다음 중 하나를 표시해야 합니다.

- `documented`: 해당 제품의 현재 문서만으로 확인
- `observed`: 날짜·build·환경·근거와 함께 사람이 직접 재현
- `measured`: 고정된 공통 Task와 evaluator로 실행

문서상 지원을 측정된 성능으로 바꾸지 않습니다. Open source라는 사실도 source를
검토할 수 있다는 뜻이지 실제 동작을 자동으로 증명하지 않습니다.

## 5. 평가 Lane

| Lane                       | 현재 성숙도   | 목적                                                            |
| -------------------------- | ------------- | --------------------------------------------------------------- |
| P0 · Source conformance    | 자동화        | Typecheck, 단위·통합, production build, Electron E2E            |
| P1 · Analysis oracle       | 자동화        | Call graph, Behavior, Framework, validation 정확도              |
| P2 · Repository scale      | 자동화        | Cold/warm/restart/incremental 비용과 bounded projection         |
| P3 · Human comprehension   | Protocol 정의 | 시각 설명이 실제 Architecture 질문 해결을 돕는지 평가           |
| P4 · Agent task completion | 일부 구현     | 현재 offline 결정적 Harness, 이후 반복 live task suite          |
| P5 · Adversarial recovery  | 일부 구현     | Scope escape, source mutation, malformed output, 중단, rollback |
| P6 · Packaged platform     | Protocol 정의 | Windows/macOS 설치·실행·upgrade·복구·삭제                       |

`자동화`는 저장소에 실행 명령이 있다는 뜻입니다. 모든 외부 corpus와 운영체제를
기본 CI에서 실행한다는 의미는 아닙니다.

## 6. Human Comprehension Protocol

그래프 가독성은 미적 선호만이 아니라 질문 해결로 측정합니다. 고정된 각 저장소에
대해 같은 시작 화면에서 다음 Task를 수행합니다.

1. 지정된 request나 job의 source entry point 찾기
2. 다음 Component와 그 관계를 뒷받침하는 evidence 찾기
3. Branch·retry·해결되지 않은 dynamic dispatch 찾기
4. Inferred 관계를 Verified·Authored·Observed 사실과 구분하기
5. Workflow summary에서 정확한 source line으로 이동한 뒤 되돌아오기

정답률, 근거 도달 시간 중앙값, 잘못 선택한 source 수, navigation 수와 graph 생략
표시 노출 여부를 기록합니다. Tool 순서는 무작위화하고 같은 repository revision과
Task를 사용하며 참가자 수와 사전 친숙도를 공개합니다. Screenshot review는 별도의
정성 근거로만 사용합니다.

## 7. Agent Task Protocol

예산이 허용되면 live Agent 비교는 Task·구성마다 최소 3회 독립 실행합니다. 다음을
공개합니다.

- Agent의 완료 문장이 아니라 실행 가능한 test의 pass/fail
- changed-path precision과 무관한 edit 수
- 검증 명령과 exit status
- 사용자 승인 또는 개입 횟수
- wall time, input/output token, cache 사용과 cost
- original-write, path-escape, secret-egress, receipt-integrity event
- incomplete, timeout, refusal, infrastructure failure

같은 모델을 CLI와 Witch에서 비교하면 Harness 효과를 볼 수 있습니다. 모델까지
다르면 Interface만이 아니라 완전한 제품 구성을 비교하는 것입니다.

## 8. 외부 Benchmark Adapter

외부 Suite는 실제로 측정하는 축에만 연결합니다.

| Benchmark                                                                                  | Witch에서 답할 질문                                      | 해석 경계                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------- |
| [SWARM-CG](https://github.com/secure-software-engineering/SWARM-CG), PyAnalyzer, DyPyBench | 정적 Call graph가 수동 정답 또는 관측 edge와 일치하는가? | IDE나 시각 사용성을 측정하지 않음                     |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench)                                        | 완전한 Agent 구성이 고정된 실제 Issue를 해결하는가?      | Patch 성공이 안전한 review나 IDE 품질을 증명하지 않음 |
| [IDE-Bench](https://github.com/AfterQuery/ide-bench)                                       | Agent가 IDE-native 구조화 Tool surface에서 작업하는가?   | Candidate adapter이며 dataset·harness 조건 고정 필요  |
| [Terminal-Bench](https://github.com/harbor-framework/terminal-bench)                       | 통제 환경에서 terminal task를 완료하는가?                | Terminal Agent 작업이며 그래프 설명력 평가는 아님     |
| [OSWorld](https://github.com/xlang-ai/OSWorld)                                             | 향후 CUA 구성이 격리 Desktop Task를 완료하는가?          | Witch CUA가 observation-only인 동안 deferred          |
| [AgentDojo](https://github.com/ethz-spylab/agentdojo)                                      | 어떤 공격·방어 패턴을 Harness test에 반영할 것인가?      | Reference-only이며 Coding ADE 점수가 아님             |

Manifest에 외부 Adapter가 있다고 측정 결과가 생기는 것은 아닙니다. `candidate`,
`planned`, `deferred`, `reference-only` 상태를 반드시 노출합니다.

## 9. 공정 비교 절차

1. 실행 전에 제품 유형, 주장, corpus revision, Task와 metric을 고정합니다.
2. 동등한 깨끗한 환경을 사용하고 사용할 수 없는 dependency를 공개합니다.
3. 정적 read-only 분석과 project code를 설치·실행하는 평가를 분리합니다.
4. 비교 arm 안에서는 model, effort, tool permission, context limit, timeout을 고정합니다.
5. 적용 가능한 Task를 전부 실행하고 실패·제외와 이유를 보존합니다.
6. 평가 축별 결과, 반복 시 confidence interval과 raw count를 공개합니다.
7. Development, holdout, blind-holdout 결과를 분리합니다.
8. Credential·private code·blind answer를 노출하지 않으면서 audit 가능한 artifact를 공개합니다.

GitHub star, 기능 개수와 Screenshot 선호는 landscape signal이지 benchmark 정확도가
아닙니다.

## 10. Witch 단기 Benchmark Roadmap

1. Python/Rust/TS 저장소 3개로 versioned P3 comprehension-task manifest 추가
2. Source 내용을 기록하지 않고 time-to-evidence를 측정하는 interaction event 추가
3. Windows packaged smoke 평가 후 동일한 macOS receipt 추가
4. Codex와 Claude 구성을 분리한 소규모 공개 P4 issue-to-patch pilot 추가
5. P5에 prompt injection, secret canary, symlink, process tree, apply 중단, rollback case 추가
6. Development fixture를 늘리기 전에 독립 Rust macro holdout 추가

이 Lane이 구현되기 전에는 현재 날짜가 적힌 결과 문서만 측정된 주장입니다.
