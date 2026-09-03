# Witch 0.2.0 — 검증 기록

<!-- witch-doc-languages: ko,en -->

> **한국어:** 실제 실행한 로컬 테스트·E2E·패키지 검증과 아직 검증하지 못한 플랫폼·배포 범위를 구분해 기록합니다.
>
> **English:** This verification log distinguishes checks actually run from platform, packaging, and distribution claims that have not yet been verified.

최근 검증일: 2026-08-31. 로컬 실행 환경: Windows 11 x64, Node.js 22.14.0, npm 10.9.2, Electron 44.0.0.

이 문서는 실제로 실행한 검증과 아직 실행하지 못한 검증을 구분합니다. VS Code 기능 전체 또는 모든 저장소에 대한 호환성을 보증하지 않습니다.

## Call hierarchy corroboration · focused Workflow UI · LSP file watching

`feature/python-rust-language-intelligence`의 현재 작업 트리에서 Pyright/optional rust-analyzer call hierarchy 교차 검증, relation-backed OpenQuestion, 한 Workflow 집중, Graph/Sequence 전환, branch-only collapse와 LSP 파일 감시 알림을 기존 ADE 기능과 함께 검증한 결과입니다.

| 검증                                                                 | 결과       | 범위                                                                                                                                                         |
| -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                                  | 통과       | call hierarchy/LSP watcher/semantic main·renderer 계약                                                                                                       |
| `npm test`                                                           | 83개 통과  | 실제 Pyright와 rust-analyzer call hierarchy, Rust 진단·정의·참조·Outline, 가짜 provider의 match/conflict, fail-open fallback, relation 질문과 전체 단위 회귀 |
| `npm run build`                                                      | 통과       | main 36개, preload 2개, renderer 3,273개 module의 production bundle                                                                                          |
| `npm run test:e2e`                                                   | 23개 통과  | 실제 Electron에서 workflow focus/sequence/collapse, 분석 이후 생성된 Python 파일 navigation과 기존 ADE 전체 흐름                                             |
| `npm run benchmark -- 5000`                                          | 통과       | 5,000 TS 파일/4,999 import, cold 8,868 ms, cached 7,817 ms, one-file change 7,673 ms, layout 87 ms, peak RSS 298 MB                                          |
| `npm run smoke:python-debug -- <temporary-venv-python> <fixture.py>` | 통과       | 임시 venv의 debugpy 1.8.21로 production DAP 경로의 breakpoint, frame, `price`/`symbol` 변수 확인                                                             |
| `rust-analyzer --version`                                            | 1.98.0     | Rustup stable 1.98.0 컴포넌트의 실제 시스템 서버                                                                                                             |
| `npm audit --json`                                                   | 취약점 0건 | 현재 lockfile의 505개 production/dev/optional/peer dependency                                                                                                |

Python smoke용 임시 venv는 검증 뒤 제거했습니다. Python 환경 탐색은 후보를 실행하지 않으며 debugpy를 자동 설치하지 않습니다. Python/Rust call/workflow 분석과 corroboration은 프로젝트를 import·compile·execute하지 않고 bounded source/LSP만 사용합니다. 실제 번들 Pyright와 시스템 rust-analyzer의 `prepareCallHierarchy`/`outgoingCalls`, 새 파일 `didChangeWatchedFiles` 경로를 검증했습니다. Rust 실서버 테스트는 임시 Cargo library를 열어 연결 상태, 파서 진단, 정의·참조, Outline, hover와 `run_agent → calculate` 호출 계층을 확인했습니다. rust-analyzer에는 build script, proc macro, check-on-save와 automatic Cargo reload를 비활성화한 Witch 기본 설정을 사용했습니다. Rust 디버그 adapter는 여전히 없으므로 Rust 디버깅을 주장하지 않습니다. Electron 검증은 `test-results/witch-workflow-sequence-focus.png`를 생성했습니다. 이번 검증은 Windows source build이며, 현재 변경을 포함하는 Windows/macOS package와 GitHub Actions 결과는 아직 만들지 않았습니다.

## Workspace Intelligence v0 — 기능 브랜치

`feature/python-rust-language-intelligence`에서 공통 LSP 라우터, 번들 Pyright, 선택적 시스템 rust-analyzer, provider별 상태, Python/Rust 편집기 기능과 Outline을 추가한 뒤 Windows 11 x64에서 실행한 결과입니다.

