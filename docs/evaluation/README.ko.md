# Witch 평가

[한국어](README.ko.md) · [English](README.md)

Witch는 제3자 benchmark source를 재배포하지 않으면서 측정 방법을 공개합니다. 모든 성능·품질 주장을 versioned analyzer, 선언된 corpus 역할, metric 정의와 재현 가능한 명령까지 추적할 수 있게 하는 것이 목표입니다.

## 평가 대상

| 축            | 질문                                                                         | 주된 근거                                                   |
| ------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 분석 충실도   | Source 기반 구조·호출·Workflow·Behavior·Framework registration을 복원하는가? | 수동·외부 oracle, validation receipt, 회귀 저장소           |
| 설명 사용성   | 사람이 Architecture 질문에 답하고 정확한 source evidence까지 도달하는가?     | Comprehension task, 결정적 layout 검사, visual validation   |
| 개발 Workflow | ADE가 검색·LSP·실행·Debug·복구 과정에서 편집 내용을 보존하는가?              | 단위·통합 테스트, 실제 Electron E2E, build·package 검사     |
| Agent Harness | 변경이 유효하고 격리·검토·제한·재생 가능한가?                                | Task 결과, Provider matrix, immutable journal·diff 검사     |
| 안전·거버넌스 | 권한·범위·승인·secret·rollback·audit 경계가 fail closed인가?                 | Fault injection, canary, 승인·receipt 무결성 검사           |
| 규모·효율     | 대형 프로젝트에서 분석과 Interaction 한도가 유지되는가?                      | Cold/warm/incremental 시간, peak RSS, projection·UI latency |

## 공개 평가 문서

- [방법론](methodology.ko.md): 평가 lane, 실행 경계와 과적합 방지 규칙
- [데이터셋](datasets.ko.md): 외부 source, revision pin, 선택 규칙과 저장소에 포함하지 않는 항목
- [지표](metrics.ko.md): precision, recall, F1, coverage와 non-vacuous case의 정확한 정의
- [제품 벤치마크](product-benchmark.ko.md): 제품 유형, 독립된 6개 평가 축, 근거 수준과 외부 adapter
- [Graph 전달과 시각 검증](visual-validation.ko.md): projection, 실제 DOM, last-good, visual matrix와 사람 review gate
- [Federation 벤치마크](../../benchmarks/federation/README.ko.md): 정확한 저장소 간 Link, 모호성, Authorship, Approval, Staleness와 입력 순서 불변성
- [재현](reproducibility.ko.md): 명령과 필수 보고 metadata
- [한계](limitations.ko.md): 현재 결과가 증명하지 않는 범위
- [호출 그래프 결과 · 2026-09-02](results/callgraph-2026-09-02.ko.md): 현재 development·holdout 측정
- [제품 품질 결과 · 2026-09-02](results/product-quality-2026-09-02.ko.md): 현재 source build 검증

## 공개 규칙

결과를 공개하려면 source revision, analyzer 또는 application version, corpus 역할과 규모, 환경, 명령, 실행 정책, 실패와 metric validity를 기록해야 합니다. Micro와 macro 측정값은 하나의 점수로 합치지 않습니다. 높은 scoped 점수는 oracle coverage와 나란히 표시해야 합니다.

Witch는 제3자 benchmark checkout, 생성된 trace, 로컬 절대 경로, credential 또는 blind-holdout edge 실패를 커밋하지 않습니다. 저장소에는 manifest, runner code, 로컬 fixture의 aggregate receipt와 사람이 읽을 수 있는 방법론만 포함합니다.
