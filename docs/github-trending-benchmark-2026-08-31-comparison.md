# GitHub Trending Top 10 — Witch 개선 전후 비교 벤치마크

- 측정일: 2026-08-31 (Asia/Seoul)
- 기준 보고서: `docs/github-trending-benchmark-2026-08-31.md`
- 대상: 기준 보고서와 동일한 10개 checkout 및 동일 commit
- 안전 조건: 저장소 코드는 실행하지 않았다. 의존성 설치, import, build, test, task도 수행하지 않았다.
- 분석 개선 결과 JSON: `C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31\results-current`
- summary-first 결과 JSON: `C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31\results-summary-first`

## 이번 실행이 추가로 검증한 것

각 저장소에서 다음 순서를 실행했다.

1. Witch의 정상 ignore·크기 제한을 적용한 workspace listing
2. 기존 인덱스를 지운 cold 정적 분석
3. 같은 프로세스·같은 분석 서비스의 warm 분석
4. 분석 서비스를 폐기하고 새 서비스를 만든 뒤 영속 인덱스 재사용 분석
5. Pyright/rust-analyzer를 이용한 bounded call corroboration
6. Modules와 여섯 Semantic lens 투영 및 시각 품질 receipt 검증
7. 발견된 모든 Workflow를 각각 sequence·collapsed-branch 화면으로 투영해 품질 검증

`Deep`은 TypeScript/JavaScript, Python, Rust의 심볼·import 분석을 뜻한다. 그 밖의 언어는 파일을 인덱싱하더라도 `file-only`로 기록한다. 따라서 coverage는 파일 목록과 의미 분석 범위를 혼동하지 않는다.

## 핵심 결과

| 지표 | 개선 전 | 현재 | 변화 |
| --- | ---: | ---: | ---: |
| 정상 완료 | 9/10 | **10/10** | Crawl4AI fail-closed 해결 |
| 전체 파일 | 16,980 | 16,980 | 동일 corpus |
| 현재 indexed | 측정 의미가 불명확 | 14,132 | 명시적 coverage |
| 현재 deep | 성공 9개 3,627 | 4,147 | Crawl4AI 520개 포함 |
| 현재 file-only | 미표시 | 9,981 | 미지원 언어를 정직하게 표시 |
| 비교 가능한 9개의 Workflow | 356 | **194** | **-45.5%** |
| 현재 전체 Workflow | — | 255 | production 209, support 46 |
| cold 총시간 | 39.483초, 성공 9개 | **37.562초, 전체 10개** | **-4.9%**, 범위는 더 큼 |
| warm 총시간 | 36.329초, 성공 9개 | **15.712초, 전체 10개** | **-56.8%** |
| 앱 재시작형 persistent 총시간 | 미지원 | **18.597초** | 14,124 parsed entry 재사용 |
| Meaning Overview 품질 통과 | 미측정 | **10/10** | 모든 저장소 통과 |
| 개별 Workflow 품질 | 미측정 | **246 pass / 9 warning / 0 fail** | 드릴다운은 안정적 |
| 전체 Workflow 지도 품질 | 미측정 | **summary-first: 0 fail, 5 pass, 5 warning** | 기존 7 fail 제거 |

현재 corpus의 deep coverage는 4,147/16,980, 약 24.4%다. 14,132개 indexed 파일 중 9,981개는 file-only다. 분석 결과를 과장하지 않게 된 것은 개선이지만, 언어 중립적인 의미 분석 엔진이 된 것은 아니다.

## 저장소별 결과

시간은 `개선 전 → 현재`이며 초 단위다. `Focused`는 개별 Workflow 화면의 `pass / warning / fail` 수다.

