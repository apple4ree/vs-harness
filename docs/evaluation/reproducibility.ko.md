# Witch 평가 재현

[한국어](reproducibility.ko.md) · [English](reproducibility.md)

## 제품 벤치마크 계약

제품 유형, 독립 평가 축과 종합 점수 금지 원칙은 다음 명령으로 검사합니다.

```sh
npm run benchmark:product:check
```

이 명령은 로컬 JSON 계약만 검사합니다. 외부 Benchmark·제품·Provider를 다운로드하거나
실행하지 않고, container·VM도 시작하지 않습니다. 전체 실행 환경과 외부 corpus 재현
절차는 [영어판](reproducibility.md), 해석 원칙은
[제품 벤치마크](product-benchmark.ko.md)를 참고하세요.

Witch가 소유한 npm·Python·Cargo 다중 저장소 Fixture는 다음 명령으로 검사합니다.

```sh
npm run benchmark:federation:check
```

저장소 코드는 실행하지 않으며 Link, 질문, Authored Mapping, Approval, Staleness,
Validation과 입력 순서 불변성을 별도 지표로 보고합니다.

Witch의 소스 검증, offline Agent 평가, 내장 fixture와 외부 호출 그래프 평가를 같은 조건에서 재현하는 명령·환경·보고 규칙입니다.

> 이 한국어판은 현재 관리되는 핵심 범위 요약을 제공합니다. 전체 기술 세부 내용과 원본 표는 [영어판](reproducibility.md)에서 확인할 수 있습니다.
