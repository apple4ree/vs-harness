# Witch 평가

[한국어](README.ko.md) · [English](README.md)

Witch는 제3자 benchmark source를 재배포하지 않으면서 측정 방법을 공개합니다. 모든 성능·품질 주장을 versioned analyzer, 선언된 corpus 역할, metric 정의와 재현 가능한 명령까지 추적할 수 있게 하는 것이 목표입니다.

## 평가 대상

| 축 | 질문 | 주된 근거 |
| --- | --- | --- |
| 제품 신뢰성 | ADE가 편집·분석·실행·디버그·검토·복구를 안전하게 수행하는가? | 단위·통합 테스트, 실제 Electron E2E, build와 package 검사 |
| 분석 충실도 | source 기반 구조·호출·Workflow·Behavior·framework registration을 복원하는가? | 수동·외부 oracle, validation receipt, 회귀 저장소 |
| 규모와 자원 | 대형 프로젝트에서도 분석 한도가 유지되는가? | cold/warm/incremental 시간, peak process RSS, projection limit |
| 표현 품질 | 사람이 결과와 근거를 조사할 수 있는가? | 결정적 layout 검사, visual validation, screenshot review |
| Agent Harness | 변경이 격리되고 검토 가능하며 제한·재생 가능한가? | offline provider matrix, fault injection, immutable journal과 diff 검사 |

## 공개 평가 문서

- [방법론](methodology.ko.md): 평가 lane, 실행 경계와 과적합 방지 규칙
- [데이터셋](datasets.ko.md): 외부 source, revision pin, 선택 규칙과 저장소에 포함하지 않는 항목
- [지표](metrics.ko.md): precision, recall, F1, coverage와 non-vacuous case의 정확한 정의
- [재현](reproducibility.ko.md): 명령과 필수 보고 metadata
- [한계](limitations.ko.md): 현재 결과가 증명하지 않는 범위
- [호출 그래프 결과 · 2026-09-02](results/callgraph-2026-09-02.ko.md): 현재 development·holdout 측정
- [제품 품질 결과 · 2026-09-02](results/product-quality-2026-09-02.ko.md): 현재 source build 검증

## 공개 규칙

결과를 공개하려면 source revision, analyzer 또는 application version, corpus 역할과 규모, 환경, 명령, 실행 정책, 실패와 metric validity를 기록해야 합니다. Micro와 macro 측정값은 하나의 점수로 합치지 않습니다. 높은 scoped 점수는 oracle coverage와 나란히 표시해야 합니다.

Witch는 제3자 benchmark checkout, 생성된 trace, 로컬 절대 경로, credential 또는 blind-holdout edge 실패를 커밋하지 않습니다. 저장소에는 manifest, runner code, 로컬 fixture의 aggregate receipt와 사람이 읽을 수 있는 방법론만 포함합니다.
