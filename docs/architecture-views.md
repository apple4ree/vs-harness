# Witch architecture views

Witch의 구조 탐색은 하나의 검증된 `witch.architecture/v1` IR을 여러 방식으로 읽습니다. 각 화면은 같은 source hash, stable node ID, authored relation ID, evidence line을 재사용합니다. 화면 전환이 새로운 관계를 만들어 내지 않습니다.

## 현재 지원하는 관점

| 관점                        | 표시하는 사실                                                                                | 의도적으로 표시하지 않는 것                    |
| --------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Modules                     | 파일의 정적 모듈 묶음과 묶음 사이의 실제 import/re-export 합계                               | 런타임 호출 횟수, 중요도                       |
| Files                       | 분석된 파일과 실제 import/re-export 관계                                                     | 동적 dispatch, 실행 순서                       |
| Focus / source neighborhood | 활성 파일, 그 파일을 직접 import하는 파일, 그 파일이 직접 import하는 대상, 각 evidence line  | 간접 영향, blast radius, 런타임 data flow      |
| Upstream / downstream reach | 현재 화면에 존재하는 authored directed relation의 도달 가능성                                | 변경 영향이나 위험도                           |
| Route                       | 현재 화면의 authored relation만 사용한 결정적 최단 경로                                      | 실제 실행 call sequence                        |
| Before · Delta · After      | 두 검증된 reading 사이의 정확한 노드·관계 추가/변경/삭제                                     | 회귀 위험이나 의미 변화 추정                   |
| Meaning · Calls             | TS checker verified call과 Python/Rust inferred internal call, call-site evidence            | 임의 property/dynamic dispatch, 실제 실행 횟수 |
| Meaning · Workflows         | provisional call step, lexical `precedes`, explicit `branches-to`/`retries` control relation | 관측된 실행, exception/return/data flow        |

## Source ↔ Constellation 왕복 탐색

분석된 소스 파일을 편집할 때 **Reveal in Constellation**을 누르면 `witch.architecture-projection/v1` source-neighborhood가 생성됩니다. 투영은 canonical IR을 다시 검증하고, 활성 파일에 직접 닿는 authored edge만 선택합니다. 관계 카드는 IR에 저장된 실제 import 줄을 열며, **Open source**는 편집기로 되돌아갑니다.

Dependencies 옵션을 끄면 외부 package 노드와 그 관계만 투영에서 제외됩니다. 내부 관계는 바뀌지 않습니다. 프로젝트에 없거나 분석기가 근거를 만들지 못한 파일은 Focus 버튼을 활성화하지 않습니다.

## Capability boundary

정적 import만으로 workflow, sequence, data flow, lifecycle을 만들면 그럴듯하지만 확인되지 않은 동작을 주장하게 됩니다. Witch는 import가 아니라 source-resolved call site와 명시적 제어 구문이 있는 경우에만 provisional Workflow control-flow를 만듭니다. 다음 항목을 accepted/observed 사실로 승격하려면 여전히 authored input이나 runtime trace가 필요합니다.

- Workflow: 확정 step 순서, 실제 선택 branch, exception/return
- Sequence: 관측되거나 작성된 call/return과 participant
- Data flow: source, transform, store, trust boundary
- Lifecycle: state, event, retry, cancel transition

TS/JS direct call은 `witch.semantic/v1`의 verified relation으로, Python/Rust 보수적 source binding은 inferred relation으로 저장됩니다. Workflow participant와 `precedes`/`branches-to`/`retries` 해석은 모두 provisional Meaning 계층에 남고 관계 설명에 runtime 비관측 경계를 표시합니다.

향후 각 입력은 별도의 typed IR과 validator를 가져야 합니다. AI는 근거 후보를 제안할 수 있지만, 검증되지 않은 제안을 canonical graph에 자동 합치지 않습니다.

이 설계는 [Archify](https://github.com/tt-a1i/archify)의 source-grounded multi-view 원칙을 참고해 Witch 안에 독립적으로 구현한 것입니다. Witch는 Archify 실행 파일이나 패키지에 런타임 의존하지 않습니다.