| 검증                | 결과      | 범위                                                                                         |
| ------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `npm run typecheck` | 통과      | main/preload/renderer의 공통 언어 provider와 document-symbol 계약                            |
| `npm test`          | 72개 통과 | 실제 Pyright 진단·정의·참조·Outline·rename preview, Rust 도구 탐색·명령 차단, 기존 전체 회귀 |
| `npm run build`     | 통과      | main 31개, preload 2개, renderer 3,273개 module의 production bundle                          |
| `npm run test:e2e`  | 23개 통과 | 실제 Electron에서 Pyright 연결, Python 오류 표시, 정의 이동, Outline과 기존 ADE 전체 흐름    |

Pyright 검증은 번들된 실제 서버 프로세스를 사용했고 원본 파일이 rename preview 중 변경되지 않는 것을 확인했습니다. 이 표의 72개 테스트를 수행한 초기 시점에는 rust-analyzer가 없었습니다. 2026-08-31에 Rustup stable과 rust-analyzer 1.98.0을 설치해 위의 최신 83개 테스트에서 실제 Rust 서버 연결과 의미 기능을 추가 검증했습니다. 절대 경로만 허용하는 검색 규칙과 임의 명령 차단도 독립 회귀 테스트로 계속 검증합니다. macOS와 packaged application에서 Pyright 및 시스템 rust-analyzer 연결은 기능 브랜치가 원격 CI에 올라간 뒤 별도로 확인해야 합니다.

## Remote Workspace 단계 A — 기능 브랜치

`feature/remote-workspace-mvp`에서 시스템 OpenSSH 프로필과 대화형 SSH PTY를 추가한 뒤 Windows 11 x64에서 실행한 결과입니다.

| 검증                | 결과      | 범위                                                                                |
| ------------------- | --------- | ----------------------------------------------------------------------------------- |
| `npm run typecheck` | 통과      | main/preload/renderer의 typed IPC와 remote profile 계약                             |
| `npm test`          | 69개 통과 | 옵션 주입·secret field 거부, argv, 고정 실행 파일, 원자 저장, 손상 파일 보존 포함   |
| `npm run build`     | 통과      | main 30개, preload 2개, renderer 3,273개 module의 production bundle                 |
| `npm run test:e2e`  | 22개 통과 | 실제 Electron에서 프로필 저장·재시작 복원·terminal 선택·loopback SSH 실패/종료 표시 |

E2E의 SSH 연결 대상은 `127.0.0.1:1`로 제한해 외부 호스트나 인증 정보를 사용하지 않았습니다. 프로필 파일에 password, passphrase 또는 private-key 내용이 남지 않는 것도 디스크에서 확인합니다. 이 결과는 Windows source build 검증이며 macOS와 packaged application 결과는 pull request의 품질 게이트 전까지 미검증입니다. 원격 파일 탐색기·편집기·LSP·Task·Debugger·Agent는 단계 A의 수용 범위가 아닙니다.

## QA 차단 항목 보완 — 현재 로컬 작업 트리

독립 QA가 commit `7bae0e3`에서 확인한 macOS graph-to-chat drag 회귀, 기본 build 메모리 재현성, 자동 CI 부재를 다음처럼 보완했습니다.

- 채팅의 장식 이미지는 `draggable={false}`이며 container와 image 모두 `pointer-events: none`, `user-select: none`이다.
- `agent-workflow` E2E는 장식 이미지의 실제 draggable/pointer 상태를 확인한 뒤 기본 chat 중앙으로 실제 마우스 drag/drop을 수행한다.
- `npm run build`는 `scripts/build-desktop.cjs`를 통해 현재 Node 실행 파일과 `--max-old-space-size=4096`을 직접 사용한다. shell별 환경변수 문법에 의존하지 않는다.
- standalone package 명령은 build를 포함하고, 수동 package workflow는 이미 만든 최신 bundle을 재사용해 중복 build를 피한다.
- `.github/workflows/quality.yml`은 pull request와 `main` push마다 Node 22의 Windows/macOS matrix에서 typecheck, unit tests, build, 전체 개발 E2E를 실행하고 실패 trace를 보관한다.
- 기존 수동 Windows/macOS package workflow도 Node 22와 동일 build entry point를 사용한다.

2026-08-30 Windows 11 x64, Node 22.14.0에서 새 production bundle을 만든 뒤 실행한 결과:

