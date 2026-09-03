# Witch 확장 구조화 도구 교차 벤치마크

<!-- witch-doc-languages: ko,en -->

> **한국어:** Witch를 Archify 외 여러 구조화 도구와 분석 깊이, 시각화, 근거 추적, 대규모 그래프 관점에서 비교한 확장 조사 보고서입니다.
>
> **English:** This expanded benchmark compares Witch with Archify and other structure-analysis tools across depth, visualization, evidence traceability, and large-graph usability.

- 평가일: 2026-08-31 (Asia/Seoul)
- 대상: 기존 GitHub Trending 고정 corpus 10개, 동일 commit
- 목적: 기존 Witch ↔ Archify 시각 비교를 넘어 구조 추출 방식이 다른 도구를 같은 저장소에서 교차 검증
- 결론: **Witch는 의미 검토·근거·점진적 탐색에서 강하지만, 다언어 raw graph와 관계 종류는 GitNexus보다 명백히 얕다.** 다음 핵심 보완은 Java 하나를 바로 추가하는 것보다 `Universal Code Graph + budget receipt + graph query/impact` 기반을 먼저 만드는 것이다.

## 권위 결과 파일

초기 실행 후 필수 parser preflight를 보정했으므로 아래 세 결과를 함께 사용한다.

1. Witch, repo-cartographer, GitNexus:
   `C:\Users\cdi65\witch-benchmarks\expanded-structure-2026-08-31\summary.json`
2. TypeScript transpiler를 활성화한 dependency-cruiser 보정본:
   `C:\Users\cdi65\witch-benchmarks\expanded-structure-depcruise-corrected-2026-08-31\summary.json`
3. Acorn을 PATH에 연결한 code2flow 보정본:
   `C:\Users\cdi65\witch-benchmarks\expanded-structure-code2flow-corrected-2026-08-31\summary.json`

각 저장소 하위에는 raw JSON, Mermaid, HTML, stdout/stderr log가 남아 있다. 결과를 합계만으로 재해석하지 않고 원시 artifact까지 역추적할 수 있다.

## 무엇을 비교했나

