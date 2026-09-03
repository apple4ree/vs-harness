# 평가 방법론

[한국어](methodology.ko.md) · [English](methodology.md)

development·holdout·blind-holdout 평가 lane, micro·macro 규모, 과적합 방지 규칙과 결과 공개 조건을 정의합니다.

> 이 한국어판은 현재 관리되는 핵심 범위 요약을 제공합니다. 전체 기술 세부 내용과 원본 표는 [영어판](methodology.md)에서 확인할 수 있습니다.

## 제품 간 비교 원칙

Witch를 구조 탐색기, IDE, ADE, Agent Harness 또는 Computer-use System과 비교하기
전에 제품 유형과 적용 가능한 Task를 선언합니다. 각 주장은 `documented`,
`observed`, `measured`로 구분하며 문서상 기능을 측정된 동작으로 계산하지 않습니다.

비교 대상 구성은 제품 build, Provider·adapter, model, reasoning 설정, permission,
benchmark revision과 환경을 모두 포함합니다. 다른 구성의 결과를 합치지 않고,
적용 가능한 실패·timeout·refusal·infrastructure failure를 보존합니다. 제품 유형 밖의
기능은 `not-applicable`, 지원한다고 주장했지만 완료하지 못한 기능은 `fail`입니다.

분석 충실도, 설명 사용성, 개발 Workflow, Agent Harness, 안전·거버넌스, 규모·효율은
각각 보고하며 가중 종합 점수로 합치지 않습니다. 전체 기준은
[제품 벤치마크](product-benchmark.ko.md)를 따릅니다.
