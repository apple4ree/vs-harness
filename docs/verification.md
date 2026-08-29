# Witch 0.2.0 — 검증 기록

최근 검증일: 2026-08-29. 로컬 실행 환경: Windows 11 x64, Node.js 22.14.0, npm 10.9.2, Electron 44.0.0.

이 문서는 실제로 실행한 검증과 아직 실행하지 못한 검증을 구분합니다. VS Code 기능 전체 또는 모든 저장소에 대한 호환성을 보증하지 않습니다.

## 공개 프리뷰 산출물

- GitHub Release: [Witch v0.2.0](https://github.com/apple4ree/vs-harness/releases/tag/v0.2.0), 기준 commit `2709677`
- Windows x64 EXE: 138,806,211 bytes, SHA-256 `5F00F2C938B930F80C4B766847EBB9CBD9D40BC96E73F5C8FD2AA97431CEEDF5`
- macOS universal DMG: 261,899,404 bytes, SHA-256 `1676AF070A10D6A437FF641061BAC188325ED5F2A04ADFC751AA35880989476B`
- macOS universal ZIP: 261,587,503 bytes, SHA-256 `B495D6B28F677EA0F682070414D64D803586758AAD36F3BC68C21F04AB66AF6D`
- Authenticode 상태: `NotSigned`. 개인 테스트용 미서명 프리뷰입니다. 정식 서명·자동 업데이트는 구성하지 않았습니다.

Windows와 macOS GitHub Actions job은 source E2E, 패키징, 패키지 내용 검증, packaged-app E2E를 모두 통과했습니다. 설치 프로그램 자체를 사용자의 시스템에 설치·제거하는 테스트는 하지 않았습니다. 소스를 바꾸면 이미 만든 v0.2.0 설치 파일에는 반영되지 않으므로 다시 패키징해야 합니다.

## 현재 main — v0.2.0 이후

Archify 원칙을 Witch core로 옮긴 commit `1d05558` 이후 구조 시점 비교와 오프라인 내보내기는 아직 새 Release에 포함되지 않은 작업입니다. 현재 로컬 검증 결과는 다음과 같습니다.

| 검증                                              | 결과      | 범위                                                                                 |
| ------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| `npm run typecheck`                               | 통과      | 현재 TypeScript 소스                                                                 |
| `npm test`                                        | 55개 통과 | 검증된 IR, route/reach, 정확한 delta, script-safe export를 포함한 서비스·안전성 회귀 |
| `npm run build`                                   | 통과      | main/preload/renderer 프로덕션 번들                                                  |
| `npx playwright test tests/e2e/workbench.spec.ts` | 16개 통과 | 실제 Electron에서 구조 비교·HTML/JSON 저장과 IDE 핵심 UI 흐름                        |

구조 비교는 저장된 reading을 다시 검증한 뒤 현재 reading과 비교합니다. HTML과 JSON 내보내기는 검증된 graph만 허용하며, HTML은 외부 리소스 없이 동작하고 authored text를 HTML로 주입하지 않습니다.

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

GitHub 재검증은 `.github/workflows/package-desktop.yml`을 수동 실행합니다. 현재 main의 구조 비교·내보내기는 새 release 전에 이 CI를 다시 통과해야 합니다.

## 주요 기능 경계

Git 변경·stage·commit·branch UI는 요청대로 보류했습니다. Agent 격리는 Git worktree가 아닌 복사본입니다. 언어 인텔리전스는 TS/JS, 디버그는 Node JavaScript launch, 확장은 실행 코드를 허용하지 않는 JSON 스니펫에 한정합니다. CUA는 선택적 읽기 전용 관찰이며 AI의 외부 컴퓨터 조작은 연결하지 않았습니다.

보관·스테이징·복구 파일에는 소스가 포함될 수 있습니다. 자동 삭제하지 않으며, 보관본의 UI 복원이나 디스크 정리 도구도 아직 제공하지 않습니다. 자세한 안전 경계는 [구현 현황](implementation-status.md)과 [README](../README.md)를 참고하세요.