| # | 저장소 | 완료 | Deep/전체 | File-only | Workflow 전→후 | Prod/Support | Cold | Warm | Restart index | Overview | 전체 Workflow | Focused |
| --: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| 1 | OpenMAIC | PASS→PASS | 85.2% | 225 | 100→42 | 30/12 | 14.283→14.016 | 11.916→8.065 | 9.454 | pass | warning | 38/4/0 |
| 2 | scientific-agent-skills | PASS→PASS | 27.9% | 1,361 | 100→100 | 100/0 | 5.168→4.648 | 5.332→2.467 | 2.961 | pass | warning | 100/0/0 |
| 3 | vphone-cli | PASS→PASS | 9.2% | 237 | 14→11 | 11/0 | 0.465→0.394 | 0.445→0.111 | 0.122 | pass | warning | 10/1/0 |
| 4 | archify | PASS→PASS | 33.7% | 233 | 39→14 | 4/10 | 2.268→2.062 | 1.753→0.911 | 0.996 | pass | pass | 14/0/0 |
| 5 | heretic | PASS→PASS | 33.3% | 4 | 3→2 | 2/0 | 0.117→0.099 | 0.084→0.057 | 0.068 | pass | pass | 1/1/0 |
| 6 | crawl4ai | **FAIL→PASS** | 57.8% | 238 | —→61 | 49/12 | —→2.589 | —→1.508 | 1.973 | pass | warning | 60/1/0 |
| 7 | last30days-skill | PASS→PASS | 70.1% | 107 | 100→25 | 13/12 | 1.818→1.623 | 1.817→1.065 | 1.463 | pass | warning | 23/2/0 |
| 8 | ipatool | PASS→PASS | 0.0% | 147 | 0→0 | 0/0 | 0.209→0.166 | 0.207→0.022 | 0.022 | pass | pass | 0/0/0 |
| 9 | awesome-mcp-servers | PASS→PASS | 0.0% | 10 | 0→0 | 0/0 | 0.033→0.033 | 0.027→0.006 | 0.007 | pass | pass | 0/0/0 |
| 10 | checkstyle | PASS→PASS | 0.1% | 7,419 | 0→0 | 0/0 | 15.122→11.932 | 14.748→1.500 | 1.531 | pass | pass | 0/0/0 |

## 무엇이 실제로 좋아졌나

### 1. 임의 저장소에서의 robust completion

Crawl4AI의 minified JavaScript 한 줄에서 같은 이름의 심볼이 반복되던 경우가 더 이상 전체 분석을 중단시키지 않는다. exact source position으로 ID를 분리하고 경고를 남겼다. 따라서 동일 commit에서 9/10이던 완료율이 10/10이 됐다.

### 2. Workflow 수가 줄었지만 설명력은 더 정직해졌다

기존에 성공했던 동일 9개 저장소에서 Workflow 후보가 356개에서 194개로 45.5% 감소했다. 단순히 `agent`, `run` 같은 단어가 포함됐다는 이유만으로 UI 컴포넌트와 utility를 Workflow로 올리던 규칙을 제거하고, route·command·scheduler·listener·canonical entrypoint 같은 source evidence를 요구한 결과다.

현재 255개 중 209개는 production 경로, 46개는 test/docs/example 계열이다. support tree는 저장소당 최대 12개만 기본 그래프에 남기며, 생략된 수는 coverage limit으로 표시한다. 다만 labeled ground truth가 없으므로 이 감소를 정식 precision 향상률로 해석해서는 안 된다.

### 3. 증분 인덱스는 특히 file-only 대형 저장소에서 효과가 크다

Cold에서 분석한 14,128개 entry 중 14,124개가 새 분석 서비스에서 persistent hit로 재사용됐다. 네 파일은 크기 제한으로 분석되지 않은 파일이다.

- Checkstyle warm: 14.748초 → 1.500초
- Checkstyle restart index: 1.531초
- ipatool warm: 0.207초 → 0.022초
- OpenMAIC warm: 11.916초 → 8.065초
- OpenMAIC restart index: 9.454초

