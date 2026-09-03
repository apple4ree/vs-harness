# 제품 벤치마크 계약

[한국어](README.ko.md) · [English](README.md)

이 디렉터리는 Witch를 코드 구조 탐색기, IDE, ADE, Coding Agent Harness,
Computer-use Agent와 비교하기 위한 기계 판독 계약을 담습니다. 순위표나 외부
제품 binary를 저장하지 않습니다.

## 파일

- `suite-v1.json`: 도구 유형, 독립 평가 축, 지표, 실행 lane과 외부 benchmark
  adapter를 선언합니다.
- `scripts/check-product-benchmark.ts`: 중복 ID, 잘못된 참조와 가중 종합 점수를
  거부합니다.
- `tests/product-benchmark.test.ts`: 계약과 종합 점수 금지 원칙을 회귀
  테스트합니다.

다음 명령으로 계약을 검사합니다.

```sh
npm run benchmark:product:check
```

지표의 규범적 해석과 결과 공개 절차는
[제품 벤치마크 안내서](../../docs/evaluation/product-benchmark.ko.md)에 있습니다.

## 중요한 경계

`candidate`, `planned`, `deferred`, `reference-only` adapter는 구현되거나 측정된
Witch 결과가 아닙니다. 외부 task는 신뢰할 수 없는 프로젝트 코드를 실행하고,
container·VM 또는 유료 모델을 요구하거나 benchmark 데이터를 Provider에 보낼 수
있습니다. 따라서 별도 환경과 명시적인 opt-in 없이 실행하지 않습니다.
