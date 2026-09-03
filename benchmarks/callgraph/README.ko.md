# 호출 그래프 평가 세트

[한국어](README.ko.md) · [English](README.md)

공개 정의와 해석 규칙:

- [평가 방법론](../../docs/evaluation/methodology.ko.md)
- [데이터셋 선언](../../docs/evaluation/datasets.ko.md)
- [지표 정의](../../docs/evaluation/metrics.ko.md)
- [재현 안내](../../docs/evaluation/reproducibility.ko.md)
- [최신 날짜별 결과](../../docs/evaluation/results/callgraph-2026-09-02.ko.md)

Witch는 호출 그래프 corpus를 평가 역할과 규모에 따라 분리합니다. 보고된 점수에는 두 항목이 모두 명시되어야 합니다.

| Suite | 역할 | 규모 | 규칙 |
| --- | --- | --- | --- |
| SWARM-CG Python | development | micro | 고정 회귀 세트이며 개별 실패만 보고 새 규칙을 선택하지 않음 |
| Witch Rust v1 | development | micro | 로컬 회귀 세트이며 개선으로 알려진 gap을 닫을 수 있음 |
| PyAnalyzer newly-added | holdout | micro | 평가 checkpoint에서만 실행 |
| PyAnalyzer macro C | holdout | macro | 실제 프로젝트 5개를 프로젝트별로 별도 보고 |
| DyPyBench released pilot | blind holdout | macro/dynamic | 고정 프로젝트 5개를 공개된 test-observed edge와만 비교 |

`benchmark-callgraph.ts`는 선택적인 manifest를 받습니다. Corpus root는 manifest의 `subpath`가 가리키는 디렉터리입니다.

```powershell
npx tsx scripts/benchmark-callgraph.ts <corpus-root> <output.json> --manifest benchmarks/callgraph/pyanalyzer-macro-c-holdout.json
```

Development 결과는 구현 중 확인할 수 있습니다. Holdout aggregate 결과는 checkpoint에서만 확인하며 개별 누락을 같은 구현 주기의 규칙 변경에 사용하지 않습니다. Blind holdout의 aggregate와 프로젝트별 결과는 checkpoint에 기록할 수 있지만 edge 단위 실패는 구현 작업에 공개하지 않습니다. 전체 DyPyBench trace 재생성은 격리된 release-candidate 작업이며, 저장소 manifest는 공식 공개된 소규모 결과 archive를 사용합니다.

모든 보고서는 oracle edge coverage와 non-vacuous exact accuracy를 포함합니다. 빈 precision 분모는 완벽한 성능이 아니라 `n/a`로 표시되도록 metric validity도 기록합니다. Micro와 macro 결과를 하나의 F1 점수로 합치지 않습니다.