Checkstyle처럼 대부분이 file-only인 저장소에서는 원문 재읽기와 무의미한 재파싱을 크게 줄였다. 반면 OpenMAIC 같은 대형 TypeScript 저장소는 symbol-call 해석과 semantic graph 재구성 비용이 남아 있어 개선 폭이 제한적이다.

### 4. Summary-first가 전체 Workflow 화면의 기본 병목을 제거했다

Readable Backbone이 적용된 Meaning Overview는 10개 모두 시각 품질 검증을 통과했다. 255개의 개별 Workflow 드릴다운도 fail 없이 246 pass, 9 warning이었다. 즉 `Overview → Workflow 선택 → 단계/분기`라는 점진적 탐색 자체는 유효하다.

기존에는 Workflow가 하나라도 있는 7개 저장소의 전체 Workflow lens가 모두 fail이었다. summary-first 구현 후 기본 화면은 production Workflow 요약을 최대 12개만 Component 아래에 배치한다. 그 결과 10개 저장소에서 fail은 7개에서 0개로 줄었고, 5개는 pass, 5개는 density warning이 됐다. warning은 Component와 12개 summary를 합친 카드 수가 showcase 예산을 약간 넘는 경우이며 crossing·edge-through-node 오류는 없다.

Workflow lens의 렌더링 합계는 12.983초에서 0.281초로 97.8% 감소했다. 표시 노드는 1,059개에서 87개로 91.8%, 연결은 1,375개에서 80개로 94.2% 감소했다. OpenMAIC는 220 node/336 edge/4.635초에서 18 node/17 edge/0.115초, Crawl4AI는 220 node/248 edge/1.608초에서 14 node/13 edge/0.044초가 됐다.

## 명확하게 남은 문제

1. **확장된 Workflow catalog**: 기본 12개 summary는 안전하지만 `Show all`은 진단용 전체 목록이다. 100개 규모에서는 Component 내부 pagination이나 추가 clustering이 여전히 유용하다.
2. **대형 TypeScript 비용**: OpenMAIC는 여전히 cold 14초, warm 8초대이며 peak RSS도 약 1.9 GB였다. semantic reconstruction과 call resolution을 worker/incremental 단계로 더 나눠야 한다.
3. **언어 coverage**: vphone-cli의 주언어 Swift, ipatool의 Go, Checkstyle의 Java는 여전히 의미 분석 대상이 아니다. 현재 표시는 정직해졌지만 기능 공백은 그대로다.
4. **Workflow cap**: scientific-agent-skills는 419 후보 중 100개만 방출했다. 제한은 이제 UI에 보이지만, component별 탐색이나 on-demand expansion이 필요하다.
5. **LSP corroboration 표본**: 대형 Python 저장소는 48 caller 표본 제한에 도달한다. 제한은 표시되지만 전체 검증은 아니다.

## 판단

이번 개선은 분석기의 **신뢰성, 결과 정직성, 재분석 속도, Overview/드릴다운 가독성**을 실제 저장소에서 확인했다. 특히 Crawl4AI 복구와 warm/persistent index 효과는 명확하다.

summary-first 기본 경로는 구현과 실제 저장소 검증을 마쳤다. 다음 우선순위는 `Show all` 대규모 catalog의 pagination/clustering 또는 OpenMAIC 같은 대형 TypeScript 프로젝트의 semantic reconstruction 비용이다. 새 언어 추가 여부는 그 다음에 제품 대상 사용자 비중으로 결정할 수 있다.

## 재현

개별 저장소는 다음처럼 실행한다.

```powershell
npm run benchmark:repository -- `
  --rank 4 `
  --slug tt-a1i/archify `
  --root C:\absolute\path\to\checkout `
  --output C:\absolute\path\to\result.json `
  --index-root C:\absolute\path\to\indexes
```

현재 runner는 coverage, cold/warm/restart cache telemetry, semantic lens별 품질 receipt와 모든 개별 Workflow 품질 집계를 함께 기록한다.
