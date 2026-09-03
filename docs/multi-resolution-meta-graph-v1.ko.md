# Witch Multi-resolution Meta Graph v1 명세

[한국어](multi-resolution-meta-graph-v1.ko.md) · [English](multi-resolution-meta-graph-v1.md)

상태: P2 두 번째 단계 구현
계약: `witch.graph-meta/v1`
입력: 검증된 `witch.architecture/v1`, 선택적 Semantic·Behavior·Knowledge overlay

## 1. 목적

대형 저장소의 모든 노드와 관계를 한 화면에 축소하면 분석량은 많아도 사람이 구조를 읽을 수 없다. Meta Graph는 동일한 validated graph를 `System → Community → Component → Workflow → Symbol` 해상도로 집계해, 사용자가 개요에서 source evidence까지 단계적으로 내려가게 한다.

이 계층은 탐색용 derived projection이다. Community와 fallback ownership을 authored architecture로 저장하거나 Semantic IR을 수정하지 않는다.

## 2. 계층

- **System:** 현재 workspace의 단일 탐색 root
- **Community:** deterministic modularity projection으로 관찰한 결합군
- **Component:** Semantic `component`, `module`, `package` 경계
- **Workflow:** Semantic workflow와, workflow가 없는 symbol을 보존하기 위한 명시적 derived fallback group
- **Symbol:** Semantic symbol과 workflow step

각 meta node는 실제 member 수, bounded member preview, child ID, source path, kind별 수, hub ID, assignment rule을 보존한다. 160개를 넘는 member는 전체 수와 truncation을 남기고 preview만 저장한다.

## 3. 소유권 우선순위

1. `contains` 또는 `defines` 관계 중 Authored, Verified, Observed, Inferred 신뢰도 순
2. 정확히 하나만 일치하는 source path affinity
3. 같은 observed community 안의 `unassigned` fallback group

동일 path에 후보가 여러 개면 임의의 하나를 고르지 않는다. 별도의 derived fallback에 넣으며 `META_FALLBACK_OWNERSHIP` warning을 남긴다.

## 4. 관계 집계

기존 typed relation을 각 해상도의 owner 사이로 투영한다. 같은 방향과 해상도를 가진 관계는 하나의 meta edge로 묶고 다음을 유지한다.

- 실제 relation 수와 종류
- 최대 80개의 원본 relation ID와 omitted 수
- trust별 relation 수
- 평균 confidence
- source hash가 포함된 최대 8개의 evidence

Self-edge가 되는 내부 관계는 해당 단계에서 숨긴다. 하위 해상도로 들어가면 다시 실제 경계 간 관계로 나타난다.

## 5. 검증과 안전 경계

- Source, Semantic, Behavior, Knowledge revision을 정확히 결박한다.
- 단일 System root와 `System → Community → Component → Workflow → Symbol` parent/child 왕복 관계를 검증한다.
- Meta edge endpoint와 level, relation 수, evidence path/hash를 검증한다.
- 정규화된 node·edge 내용과 deterministic meta revision의 일치를 검증한다.
- 최대 12,000 meta nodes와 20,000 meta edges를 허용한다.
- UI frame은 한 단계에서 최대 40개를 기본 표시하고 omitted 수를 공개한다.
- 같은 입력 배열을 역순으로 전달해도 node, edge, revision은 동일해야 한다.

검증 실패한 meta graph는 화면 또는 Agent context로 전달하지 않는다.

## 6. 제품 동작

Constellation의 **Intelligence → Map**에서 현재 focus를 왼쪽에 두고 다음 해상도의 child를 오른쪽에 표시한다. 실선은 계층, 점선은 현재 해상도에서 집계한 typed relation이다. Breadcrumb으로 상위 단계로 돌아가고 leaf에서는 source를 연다. Source-backed meta node는 Agent context에도 첨부할 수 있다.

Codex와 Claude의 공통 preflight에는 전체 그래프 대신 계약 revision, level별 수, 상위 community 12개와 bounded source path만 전달한다. Provider가 대형 graph 전체를 무제한으로 받지는 않는다.

## 7. 의도적인 한계

- Community는 전체 최적 partition이라는 주장이 아니다.
- Fallback group은 실제 component/workflow라는 주장이 아니다.
- 동적 dispatch, runtime frequency, 실제 branch 선택은 Runtime Trace 없이 추론하지 않는다.
- 현재 하나의 workspace만 대상으로 한다. 다중 저장소 federation은 다음 P2 단계다.

## 8. 완료 기준

- Community에서 Component, Workflow, Symbol까지 클릭해 내려갈 수 있다.
- 명시적 containment가 path/community fallback보다 우선한다.
- parallel relation이 개수와 종류를 잃지 않고 집계된다.
- 변조된 evidence는 fail-closed한다.
- Meta summary가 Provider-neutral Agent preflight에 bounded 형태로 포함된다.
- 실제 Electron E2E가 System에서 Community 해상도로 이동한다.
