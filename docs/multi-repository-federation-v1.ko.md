# Witch 다중 저장소 Federation v1

[한국어](multi-repository-federation-v1.ko.md) · [English](multi-repository-federation-v1.md)

상태: preview 구현 완료
계약: `witch.graph-federation/v1`
알고리즘: `exact-package-identity-v1`

## 목적

Federation은 따로 분석한 저장소들이 하나의 시스템을 이룰 가능성을 보여주되, 하나의 Source Tree인 것처럼 위장하지 않는다. **Intelligence → Federation**에서 최근 프로젝트의 최신 저장 Reading을 선택하면 읽기 전용 System Map을 만든다.

현재 Witch는 한 저장소가 Dependency를 선언하고 다른 저장소가 같은 생태계에서 동일한 정규화 Package Identity를 선언한 경우에만 저장소 간 Link를 만든다. npm, Python, Cargo Identity는 서로 섞지 않는다.

## 신뢰·Revision 경계

- 각 저장소는 고유 Workspace Root와 Source, Semantic, Behavior, Knowledge, Meta Graph Revision을 유지한다.
- 로컬 Node ID 공간을 합치지 않는다. Federation Link는 추측한 내부 Symbol이 아니라 Repository ID를 연결한다.
- 검증되고 승인된 Graph Reading만 허용한다. 격리된 last-known-good fallback으로 새 Federation을 만들 수 없다.
- 다른 저장소는 변경 불가능한 Snapshot Reading이며, 활성 저장소는 현재 화면에 표시 중인 승인 Graph를 사용한다.
- 저장소 간 Link는 `inferred`·`provisional`이다. Manifest 일치는 Runtime Deployment 연결의 증명이 아니다.
- 저장소에 작성한 Mapping이 일치하거나 UI에서 Provider를 명시적으로 승인한 경우에만 해당 Link가 `authored/resolved`로 바뀐다.
- 양쪽 Evidence에 선언 Repository ID, 상대 Path, Line, Source Hash를 보존한다.

## 입력 선택

Main Process는 최근 비활성 프로젝트마다 최신 Snapshot 하나만 제공하고 최대 11개로 제한한다. 활성 프로젝트와 합쳐 Federation 하나의 최대 저장소 수는 12개다. IPC 호출자가 임의 ID나 과거 Snapshot을 선택할 수 없다.

저장소는 먼저 열어서 **Read structure**를 실행해 검증된 Reading을 저장해야 한다. 프로젝트를 열거나 Federation을 생성할 때 Source, Task, Build Script, Package Manager는 실행하지 않는다.

## Authored Repository Mapping

각 참여 저장소는 로컬 절대경로 대신 휴대 가능한 Key를 사용하는 `.witch/federation.json`을 둘 수 있다.

```json
{
  "version": 1,
  "repositoryKey": "witch-app",
  "mappings": [
    {
      "ecosystem": "npm",
      "package": "@witch/core",
      "provider": "witch-core"
    }
  ]
}
```

Provider 저장소는 일치하는 자체 `repositoryKey`를 선언한다. Witch는 Repository Identity와 각 Mapping을 Source-backed `authored` Knowledge Node로 저장한다. 선택 저장소 중 정확히 하나가 해당 Key와 정확한 Package 선언을 모두 가질 때만 Link를 해결한다. Key 누락·중복, 상충 Mapping, Package 불일치는 열린 `authored-mismatch` 질문으로 남긴다.

## 명시적 Approval Journal

추론된 중복 Provider 질문에는 정확한 후보별 **Approve** 동작이 표시된다. Main Process는 Federation을 다시 생성해 Revision과 Candidate Endpoint를 확인한 다음 Atomic App-data Journal에 `witch.federation-approval/v1`을 추가한다. Receipt는 Question, 이전 Federation Revision, Ecosystem/Package, 양쪽 Workspace Root와 Source Revision에 결박되며 Repository Content는 수정하지 않는다.

Subject/Provider Revision이 모두 일치하는 가장 최근 Approval만 적용한다. Source가 바뀌면 과거 Approval은 자동으로 적용 대상에서 제외되지만 History에는 남는다. Repository-authored Mapping이 우선하며 UI가 Authored Mismatch를 조용히 덮어쓸 수 없다.

Federation Approval History는 적용·활성·대체·오래됨·현재 Map 밖·폐기 상태를 구분한다. 폐기는 두 번째 확인을 요구하며 `witch.federation-approval-revocation/v1` Event를 추가한다. 같은 Question, Subject Revision, Ecosystem, Package 범위의 이전 Approval을 모두 무효화하므로 더 오래된 Provider 선택이 조용히 되살아나지 않는다. 이후 명시적으로 다시 승인하면 새로운 감사 가능 결정이 된다.

## Matching 규칙

Package Name은 Unicode NFKC와 소문자 비교를 사용한다. Python에만 PEP 503에 따라 Hyphen·Underscore·Dot 연속 구분자를 동일하게 처리하고 npm과 Cargo의 구분자는 보존한다. Link 생성 조건은 다음과 같다.

1. `npm`, `python`, `cargo` 생태계가 같다.
2. 정규화한 Dependency와 Provider Package Identity가 같다.
3. Repository Root가 서로 다르다.
4. Dependency 선언과 Package 선언 Evidence의 Source Hash가 모두 유효하다.

Provider가 하나면 Confidence `0.86` Link를 만든다. 두 개 이상의 선택 저장소가 같은 Package를 선언하면 모든 후보를 Confidence `0.45`로 유지하고 Link를 `conflicting`으로 표시하며 열린 Grill-me 질문을 만든다. 일치하는 Authored Mapping은 `1.0`, 정확한 UI Approval은 `0.98`로 해결한다. 중복 Provider 하나를 조용히 선택하지 않는다.

Link 하나는 Dependency 선언과 Package 선언을 균등하게 제한해 최대 12개 Evidence를 유지한다. Federation은 최대 500개 Link를 담고 잘림을 Diagnostic으로 보고한다.

## Validation Receipt

결정적 Federation Revision은 정규 순서의 Repository, Link, Question과 Evidence를 포함한다. 다음 경우 검증을 거부한다.

- 중복 Repository Root 또는 ID
- 오래된 Source/Semantic/Behavior/Knowledge Revision
- 누락·중복 Link ID 또는 잘못된 Endpoint
- Repository가 없거나 Hash·Line·Declaration Role이 잘못된 Evidence
- 유효한 Target이 두 개 미만인 Ambiguity Question
- 일치하는 Source-authored Mapping 또는 Revision-bound Approval Receipt가 없는 Resolved Link
- Federation Revision과 일치하지 않는 내용

동일한 승인 Graph 입력은 선택 순서와 무관하게 같은 Repository 순서, Link, Question, Federation Revision을 만든다.

## 현재 한계

- Git URL, Package Rename, Publish Alias, Service URL, Queue, Database, RPC Schema, Runtime Topology는 연결하지 않는다.
- 화면에서 활성 저장소 Evidence만 Source로 열 수 있다. Snapshot Evidence는 Path와 Line을 읽기 전용으로 표시한다.
- Federation은 요청 시 생성하며 별도 Historical Artifact로 저장하거나 Agent Preflight Context에 전달하지 않는다.
- Approval과 Revocation History는 종류별 최대 1,000개로 제한한다. 화면은 최신 Approval 100개와 전체 보존 수를 표시한다. Export와 장치 간 동기화는 아직 없다.
