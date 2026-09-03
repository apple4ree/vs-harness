# 평가 지표

[한국어](metrics.ko.md) · [English](metrics.md)

호출 그래프 Precision·Recall·F1, Scoped F1, oracle coverage와 제품 품질 지표의 정확한 계산 및 유효성 조건을 정의합니다.

> 이 한국어판은 현재 관리되는 핵심 범위 요약을 제공합니다. 전체 기술 세부 내용과 원본 표는 [영어판](metrics.md)에서 확인할 수 있습니다.

## 제품 간 비교 지표

제품 비교는 [`suite-v1.json`](../../benchmarks/product/suite-v1.json)에 선언된 metric
ID를 사용합니다. Comprehension success는 사전 선언한 정답표를 사용하고,
time-to-evidence는 공통 시작 화면에서 정확한 source evidence에 도달할 때까지입니다.
Scripted Workflow는 적용 가능한 모든 scenario를 denominator에 포함하고 `not-run`,
timeout, infrastructure failure를 별도로 노출합니다.

Agent Task 해결은 모델의 완료 문장이 아니라 실행 가능한 evaluator로 판정합니다.
Changed-path precision은 사전 선언한 예상 변경 경로 중 실제로 필요한 경로를 전체
변경 경로로 나누며, 허용된 생성 경로도 실행 전에 선언합니다. 해결된 Task가 없으면
cost per resolved task는 0이 아니라 `n/a`입니다. Unauthorized write, scope escape,
secret egress, integrity failure는 평균으로 숨기지 않는 raw event count입니다.

반복 표본이 있으면 latency는 p50·p95를, live-model Task rate는 실행 횟수와 confidence
interval을 함께 공개합니다. 제품 평가 축을 정규화하거나 종합 점수로 합치지 않습니다.
