# Behavior Overlay fixed-corpus benchmark

<!-- witch-doc-languages: ko,en -->

> **한국어:** 2026-09-01 고정 GitHub corpus에서 Behavior overlay의 relation 수, 검증 상태와 진단 결과를 측정한 기록입니다. 프로젝트 코드는 실행하지 않았습니다.
>
> **English:** This dated report records Behavior-overlay relation counts, validation states, and diagnostics on the fixed GitHub corpus without executing repository code.

- 실행일: 2026-09-01
- 계약: `witch.behavior-benchmark/v1`
- 분석기: repository source를 실행하지 않는 정적 분석
- corpus: `C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31`
- 원본 결과: `C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31\results-behavior-v1.json`

## 결과

10개 저장소 모두 Architecture, Semantic, Behavior validation receipt가 유효했다.
Behavior diagnostic은 0건이며 총 29,019개의 relation을 만들었다.

| Repository | Behavior | Values | Relations | Verified | Inferred | Diagnostics |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| THU-MAIC/OpenMAIC | valid | 15,983 | 15,983 | 15,983 | 0 | 0 |
| K-Dense-AI/scientific-agent-skills | valid | 3,714 | 3,714 | 0 | 3,714 | 0 |
| Lakr233/vphone-cli | valid | 276 | 276 | 0 | 276 | 0 |
| tt-a1i/archify | valid | 3,715 | 3,715 | 3,715 | 0 | 0 |
| p-e-w/heretic | valid | 36 | 36 | 0 | 36 | 0 |
| unclecode/crawl4ai | valid | 2,339 | 2,339 | 182 | 2,157 | 0 |
| mvanhorn/last30days-skill | valid | 2,791 | 2,791 | 173 | 2,618 | 0 |
| majd/ipatool | valid | 0 | 0 | 0 | 0 | 0 |
| punkpeye/awesome-mcp-servers | valid | 0 | 0 | 0 | 0 | 0 |
| checkstyle/checkstyle | valid | 165 | 165 | 165 | 0 | 0 |

0 relation은 실패가 아니다. 현재 deep Behavior 언어 경계인 TypeScript/JavaScript,
Python, Rust에서 확인 가능한 direct binding이 없으면 빈 graph와 유효한 receipt를
반환한다. 예를 들어 Go 중심 저장소를 지원하는 것처럼 표시하지 않는다.

## 검증한 성질

- relation마다 기존 Semantic endpoint, source evidence, analyzer/policy provenance가 있다.
- TypeChecker가 직접 확인한 TypeScript binding은 Verified이다.
- Python/Rust source-resolved direct binding은 runtime rebinding 가능성을 남겨 Inferred이다.
- spread/variadic/property/dynamic call 후보는 이름 유사성으로 연결하지 않는다.
- Behavior 생성 전후 Architecture/Semantic relation count는 바뀌지 않는다.
- repository code, build script, framework startup, test command는 실행하지 않는다.

## 현재 해석 경계

이 수치는 정확도나 runtime coverage 점수가 아니라 계약을 통과한 정적 후보 수다.
대형 TypeScript 저장소의 많은 relation은 direct argument binding의 양을 의미하며,
실제 실행 빈도나 중요도를 뜻하지 않는다. Framework route/task/message/DB lineage는
단계 5 adapter, 정적 후보와 실제 실행 비교는 단계 6 trace/evaluation 범위다.

## 재실행

```powershell
npm run benchmark:behavior -- `
  C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31 `
  C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31\results-behavior-v1.json
```
