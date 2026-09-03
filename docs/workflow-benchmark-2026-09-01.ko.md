# Witch end-to-end analysis Workflow benchmark

[한국어](workflow-benchmark-2026-09-01.ko.md) · [English](workflow-benchmark-2026-09-01.md)

- 실행일: 2026-09-01 (Asia/Seoul)
- 대상: 2026-08-31 GitHub Trending 고정 checkout 10개
- 원시 결과: `C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31\results-workflow-2026-09-01`
- 영속 인덱스: `C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31\indexes-workflow-2026-09-01`
- 비교 기준: `results-analysis-depth-v1-final`

저장소 코드는 import, build, test 또는 task로 실행하지 않았다. Witch의 정적 분석기와 제한된 Pyright/rust-analyzer 관측만 사용했다. 실제 Codex/Claude 모델 호출과 Change 적용은 이 실행의 범위가 아니다.

## 수행한 Workflow

1. Workspace listing 및 ignore/크기 제한 적용
2. Python, Rust, TypeScript/JavaScript source 분석
3. Source graph와 symbol/call/type/data 관계 구성
4. 규칙 기반 Semantic Composer 수행
5. Evidence 및 Architecture/Semantic IR 검증
6. Summary-first Overview와 Workflow catalog 투영
7. 발견된 모든 Workflow를 focused sequence로 투영
8. branch collapse와 시각 품질 receipt 검증
9. cold, warm, process-restart 인덱스 시간 비교

## 전체 결과

| 단계                     |                          결과 | 판단                            |
| ------------------------ | ----------------------------: | ------------------------------- |
| 저장소 스캔              |                    10/10 완료 | PASS                            |
| Architecture/Semantic IR |                   10/10 valid | PASS                            |
| 전체 파일                |                        16,980 | 고정 corpus 일치                |
| 인덱싱                   |                        14,128 | 분석 제한 적용                  |
| Deep 분석                |                         4,147 | Python/Rust/TS·JS 범위          |
| File-only                |                         9,981 | Java/Go/Swift 등 의미 분석 제외 |
| Symbol                   |                        42,358 | source evidence 유지            |
| Semantic node/relation   |              48,729 / 107,479 | 이전 기준과 동일                |
| Workflow                 |                           255 | production 209, support 46      |
| Workflow catalog         |   5 pass / 5 warning / 0 fail | Summary-first 유지              |
| Focused Workflow         | 246 pass / 9 warning / 0 fail | 255개 전부 투영                 |
| Open question            |                             0 | Authored/AI Composer 입력 없음  |

## 저장소별 결과

Focused는 `pass / warning / fail` 순서다. 시간은 초 단위다.

|   # | 저장소                             |   Deep/전체 | Symbol | Workflow | Prod/Support |   Cold |  Warm | Restart | Catalog | Focused |
| --: | ---------------------------------- | ----------: | -----: | -------: | -----------: | -----: | ----: | ------: | ------- | ------: |
|   1 | THU-MAIC/OpenMAIC                  | 2,404/2,822 | 16,037 |       42 |        30/12 | 15.877 | 7.905 |  10.315 | warning |  38/4/0 |
|   2 | K-Dense-AI/scientific-agent-skills |   682/2,446 |  9,816 |      100 |        100/0 |  5.550 | 2.287 |   3.000 | warning | 100/0/0 |
|   3 | Lakr233/vphone-cli                 |      31/336 |    147 |       11 |         11/0 |  0.550 | 0.113 |   0.148 | warning |  10/1/0 |
|   4 | tt-a1i/archify                     |     163/483 |  2,142 |       14 |         4/10 |  2.602 | 0.986 |   1.110 | pass    |  14/0/0 |
|   5 | p-e-w/heretic                      |       17/51 |    159 |        2 |          2/0 |  0.121 | 0.077 |   0.077 | pass    |   1/1/0 |
|   6 | unclecode/crawl4ai                 |     520/900 |  6,576 |       61 |        49/12 |  3.868 | 1.496 |   1.937 | warning |  60/1/0 |
|   7 | mvanhorn/last30days-skill          |     319/455 |  7,406 |       25 |        13/12 |  2.121 | 1.119 |   1.380 | warning |  23/2/0 |
|   8 | majd/ipatool                       |       0/154 |      0 |        0 |          0/0 |  0.235 | 0.024 |   0.024 | pass    |   0/0/0 |
|   9 | punkpeye/awesome-mcp-servers       |        0/11 |      0 |        0 |          0/0 |  0.041 | 0.006 |   0.006 | pass    |   0/0/0 |
|  10 | checkstyle/checkstyle              |    11/9,322 |     75 |        0 |          0/0 | 14.288 | 1.260 |   1.256 | pass    |   0/0/0 |

## 이전 실행과 비교

모든 저장소의 commit은 이전 기준과 동일하다. Semantic relation 107,479개와 Workflow 255개도 동일해 구조 결과 회귀가 없다.

| 구간              |     이전 |     현재 |   변화 |
| ----------------- | -------: | -------: | -----: |
| Cold 분석         | 46.903초 | 45.253초 |  -3.5% |
| Warm 분석         | 19.706초 | 15.273초 | -22.5% |
| Restart index     | 23.905초 | 19.253초 | -19.5% |
| LSP corroboration | 36.822초 | 30.042초 | -18.4% |

한 번의 측정이므로 이 시간 차이를 확정적인 성능 향상으로 해석하지 않는다. 의미 결과가 동일한 상태에서 명백한 성능 회귀가 관측되지 않았다는 회귀 확인으로 사용한다.

## 발견된 경계

- `scientific-agent-skills`는 419개 후보 중 정책 상한인 100개 Workflow를 표시한다.
- OpenMAIC와 Crawl4AI는 support/test/docs Workflow를 production-first 정책에 따라 제한한다.
- OpenMAIC, scientific-agent-skills, vphone-cli, Crawl4AI, last30days-skill은 catalog density 또는 coverage warning이 있지만 fail은 없다.
- 255개 focused Workflow 중 가장 큰 화면은 18 node / 17 edge다. Summary-first에서 상세 화면으로 내려가는 구조가 현재 corpus에서는 안정적이다.
- ipatool의 Go, Checkstyle의 Java, vphone-cli의 Swift 본체는 file-only다. Workflow가 0이라는 결과는 해당 프로젝트에 Workflow가 없다는 뜻이 아니라 현재 언어 범위 밖이라는 뜻이다.
- 이번 corpus에는 Authored 규칙이나 AI Semantic Composer 결과가 없으므로 GrillMe 충돌 질문은 생성되지 않았다.

## 다음 벤치마크 단계

분석 Workflow는 10/10으로 검증됐다. 제품 전체 순환을 검증하려면 다음 단계는 별도 비용·안전 구간으로 나눈다.

1. Workflow가 있는 7개 저장소에서 대표 production Workflow 하나를 선택한다.
2. 동일한 evidence dossier를 Codex와 Claude Code의 Ask 모드에 전달한다.
3. 근거 인용률, Verified/Inferred 구분, 환각, 응답 시간과 사용량을 비교한다.
4. Change 모드는 전용 작은 fixture에서만 실행하고 격리, diff, 선택 적용, 증분 재분석을 검증한다.

대형 외부 저장소에 임의 변경 과제를 부여하는 것은 품질 ground truth가 없으므로 Agent Change 벤치마크로 사용하지 않는다.