| 계층             | 도구                                                                          | 이번 측정의 역할                                                         | 모델 필요          | 라이선스                   |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------ | -------------------------- |
| ADE 의미 탐색    | Witch 0.2.0                                                                   | System/Component/Workflow/Call, 근거·상태·질문, summary-first UI         | 선택               | Witch project              |
| 정적 지식 그래프 | [GitNexus 1.6.10](https://github.com/nxpatterns/gitnexus)                     | 다언어 symbol/relation/community/process graph, CLI query                | 아니요             | PolyForm Noncommercial 1.0 |
| 저장소 초안 지도 | [repo-cartographer 1.0.1](https://github.com/builditwithgk/repo-cartographer) | 언어·framework·entrypoint·module·import의 deterministic draft            | 정적 단계는 아니요 | MIT                        |
| 의존성·규칙      | [dependency-cruiser 18.2.0](https://github.com/sverweij/dependency-cruiser)   | JS/TS module dependency, cycle/orphan/unresolved, architecture rule 기반 | 아니요             | MIT                        |
| 함수 호출 근사   | [code2flow 2.5.1](https://github.com/scottrogowski/code2flow)                 | Python/JavaScript heuristic call graph                                   | 아니요             | MIT                        |

두 도구는 이번 정량 표에서 제외하고 다음 track으로 남겼다.

- [CodeBoarding](https://github.com/Codeboarding/CodeBoarding): 정적 분석 뒤 LLM이 추상 계층과 설명을 구성하므로 provider, model, token budget을 고정한 별도 **model-assisted track**이 필요하다.
- [Repo Visualizer](https://github.com/Jany-M/repo-visualizer): 전체 Git history의 import 변화와 churn을 시간축으로 보여주는 도구다. 고정 snapshot 구조 분석과 목표가 달라 full-history corpus가 필요하다.

## 공통 계약

### 고정 입력

|   # | 저장소                             | commit     |
| --: | ---------------------------------- | ---------- |
|   1 | THU-MAIC/OpenMAIC                  | `dfebbcf3` |
|   2 | K-Dense-AI/scientific-agent-skills | `f6fcafeb` |
|   3 | Lakr233/vphone-cli                 | `2af884b5` |
|   4 | tt-a1i/archify                     | `5de7275f` |
|   5 | p-e-w/heretic                      | `bedb94ef` |
|   6 | unclecode/crawl4ai                 | `7e801521` |
|   7 | mvanhorn/last30days-skill          | `a218edad` |
|   8 | majd/ipatool                       | `d5d0b56f` |
|   9 | punkpeye/awesome-mcp-servers       | `8dc03837` |
|  10 | checkstyle/checkstyle              | `48efe82e` |

### 안전 조건

- 대상 저장소 코드는 실행하지 않았다.
- 대상 저장소의 dependency 설치, import, build, test, task를 실행하지 않았다.
- 분석기는 source/text/manifest/git metadata만 읽었다.
- GitNexus가 `.gitnexus` index를 쓰므로 동일 commit의 별도 local clone에서 실행했다.
- GitNexus는 embeddings와 PDG를 꺼서 모델·벡터 비용을 섞지 않았다.
- 지원하지 않는 언어는 실패가 아니라 `N/A`다.
- 결과 수가 크다는 사실을 정확도 점수로 해석하지 않았다.

### 실행 환경 보정 기록

1. GitNexus 1.6.10은 Node `^22.18.0 || >=24.11.0`을 요구했다. 시스템 Node 22.14에서는 Windows `stat/fstat`의 device 값 차이 때문에 analyzer identity 검사가 fail-closed 됐다. 격리 Node 22.18.0으로 실행했다.
2. Checkstyle의 매우 긴 경로는 긴 benchmark clone 경로에서 Windows filename limit에 걸렸다. 앞선 9개 결과를 보존하고 더 짧은 격리 경로에서 10번만 재개했다.
3. code2flow의 JavaScript parser는 별도 Acorn CLI가 필요하다. 초기 설치 오류 5건을 폐기하고 Acorn PATH 보정본을 권위 결과로 삼았다.
4. dependency-cruiser는 TypeScript package가 같은 tool root에 없으면 `.ts/.tsx`를 조용히 비활성화한다. TypeScript 5.9.3을 활성화한 보정본을 사용했다.

이 네 사례 때문에 runner에는 결과 overwrite 방지, 저장소별 resume, GitNexus 짧은 sandbox root, Acorn/TypeScript 필수 파일 preflight를 추가했다.

## 전체 합계

서로 다른 추상 계층의 node/edge이므로 수를 직접 우열 점수로 비교하면 안 된다. 이 표는 각 도구가 실제로 생성한 정보량과 비용의 크기를 보여준다.

| 도구               | 적용·완료                            | 구조량                                                                  |                     cold 또는 전체 시간 |                          warm/restart | 주의점                                            |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------: | ------------------------------------: | ------------------------------------------------- |
| Witch              | 10/10                                | deep file 4,147; symbol 42,358; semantic relation 102,601; workflow 255 |                            **39.007초** | warm 16.070초; restart index 19.016초 | 전체 16,980 파일 중 deep 24.4%                    |
| repo-cartographer  | output 10/10; detail edge 존재 7/10  | high 90 node/12 edge; detail 4,132 node/3,787 edge                      |                             **9.022초** |                                미측정 | high는 지나치게 비고 detail은 file graph에 가까움 |
| dependency-cruiser | 적용 5/10, 성공 5/5                  | module 3,700; dependency 9,245                                          |                            **21.901초** |                                미측정 | JS/TS 전용; 외부·미해결 module도 node에 포함      |
| code2flow          | 적용 8/10; pass 6, partial 1, fail 1 | raw function node 9,066; raw edge 20,136                                |                            **59.331초** |                                미측정 | edge 24.5%가 동일 source-target 중복              |
| GitNexus           | index 10/10; warning 10/10           | file 15,967; node 241,741; edge 522,464; process 4,707                  | **690.474초 wall / 640.300초 analyzer** |                          **57.368초** | 2,713.3MB index; process truncation 9/10          |

### 수치 해석

- GitNexus의 wall time은 Witch cold의 약 **17.7배**지만, Witch가 깊게 보지 못하는 Java, Go, Swift까지 분석했고 raw relation은 약 **5.1배** 생성했다.
- GitNexus의 15,967 `File` node는 corpus 파일의 약 94%지만 Witch와 ignore·file classification이 달라 엄밀한 coverage 비교값은 아니다.
- GitNexus node에는 Markdown `Section` 46,459개와 `Property` 57,873개가 포함된다. 241,741 node 전체를 코드 symbol 수로 읽으면 안 된다.
- Witch는 42,358 `defines`, 20,939 `imports`, 19,274 `calls`, 781 `executes`, 505 `precedes`, 100 `branches-to`를 만들었다.
- GitNexus는 129,880 `CALLS`, 40,195 `IMPORTS`, 42,957 `ACCESSES`, 9,537 `METHOD_OVERRIDES`, 2,240 `EXTENDS`, 802 `IMPLEMENTS`, 22,090 `STEP_IN_PROCESS`를 만들었다.

## 저장소별 핵심 비교: Witch와 GitNexus

`Witch`는 `deep file / workflow`, `GitNexus`는 `file / node / process`다. 시간은 GitNexus가 자체 보고한 cold analyzer 시간이며 index는 `.gitnexus` 크기다.

| 저장소                  | Witch deep/workflow | GitNexus file/node/process | GitNexus cold |   Index |
| ----------------------- | ------------------: | -------------------------: | ------------: | ------: |
| OpenMAIC                |          2,404 / 42 |     2,639 / 56,431 / 1,027 |       167.1초 | 610.8MB |
| scientific-agent-skills |           682 / 100 |       2,157 / 54,364 / 532 |        69.4초 | 428.4MB |
| vphone-cli              |             31 / 11 |          323 / 7,851 / 465 |        31.0초 | 112.0MB |
| archify                 |            163 / 14 |         341 / 12,449 / 602 |        51.3초 | 201.4MB |
| heretic                 |              17 / 2 |              44 / 398 / 32 |        15.2초 |  28.9MB |
| crawl4ai                |            520 / 61 |         805 / 15,228 / 567 |        54.1초 | 237.6MB |
| last30days-skill        |            319 / 25 |         372 / 11,658 / 729 |        44.7초 | 184.1MB |
| ipatool                 |           **0 / 0** |      **136 / 1,422 / 117** |        20.1초 |  59.7MB |
| awesome-mcp-servers     |               0 / 0 |                7 / 314 / 0 |        10.7초 |  35.5MB |
| checkstyle              |          **11 / 0** |   **9,143 / 81,626 / 636** |       176.7초 | 815.0MB |

### 가장 중요한 두 대조

1. **ipatool (Go)**: Witch는 file-only라 의미 graph가 0이지만 GitNexus는 1,422 node와 117 process를 만들었다.
2. **Checkstyle (Java)**: Witch deep 11개는 주변 JS 계열뿐이며 Java 의미 구조는 사실상 없다. GitNexus는 9,143 file, 81,626 node, 174,319 edge, 636 process를 만들었다.

따라서 Witch의 현재 가장 큰 분석 공백은 “Java lens가 없다”보다 더 근본적인 **다언어 공통 graph substrate가 없다**는 점이다.

## 저장소별 specialized graph

표의 값은 `node/edge`다. dependency-cruiser의 node는 module, code2flow의 node는 function/method다.

| 저장소                  | repo-cart high | repo-cart detail | dependency-cruiser |            code2flow |
| ----------------------- | -------------: | ---------------: | -----------------: | -------------------: |
| OpenMAIC                |           67/6 |      2,402/2,496 |        3,433/8,282 |       270/1,578 pass |
| scientific-agent-skills |            3/0 |           682/61 |                N/A |                 fail |
| vphone-cli              |            3/0 |            31/47 |                N/A |         151/295 pass |
| archify                 |            6/2 |          163/147 |            188/942 |             5/8 pass |
| heretic                 |            2/0 |            17/27 |                N/A |         100/183 pass |
| crawl4ai                |            6/3 |          521/757 |               49/0 | 4,193/10,155 partial |
| last30days-skill        |            2/1 |          306/252 |              19/21 |     4,271/7,800 pass |
| ipatool                 |            0/0 |              0/0 |                N/A |                  N/A |
| awesome-mcp-servers     |            0/0 |              0/0 |                N/A |                  N/A |
| checkstyle              |            1/0 |             10/0 |               11/0 |          76/117 pass |

### repo-cartographer에서 배울 점과 한계

공식 설계처럼 이 도구는 “hard facts를 추출하고 모델이 reasoning을 한다”는 경계를 명확히 둔다. 10개 모두 약 9초에 HTML/Mermaid를 만들었고 결과가 작아 공유하기 쉽다.

그러나 실제 corpus에서는 high view가 합계 90 node/12 edge뿐이다. ipatool은 Go를 감지하면서도 출력 graph는 0 node/0 edge였고, Checkstyle도 Java를 감지했지만 실제 detail은 주변 script 10개/0 edge였다. 반대로 detail view는 OpenMAIC에서 2,402 node가 되어 바로 읽기 어렵다.

이는 Witch의 `System → Component → Workflow summary → focused sequence → Call` 중간 계층이 필요한 이유를 지지한다. high/detail 두 단계만으로는 너무 비거나 너무 조밀해진다.

### dependency-cruiser에서 배울 점과 한계

JS/TS 범위에서는 가장 빠르고 역할이 명확하다. OpenMAIC에서 27 circular edge, 163 orphan module, 5,938 unresolved dependency를 구조화해 냈다. graph를 보여주는 데 그치지 않고 forbidden dependency, production→test 금지, cycle, orphan 등을 **사용자 규칙과 CI violation**으로 바꾸는 점이 Witch에 부족하다.

다만 이 결과는 Python/Rust/Go/Java에 적용할 수 없다. Witch에 그대로 핵심 분석기로 넣기보다 언어 중립 policy engine의 reference로 삼는 편이 맞다.

### code2flow에서 배울 점과 한계

Python 대형 저장소에서 함수 수준 graph를 빠르게 대량 생성했다. Crawl4AI Python graph는 4,193 node/10,155 edge, last30days-skill은 4,239 node/7,755 edge였다.

반면 다음 문제가 실제로 재현됐다.

- scientific-agent-skills: Python AST assertion으로 전체 run 실패. `--skip-parse-errors`도 복구하지 못했다.
- Crawl4AI JavaScript: `NoneType` AST walker 오류. Python 결과만 남아 partial이다.
- raw edge 20,136개 중 동일 source-target를 dedupe하면 15,204개다. **4,932개, 24.5%가 중복**이며 OpenMAIC는 중복률 66.0%다.
- 프로젝트 밖 import와 동명이인 함수 연결이 부정확할 수 있다는 한계를 도구 자체도 명시한다.

Witch가 여기서 가져올 것은 “많은 호출 edge”가 아니라 **언어별 heuristic을 격리하고, stable edge identity로 dedupe하며, parser failure를 파일 단위 coverage receipt로 내리는 방식**이다.

### GitNexus에서 배울 점과 한계

이번에 가장 직접적인 분석 엔진 reference다.

강점:

1. File/Folder/Function/Method/Class/Interface/Struct/Record/Route/Community/Process를 하나의 persistent graph로 통합한다.
2. `CALLS`, `IMPORTS`, `ACCESSES`, inheritance, implementation, override, route, fetch까지 relation 종류가 넓다.
3. `query`, `context`, `impact`, `trace`, raw Cypher를 CLI/MCP에 노출한다.
4. Go, Java, Swift 같은 Witch 미지원 언어에서도 실제 graph를 만들었다.
5. process 누락을 숨기지 않고 candidate dropped, depth cap, branching cap, trace budget을 세부 경고로 남긴다.

한계:

1. 10개 cold wall 690초, index 2.7GB로 무겁다.
2. warm no-change도 저장소당 약 5.5~6.0초가 들었다.
3. 9/10 저장소에서 process graph가 일부 누락됐다고 명시했다.
4. unresolved receiver member 관측 합계가 59,225개였다. 동적 dispatch와 receiver resolution의 불확실성이 크다.
5. 기본 설정의 raw graph를 그대로 화면에 올리면 Witch가 summary-first로 해결한 밀도 문제가 다시 생긴다.
6. PolyForm Noncommercial 라이선스이므로 상용 가능성이 있는 Witch에 source를 이식하거나 파생 구현을 만들면 안 된다. **개념·평가 기준 reference로만 사용**한다.

## Witch의 현재 상대적 위치

| 기준                                 | 현재 판단                | 가장 강한 비교 대상                                 |
| ------------------------------------ | ------------------------ | --------------------------------------------------- |
| 다언어 raw 구조 추출                 | 부족                     | GitNexus 크게 우세                                  |
| 함수 호출 대량 추출                  | 중간                     | GitNexus 우세, code2flow는 양은 많지만 오류·중복 큼 |
| workflow 의미 추론                   | 차별점 있음              | GitNexus process가 더 많지만 누락·밀도 관리가 필요  |
| 근거·verified/inferred/authored·질문 | Witch 우세               | 외부 도구는 graph fact 또는 heuristic 중심          |
| 기본 화면 가독성                     | Witch summary-first 우세 | repo-cart high는 너무 희소, detail은 너무 세밀      |
| graph query·impact·trace             | 부족                     | GitNexus 크게 우세                                  |
| architecture rule·CI violation       | 부족                     | dependency-cruiser 크게 우세                        |
| 증분·persistent 비용                 | Witch 가벼움             | GitNexus가 더 풍부하지만 훨씬 무거움                |
| ADE 안의 편집·터미널·Agent 검토 연결 | Witch의 제품 차별점      | 비교 CLI들은 보조 도구 성격                         |

## 구현 우선순위 제안

### P0. Universal Code Graph v1

Java adapter 하나를 바로 붙이기 전에 공통 schema를 먼저 고정한다.

- node: `File`, `Folder`, `Module`, `Symbol`, `Callable`, `Type`, `Route`, `Component`, `Workflow`
- relation: `Defines`, `Contains`, `Imports`, `Calls`, `Accesses`, `Extends`, `Implements`, `Overrides`, `Exports`, `Handles`, `Fetches`
- 모든 relation: source path, line/range, extractor, confidence/trust, authored/inferred/verified 상태
- language adapter: 기존 Python/TS/Rust를 이 schema에 맞추고 그 다음 Go/Java/Swift를 독립 추가

이렇게 해야 언어를 추가할 때 UI와 semantic composer를 매번 다시 만들지 않는다.

### P0. 분석 예산 receipt 확대

현재 Witch의 `100 workflow cap`, `48 caller corroboration sample`을 GitNexus 수준으로 더 설명 가능하게 만든다.

- entrypoint candidate 총수/선정수/탈락수
- 최대 trace depth에 걸린 수
- branching cap으로 생략한 callee 수
- unresolved receiver/import 수
- parser failure·oversized·vendored·generated 파일 수
- 화면 요약에서 생략한 node/edge와 expansion 경로

자동 승인을 유지하더라도 이 receipt가 변경 이력과 review에 남아야 한다.

### P1. Query / Impact / Trace API

시각 graph가 Agent에게 실제 도구가 되려면 다음 질의가 필요하다.

- symbol 또는 component의 upstream/downstream
- 변경 파일의 blast radius
- entrypoint → target call/process trace
- component 간 dependency path
- inferred claim의 반증 evidence 검색

결과는 UI selection과 연결하고 Codex/Claude adapter가 같은 API를 MCP 또는 local IPC로 사용하게 한다.

### P1. Process graph와 화면 계층 결합

GitNexus처럼 process 후보를 넓게 추출하되 그대로 그리지 않는다.

1. System
2. Component
3. Workflow catalog summary
4. 선택 Workflow의 Process sequence
5. 선택 step의 Call/Access graph

각 단계에서 production/support/test를 분리하고, branch/retry/async boundary를 접거나 펼친다.

### P1. Stable edge identity와 dedupe

`source symbol + relation kind + target symbol + evidence range + extractor`를 canonical identity로 사용한다. code2flow에서 재현한 24.5% 중복 같은 문제를 graph build 단계에서 막고, 여러 extractor가 같은 edge를 찾으면 중복 생성 대신 corroboration으로 승격한다.

### P2. Architecture Policy Engine

dependency-cruiser의 장점을 언어 중립적으로 수입한다.

- forbidden layer dependency
- cycle
- orphan/unreachable component
- production → test/support dependency
- sensitive boundary/auth boundary 우회
- baseline과 새 violation 분리

규칙은 authored이고 분석 결과는 verified/inferred로 남겨 대조한다. 자동 승인 시에도 violation delta는 audit trail에 고정한다.

### P3. History lens

Repo Visualizer처럼 commit history에서 component 등장·삭제·churn·dependency drift를 보여주는 것은 유용하다. 다만 현재 구조 정확도와 query layer가 먼저이며, full-history benchmark를 별도로 만든 뒤 진행한다.

## 최종 판단

확장 benchmark는 “Witch가 분석은 충분한데 표현만 약하다”는 진단을 수정한다.

- **표현 문제는 summary-first로 상당히 개선됐다.** repo-cartographer와 비교하면 Witch의 중간 추상 계층은 오히려 강점이다.
- **분석 폭 자체도 아직 부족하다.** 특히 GitNexus가 Go/Java/Swift와 override/access/process까지 만든 결과는 Witch의 raw graph substrate 공백을 명확히 보여준다.
- **더 많은 edge만 만들면 해결되는 것도 아니다.** code2flow의 중복·parser failure와 GitNexus의 process truncation은 coverage receipt, dedupe, uncertainty가 핵심임을 보여준다.
- 따라서 다음 단계는 `Universal Code Graph → budget receipt → query/impact/trace → Process UI → policy engine` 순서가 가장 타당하다.

이번에는 비교 runner와 보고서만 추가했고 Witch 분석 엔진 자체는 이 결과로 변경하지 않았다.

## 재현

도구 설치 root에는 다음 버전을 함께 둔다.

- GitNexus 1.6.10
- repo-cartographer 1.0.1
- dependency-cruiser 18.2.0
- TypeScript 5.9.3
- code2flow 2.5.1
- Acorn 8.18.0
- GitNexus용 Node 22.18.0

전체 runner:

```powershell
npx tsx scripts/benchmark-structure-tools.ts `
  --corpus-root C:\absolute\github-trending-2026-08-31 `
  --witch-results C:\absolute\results-summary-first `
  --tool-root C:\absolute\expanded-tools-2026-08-31 `
  --output-root C:\absolute\expanded-structure-run `
  --gitnexus-sandbox-root C:\short\witch-gn-run
```

runner는 기존 `summary.json`을 덮어쓰지 않고, 저장소별 `result.json`이 있으면 resume한다.