| 검증                      | 결과      | 근거                                                                      |
| ------------------------- | --------- | ------------------------------------------------------------------------- |
| `npm run typecheck`       | 통과      | 현재 TypeScript와 새 workflow/build 계약 test                             |
| `npm test`                | 63개 통과 | semantic IR 4개, build wrapper, CI trigger 회귀 포함                      |
| `npm run build`           | 통과      | ambient `NODE_OPTIONS` 없이 새 Node wrapper 사용, renderer 3,272 modules  |
| targeted `agent-workflow` | 통과      | 장식 이미지 위 hit 영역이 inert이고 context chip·격리 변경·승인 적용 정상 |
| `npm run test:e2e`        | 21개 통과 | 실제 Electron 개발 bundle 전체 흐름, 약 1.3분                             |

이 결과는 Windows 로컬 source build 검증이다. 새 workflow는 GitHub에 push된 뒤에만 macOS runner 결과를 만들 수 있고, branch protection에서 해당 check를 필수로 지정하는 작업은 저장소 설정에서 별도로 해야 한다. 현재 변경으로 Windows installer나 macOS universal package를 다시 생성·검증하지 않았으며, macOS source/package/packaged-app E2E가 통과하기 전에는 새 cross-platform Release를 GO로 판정하지 않는다.

## 공개 프리뷰 산출물

