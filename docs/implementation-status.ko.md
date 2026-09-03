# Witch 0.2 구현 현황

[한국어](implementation-status.ko.md) · [English](implementation-status.md)

현재 Witch 0.2 preview에 실제 구현·검증된 기능, 의도적인 비지원 범위, 의존성 주의사항과 사용자 데이터 위치를 정리한 기준 문서입니다.

> 이 한국어판은 현재 관리되는 핵심 범위 요약을 제공합니다. 전체 기술 세부 내용과 원본 표는 [영어판](implementation-status.md)에서 확인할 수 있습니다.

Graph Intelligence v1은 검증된 Source·Semantic·Behavior Reading을 읽기 전용 typed multi-relation index로 투영합니다. Constellation의 새 패널에서 token-bounded 질의, 동명 심볼 ambiguity, 재현 가능한 관찰 커뮤니티, typed 변경 영향 경로와 Architecture Brief를 사용할 수 있습니다. Codex와 Claude에는 동일한 bounded query/brief를 `preflight-context`로 전달하며, 최종 Agent diff는 Witch가 직접 graph impact로 분석해 리뷰와 immutable Engineering Run에 기록합니다. 적용·archive·성공한 repair는 각각 useful·dead-end·corrected experience가 되고, 현재 source hash와 완전히 일치하는 경험만 다음 Agent context에 포함됩니다. 설명되지 않는 대규모 graph 감소는 격리되며 별도로 원자 저장한 last-known-good reading을 재시작 뒤에도 복원합니다. 실제 source 삭제는 허용하고 UI에서 재분석하거나 정확한 후보 revision을 명시적으로 승인할 수 있습니다. 이는 아직 Provider-native 동적 tool calling은 아닙니다. 상세 계약과 제한은 [Graph Intelligence v1 명세](graph-intelligence-v1.ko.md)에 고정되어 있습니다.

Architecture Knowledge v1은 ADR/RFC의 authored rationale, npm·Python·Cargo manifest의 verified package/dependency와 알려진 project configuration을 별도 overlay로 검증합니다. Graph Query·Impact·Brief·Agent preflight와 **Intelligence → Knowledge** 화면에서 사용하며 일반 설정 값과 script 본문은 저장하지 않습니다. 세부 규칙은 [Architecture Knowledge v1 명세](architecture-knowledge-v1.ko.md)에 있습니다.

Multi-resolution Meta Graph v1은 validated Semantic graph를 System → Community → Component → Workflow → Symbol의 derived 탐색 계층으로 집계합니다. **Intelligence → Map**에서 계층과 cross-boundary 관계를 분리해 drill-down하며, 원본 relation ID·trust·evidence를 보존하고 bounded 요약을 Codex/Claude 공통 preflight에 전달합니다. 세부 경계는 [Multi-resolution Meta Graph v1 명세](multi-resolution-meta-graph-v1.ko.md)에 있습니다.

다중 저장소 Federation v1은 활성 승인 Graph를 최근 비활성 프로젝트 최대 11개의 최신 Immutable Reading과 연결합니다. **Intelligence → Federation**은 같은 생태계의 정확한 Package Identity만 Matching하고, 독립 Graph Revision과 Evidence Hash를 보존하며, 중복 Provider를 conflicting 질문으로 드러냅니다. 휴대 가능한 `.witch/federation.json` Identity는 실제 Package 선언과 일치할 때 Source-authored Provider를 해결합니다. 명시적 Candidate 승인과 폐기는 Source 밖 Atomic Journal에 Event로 기록되며, Approval History 화면에서 적용·오래됨·폐기 상태를 확인할 수 있습니다. 로컬 Node 공간을 합치거나 Runtime Topology라고 주장하지 않습니다. 저장소 12개, Link 500개, Link당 Evidence 12개로 제한되며 Alias와 Service Endpoint는 v1 범위 밖입니다. 세부 경계는 [다중 저장소 Federation v1 명세](multi-repository-federation-v1.ko.md)에 있습니다.
