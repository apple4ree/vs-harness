# 평가 한계

[한국어](limitations.ko.md) · [English](limitations.md)

## 제품 간 비교 한계

- 기능표는 같은 Task로 `measured`한 cell이 아니면 성능 근거가 아닙니다.
- IDE, ADE, Graph Explorer, Agent Harness, CUA는 선언한 공통 기능에서만 비교합니다.
- SWE-bench 계열 Patch 성공은 Editor 신뢰성, 시각적 이해, 승인 안전, rollback 품질을
  측정하지 않습니다.
- Terminal·Computer-use Benchmark는 신뢰할 수 없는 action을 실행할 수 있으므로
  일반 정적 Benchmark Runner보다 강한 격리가 필요합니다.
- Provider, model, reasoning effort, permission, context budget과 가격은 제품 구성의
  일부이며, 하나라도 바꾸면 직접적인 전후 비교가 아닙니다.
- P3 Human Comprehension과 광범위한 live P4 Agent 평가는 아직 protocol-defined 또는
  partial이므로 현재 날짜가 적힌 Witch 결과는 해당 Lane 완료를 주장하지 않습니다.

전체 세부 한계는 [영어판](limitations.md), 비교 방법은
[제품 벤치마크](product-benchmark.ko.md)를 참고하세요.

Federation의 Witch-owned 6개 Case는 회귀 동작을 측정할 뿐, 독립된 다중 저장소
System·Package Alias·Runtime Deployment Topology 정확도를 증명하지 않습니다.

현재 평가가 증명하지 못하는 언어 분석, 동적 실행, 제품 안정성, 보안, 원격 개발과 배포 범위를 명시합니다.

> 이 한국어판은 현재 관리되는 핵심 범위 요약을 제공합니다. 전체 기술 세부 내용과 원본 표는 [영어판](limitations.md)에서 확인할 수 있습니다.