- GitHub Release: [Witch v0.2.0](https://github.com/apple4ree/vs-harness/releases/tag/v0.2.0), 기준 commit `2709677`
- Windows x64 EXE: 138,806,211 bytes, SHA-256 `5F00F2C938B930F80C4B766847EBB9CBD9D40BC96E73F5C8FD2AA97431CEEDF5`
- macOS universal DMG: 261,899,404 bytes, SHA-256 `1676AF070A10D6A437FF641061BAC188325ED5F2A04ADFC751AA35880989476B`
- macOS universal ZIP: 261,587,503 bytes, SHA-256 `B495D6B28F677EA0F682070414D64D803586758AAD36F3BC68C21F04AB66AF6D`
- Authenticode 상태: `NotSigned`. 개인 테스트용 미서명 프리뷰입니다. 정식 서명·자동 업데이트는 구성하지 않았습니다.

Windows와 macOS GitHub Actions job은 source E2E, 패키징, 패키지 내용 검증, packaged-app E2E를 모두 통과했습니다. 설치 프로그램 자체를 사용자의 시스템에 설치·제거하는 테스트는 하지 않았습니다. 소스를 바꾸면 이미 만든 v0.2.0 설치 파일에는 반영되지 않으므로 다시 패키징해야 합니다.

## 현재 main — v0.2.0 이후

Archify 원칙을 Witch core로 옮긴 commit `1d05558` 이후 구조 시점 비교와 오프라인 내보내기는 아직 새 Release에 포함되지 않은 작업입니다. 현재 로컬 검증 결과는 다음과 같습니다.

| 검증                                                                                   | 결과      | 범위                                                                                                  |
| -------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                    | 통과      | 현재 TypeScript 소스                                                                                  |
| `npm test`                                                                             | 63개 통과 | source/semantic IR, build/CI gate, source-neighborhood, route/reach, delta, script-safe export 회귀   |
| `npm run build`                                                                        | 통과      | 4 GB Node wrapper를 통한 main/preload/renderer 프로덕션 번들                                          |
| `npm run test:e2e`                                                                     | 21개 통과 | 실제 Electron에서 drag regression, Meaning, Source→Focus, 구조 비교·HTML/JSON 저장과 IDE 핵심 UI 흐름 |
| [GitHub Actions #17](https://github.com/apple4ree/vs-harness/actions/runs/33259915987) | 양쪽 통과 | commit `12dd22d`, Windows x64와 macOS universal의 source/package/packaged-app 전체 체인               |

구조 비교는 저장된 reading을 다시 검증한 뒤 현재 reading과 비교합니다. HTML과 JSON 내보내기는 검증된 graph만 허용하며, HTML은 외부 리소스 없이 동작하고 authored text를 HTML로 주입하지 않습니다. 활성 소스의 Focus 투영은 canonical graph를 다시 검증한 뒤 직접 연결된 authored import와 evidence line만 표시하며, Electron E2E에서 Source→Constellation→evidence panel 흐름과 화면을 확인했습니다.

Actions #16의 첫 Windows 시도는 기존 interactive terminal 출력의 10초 대기에서 한 번 시간 초과가 났습니다. 같은 commit의 실패 job만 재실행한 attempt 2에서는 source E2E 21개, NSIS 패키징, 패키지 검증, packaged-app E2E와 artifact 업로드가 모두 통과했습니다. macOS는 source E2E, universal DMG/ZIP, Mach-O/ASAR 검증, packaged-app E2E를 첫 시도에 모두 통과했습니다. Actions artifact ZIP digest는 Windows `6c094154801bc7d86324083a524a64f3d21278ba7efaef60999fd670e50b8c6c`, macOS `5fb116e6a075ae2a6c4b1a7d6bc110b681e494f59a930792391b2c1133615671`입니다. 이 artifact는 v0.2.0 Release asset을 교체하지 않습니다.

Actions #17은 Focus 투영 commit `12dd22d`를 검증했습니다. Windows는 첫 시도에 전체 체인을 통과했습니다. macOS 첫 시도는 기존 auto-import completion E2E가 suggestion의 `Loading…` 중에 선택되는 타이밍 경합으로 실패했고, 같은 commit의 실패 job만 재실행한 attempt 2에서는 source E2E 21개, universal 패키징, Mach-O/ASAR 검증, packaged-app E2E와 artifact 업로드가 모두 통과했습니다. 최종 artifact ZIP digest는 Windows `5635c75fc0d5ec55445c3795a1b183906044599c875b4946d31889e7aaa9d31e`, macOS `9bb3c352d1e7936debfc35bb04714854fc7e0dc420e0e15f5f2ad143b593224e`입니다. 이 artifact도 새 Release를 생성하거나 v0.2.0 asset을 교체하지 않습니다.

## v0.2.0에서 실행한 검증

| 검증                                             | 결과                    | 범위                                                                                |
| ------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------- |
| `npm run typecheck`                              | 통과                    | 현재 TypeScript 소스                                                                |
| `npm test`                                       | 당시 전체 통과          | 파일 안전성, 분석, 검색, 언어 서버, 디버그, 기록, 검토, 키 저장, 플랫폼 바이너리 등 |
| `npm run test:e2e`                               | 21개 통과               | 개발 실행에서 실제 Electron UI·IPC·서비스                                           |
| Windows 패키지 E2E                               | 20개 통과, 1개 제외     | 개발 서버 전용 테스트만 의도적으로 제외                                             |
| `npm run package:win`                            | 통과                    | x64 NSIS 설치 파일 생성                                                             |
| `npm run verify:package -- release/win-unpacked` | 통과                    | 현재 빌드와 ASAR 내용의 해시 일치, worker·언어 서버·PTY·아이콘·프로필 제외          |
| `npm audit --json`                               | 보고된 취약점 0건       | 잠금 파일의 전체 의존성, 검사 시점 기준                                             |
| 체험 프로젝트                                    | 테스트 2개 및 실행 통과 | `npm --prefix examples/playground test` / `start`                                   |

E2E는 임시 프로젝트와 별도 앱 데이터에서 실행했습니다. 파일 선택·승인 같은 운영체제 대화상자는 테스트 안에서만 대체하며, 원본 프로젝트의 파일 작업·diff·언어 서버·터미널·디버그·설정 저장은 실제 앱 코드입니다.

검증한 주요 흐름:

- 그래프 카드의 실제 마우스 드래그 → 채팅 첨부 → 격리 변경 → 원본 유지 → 승인 취소 → 선택 파일 적용 → 그래프 갱신.
- 질문 모드, 실행 중지, 중단된 부분 변경 검토, 미적용 변경안 보관·취소, 재실행 후 기록 복원.
- 새 파일·이름 변경·저장·외부 변경 충돌, UTF-8 BOM/CRLF 보존, 브레이크포인트 경로 이동.
- 실제 TypeScript 자동완성/자동 import, hover·매개변수 안내, 진단·정의·참조·이름 변경 검토.
- 두 개의 실제 터미널, Node 브레이크포인트·변수·스텝, 프로젝트 작업 실행.
- 설정·단축키 변경·스니펫·자동 저장·미저장 초안 복구·패널 크기 유지.
- 1,200개 파일이 있는 폴더의 가상화·키보드 이동·빠른 파일 열기·전체 검색.
- 동일한 파일명을 가진 두 프로젝트를 네 차례 전환하며 버퍼·언어 정보·그래프·저장 경계 유지.
- 저장 중 종료 요청, 종료 취소 시 도구 유지, 디버그 자식 프로세스 종료, 실행 파일이 없는 디버거의 오류 복구.
- 손상된 기록·키 파일 보존, 보관 인덱스 저장 실패 시 검토 내용 유지, 외부 IPC 발신 거부.

채팅 E2E의 AI 프로세스는 로컬 프로토콜 테스트 대역입니다. 실제 공급자 사용량을 소비하는 Codex 검증과 혼동하지 않습니다.

## 실제 Codex 연결

이번 작업 중 로그인된 로컬 Codex CLI로 별도 합성 프로젝트에서 실제 변경 요청을 수행했습니다. 격리 복사본만 변경된 상태를 확인하고 선택 파일을 적용한 뒤 그래프 revision 변경까지 확인했습니다.

- 결과: `applied`
- 실행 기록 ID: `4b67899a-1ee2-496b-a8db-9793e4d8da92`
- 로컬 증거: `C:\Users\cdi65\AppData\Local\Temp\witch-live-codex-vs6dUD`
- 재현 스크립트: `scripts/smoke-codex.ts` — 명시적 opt-in 필요, 실제 공급자 사용량 소비.

실제 Codex가 Witch 소스나 사용자의 다른 저장소를 수정하도록 테스트하지 않았습니다. Claude Code와 직접 API 키 기반 추론은 아직 연결하지 않았습니다.

## 규모 측정

`npm run benchmark -- 5000`의 합성 TypeScript 프로젝트 결과입니다.

| 항목                     |        측정값 |
| ------------------------ | ------------: |
| 파일 / 연결              | 5,000 / 4,999 |
| 전체 모듈 / 화면 카드    |     250 / 220 |
| 최초 분석                |      8,008 ms |
| AST 캐시를 사용한 재분석 |      7,127 ms |
| 한 파일 변경 후 재분석   |      7,451 ms |
| 그래프 레이아웃          |         87 ms |
| 분석 프로세스 최대 RSS   |     약 210 MB |

캐시가 있어도 파일 읽기는 수행합니다. 즉시 재분석이나 실제 대형 저장소에서 같은 시간을 보장하지 않습니다. RSS는 벤치마크 프로세스 값으로, 전체 Electron 앱의 메모리 사용량이 아닙니다. 화면 제한과 원본 분석 결과의 크기도 구분합니다.

## macOS 검증 경계

GitHub hosted macOS runner에서 macOS 13+ universal DMG/ZIP 패키징과 source/packaged-app E2E를 실행해 통과했습니다. 패키지 검증은 universal 앱 실행 파일의 양쪽 CPU slice와 아키텍처별 PTY·spawn-helper Mach-O 헤더를 확인합니다.

- macOS 프리뷰는 `identity: "-"`로 로컬 ad-hoc 서명을 명시합니다. `notarize: false`로 자동 Apple 업로드는 하지 않습니다. 인증된 배포 서명을 뜻하지 않습니다.
- CI 통과는 여러 Intel·Apple Silicon 실기에서의 장시간 사용 검증을 대신하지 않습니다.
- 미실행: Apple Developer ID 서명·공증, Gatekeeper 정식 배포 검증, 사용자의 실제 Intel/Apple Silicon 장치별 설치·제거 시험.

별도 macOS 환경에서 재현하려면 다음을 실행합니다.

```sh
npm ci
npm run typecheck
npm test
npm run package:mac
npm run verify:package -- release/mac-universal/Witch.app
WITCH_PACKAGED_EXECUTABLE=release/mac-universal/Witch.app/Contents/MacOS/Witch npm run test:e2e
```

일반 pull request와 `main` push의 source 재검증은 `.github/workflows/quality.yml`, package/packaged-app 재검증은 `.github/workflows/package-desktop.yml`을 사용합니다. Focus·구조 비교·내보내기를 포함한 commit `12dd22d`는 과거 Windows/macOS 전체 CI를 통과했지만 아직 v0.2.0 Release에는 포함되지 않았습니다.

## 주요 기능 경계

Git 변경·stage·commit·branch UI는 요청대로 보류했습니다. Agent 격리는 Git worktree가 아닌 복사본입니다. 언어 인텔리전스는 TS/JS, 디버그는 Node JavaScript launch, 확장은 실행 코드를 허용하지 않는 JSON 스니펫에 한정합니다. CUA는 선택적 읽기 전용 관찰이며 AI의 외부 컴퓨터 조작은 연결하지 않았습니다.

보관·스테이징·복구 파일에는 소스가 포함될 수 있습니다. 자동 삭제하지 않으며, 보관본의 UI 복원이나 디스크 정리 도구도 아직 제공하지 않습니다. 자세한 안전 경계는 [구현 현황](implementation-status.md)과 [README](../README.md)를 참고하세요.
