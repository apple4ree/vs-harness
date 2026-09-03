# Framework Adapter fixed-corpus benchmark

<!-- witch-doc-languages: ko,en -->

> **한국어:** 고정 corpus에서 FastAPI, LangGraph, Celery, Express, NestJS, Next.js, Axum, Tokio adapter의 탐지·제외·검증 결과를 기록합니다.
>
> **English:** This dated report records detections, exclusions, and validation outcomes for the FastAPI, LangGraph, Celery, Express, NestJS, Next.js, Axum, and Tokio adapters on a fixed corpus.

- 실행일: 2026-09-01
- 계약: `witch.framework-benchmark/v1`
- corpus: `C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31`
- 원본 결과: `C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31\results-framework-v1.json`
- 안전 경계: repository code, build script, test, framework startup 실행 없음

## 결과

| Repository | Receipt | Detections | Candidates | Excluded | Detected adapters |
| --- | ---: | ---: | ---: | ---: | --- |
| THU-MAIC/OpenMAIC | valid | 145 | 87 | 0 | Next.js |
| K-Dense-AI/scientific-agent-skills | valid | 0 | 0 | 0 | — |
| Lakr233/vphone-cli | valid | 0 | 0 | 0 | — |
| tt-a1i/archify | valid | 0 | 0 | 0 | — |
| p-e-w/heretic | valid | 0 | 0 | 0 | — |
| unclecode/crawl4ai | valid | 11 | 66 | 2 | FastAPI |
| mvanhorn/last30days-skill | valid | 0 | 0 | 0 | — |
| majd/ipatool | valid | 0 | 0 | 0 | — |
| punkpeye/awesome-mcp-servers | valid | 0 | 0 | 0 | — |
| checkstyle/checkstyle | valid | 0 | 0 | 0 | — |

합계는 10/10 valid, detection 156, accepted candidate 153, exclusion 2다.
두 exclusion은 crawl4ai의 설정 객체에서 동적으로 정해지는 FastAPI health 및
Prometheus endpoint다. 경로 값을 실행하지 않고서는 확정할 수 없으므로 source
diagnostic으로 남기고 graph relation을 만들지 않았다.

0 candidate는 실패가 아니다. 현재 명시된 8개 adapter가 검출되지 않았거나, 검출된
source에서 양 끝점을 정적으로 확정할 수 없다는 뜻이다. Java/Go 저장소를 지원하는
것처럼 표시하지 않는다.

## Fixture acceptance

FastAPI, LangGraph, Celery, Express, NestJS, Next.js, Axum, Tokio 각각에 대해
최소 2개 positive와 2개 negative source fixture를 검사한다.

- static literal route + unique identifier handler는 candidate가 된다.
- 동적 path, lambda/property handler, 미등록 LangGraph node, Tokio async block,
  미해결 task target은 candidate가 되지 않는다.
- 모든 candidate는 versioned adapter ID, rule ID, source-backed endpoint,
  exact path/line/hash를 가진다.
- Framework candidate와 Behavior relation의 candidate/rule provenance가 다르면
  Architecture validation이 fail closed한다.

## 재실행

```powershell
npm run benchmark:frameworks -- `
  C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31 `
  C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31\results-framework-v1.json
```

이 benchmark는 지원 adapter가 실제 runtime에서 실행됐다는 증거가 아니다. 실제
route hit, task execution, graph branch, channel traffic 비교는 단계 6 Runtime Trace의
명시적 사용자 승인 범위다.
