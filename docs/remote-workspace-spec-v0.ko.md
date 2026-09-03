# Witch Remote Workspace v0 — 제품·기술 명세

[한국어](remote-workspace-spec-v0.ko.md) · [English](remote-workspace-spec-v0.md)

## 1. 목적

Witch Remote Workspace는 로컬 Witch UI에서 SSH 호스트의 코드, 실행 환경과 Agent 작업을 안전하게 다루는 기능이다. 목표는 VS Code 기능 전체를 복제하는 것이 아니라 원격 개발의 핵심 흐름과 Witch의 구조 분석·검토 기능을 결합하는 것이다.

이 명세의 최종 사용자 흐름은 다음과 같다.

1. 사용자가 시스템 OpenSSH 설정 또는 Witch SSH 프로필로 호스트를 선택한다.
2. Witch가 호스트 키와 인증을 OpenSSH에 위임하여 접속한다.
3. 선택한 원격 폴더를 파일 탐색기, 검색, 편집기와 터미널에서 하나의 Workspace로 연다.
4. Python, Rust, TypeScript 분석기는 원격 소스와 도구 체인 가까이에서 실행한다.
5. System–Component–Workflow 결과와 근거를 로컬 UI에 versioned IR로 전달한다.
6. Codex 또는 Claude Code는 원격 격리 worktree에서 실행하고 변경은 diff 검토 후 적용한다.

## 2. 범위와 단계

### 단계 A — SSH 프로필과 원격 터미널

- 시스템 OpenSSH 탐지
- 호스트, 포트, 사용자, 선택적 identity file 프로필
- `~/.ssh/config`, ssh-agent, OS 키 저장소의 기존 인증 흐름 유지
- 실제 PTY 기반 대화형 원격 터미널
- 다중 터미널, 연결 종료 표시, 앱 종료 시 정리
- 비밀번호, passphrase, 개인 키 본문은 Witch에 저장하지 않음

### 단계 B — Remote Workspace 파일 계층

- 원격 폴더 선택 또는 경로 입력
- 파일 목록, bounded read/write, 생성·이동·삭제
- 파일 감시, 외부 변경 충돌, 재연결
- 빠른 파일 열기와 텍스트 검색
- local/remote URI를 혼동하지 않는 `witch-remote://profile/path` identity

### 단계 C — 원격 언어·실행 서비스

- Python/Rust/TypeScript LSP를 원격에서 실행
- 원격 Task, launch, debugger, 포트 포워딩
- 원격 구조·의미 분석과 snapshot export
- 도구 버전과 remote source revision receipt

### 단계 D — 원격 Agent와 운영 안정성

- 원격 worktree 생성·수명주기·정리
- Codex/Claude Code adapter와 permission profile
- reconnect/backoff, heartbeat, resume token
- host fingerprint 변경 경고와 audit trail
- 설치 가능한 Witch Remote Service의 서명·업데이트·호환성 관리

## 3. 비목표

- VS Code VSIX 또는 Remote Extension Host 바이너리 호환
- SSH 비밀번호나 개인 키 본문 저장
- 최초 버전에서 SSHFS를 로컬 파일시스템처럼 노출
- 호스트 키 검사를 자동으로 끄는 옵션
- 원격 root 권한 자동 획득
- 사용자 승인 없이 포트 포워딩, ProxyCommand 또는 원격 Agent 실행

## 4. 아키텍처

```text
┌──────────────── Witch Desktop ────────────────┐
│ Renderer                                      │
│ explorer · editor · graph · review · terminal │
│                 │ typed IPC                   │
│ Main process   │                              │
│ connection manager · session router · audit   │
└─────────────────┬─────────────────────────────┘
                  │ OpenSSH transport
┌─────────────────▼─────────────────────────────┐
│ Witch Remote Service                         │
│ fs · watch · search · PTY · LSP · analyzer    │
│ debugger · Agent adapter · worktree           │
└───────────────────────────────────────────────┘
```

단계 A는 검증된 시스템 `ssh` 실행 파일을 `node-pty`에서 직접 실행한다. 단계 B부터는 매 요청마다 shell 명령을 조립하지 않고, SSH stdio 위에서 길이 제한이 있는 JSON-RPC `witch.remote/v1` 프로토콜을 사용한다. UI는 로컬 경로를 원격 경로로 가장하지 않는다.

## 5. 프로필과 저장

프로필은 `{userData}/remote/ssh-profiles.json`에 원자적으로 저장한다.

```ts
type SshProfile = {
  id: string;
  label: string;
  host: string; // host/IP/~/.ssh/config alias
  port: number; // 1..65535
  user?: string;
  identityFile?: string; // local absolute path only
  connectTimeoutSeconds: number; // 5..120
};
```

파일에는 password, passphrase, private-key bytes를 저장하지 않는다. POSIX에서는 가능한 경우 mode `0600`을 유지한다. 잘못되거나 지원하지 않는 저장 파일은 부분 신뢰하지 않고 빈 목록과 경고로 fail closed 한다. 손상된 원본을 새 프로필로 덮어쓰지 않으며, 사용자가 파일을 별도로 수리하거나 보존한 뒤 제거해야 다시 변경할 수 있다.

## 6. SSH 실행 규칙

- Windows: `%SystemRoot%/System32/OpenSSH/ssh.exe`
- macOS/Linux: `/usr/bin/ssh` 등 고정된 절대 시스템 후보
- 사용자 지정: 절대 경로 `WITCH_SSH_PATH`만 허용
- 프로젝트 폴더나 상대 `PATH`에서 `ssh`를 찾지 않음
- 모든 인자는 shell 문자열이 아닌 argv 배열로 전달
- host는 마지막 argv이며 `-`로 시작하거나 개행·NUL을 포함할 수 없음
- `PermitLocalCommand=no`; host key 검사는 OpenSSH 기본값을 유지
- 연결 timeout과 keepalive를 제한된 숫자로 설정

`ProxyCommand` 등 사용자의 SSH config는 로컬 코드를 실행할 수 있다. 이는 사용자가 신뢰하고 관리하는 OpenSSH 설정으로 취급하며, 접속 전 UI에서 대상과 로컬 권한 경계를 명시한다.

## 7. Remote Service 프로토콜 초안

프레임은 최대 크기와 request id를 가진 JSON-RPC 2.0이다. 초기 method 집합은 다음과 같다.

| 영역      | method                                                              |
| --------- | ------------------------------------------------------------------- |
| handshake | `remote/hello`, `remote/capabilities`, `remote/ping`                |
| 파일      | `fs/list`, `fs/read`, `fs/write`, `fs/mkdir`, `fs/move`, `fs/trash` |
| 검색      | `search/files`, `search/text`, `search/cancel`                      |
| 감시      | `watch/start`, `watch/stop`, `watch/changed`                        |
| 터미널    | `pty/create`, `pty/write`, `pty/resize`, `pty/close`, `pty/data`    |
| 분석      | `analysis/start`, `analysis/progress`, `analysis/result`            |
| 실행      | `task/run`, `debug/start`, `debug/action`                           |
| Agent     | `agent/start`, `agent/event`, `agent/stop`, `review/apply`          |

모든 파일 요청은 handshake에서 확정한 remote root 아래로 제한한다. source revision, analyzer/protocol version과 evidence hash를 결과 receipt에 포함한다.

## 8. 연결 상태

```text
disconnected → resolving → authenticating → ready
      ▲              │             │          │
      └── failed ◀───┴─────────────┴── reconnecting
```

- 인증 프롬프트는 PTY에 표시하며 renderer에 비밀 값을 복제하지 않는다.
- host fingerprint 변경은 자동 승인하지 않는다.
- 연결 유실 중 편집은 read-only로 전환하거나 명시적인 offline draft로 분리한다.
- 재연결 후 remote root identity와 source revision을 다시 검증하기 전 저장하지 않는다.

## 9. 권한과 감사

Remote Workspace의 권한은 `read`, `write`, `terminal`, `task`, `debug`, `agent`, `port-forward`로 분리한다. 단계 A의 사용자가 직접 연 원격 터미널은 로컬 수동 터미널과 같이 full terminal 권한이며 Agent sandbox가 아니다. Agent 자동 승인은 원격 shell, Git, 포트 포워딩 또는 금융 주문 권한을 포함하지 않는다.

감사 이벤트에는 profile id, target, action, 시작·종료 시각, exit code와 사용자 확인 여부를 기록하되 터미널 입력, 비밀번호, key path의 전체 내용은 기록하지 않는다.

## 10. 수용 기준

### 단계 A

- Windows와 macOS에서 고정된 OpenSSH 실행 파일을 탐지한다.
- 사용자가 UI에서 프로필을 추가·수정·삭제할 수 있다.
- 잘못된 host, port, user, 상대 identity path와 secret field를 거부한다.
- 프로필을 선택하면 실제 다중 PTY 탭으로 SSH를 실행한다.
- 호스트와 사용자는 argv로 분리되고 shell interpolation이 없다.
- 연결 실패와 process exit가 해당 terminal tab에 표시된다.
- 단위 테스트, typecheck, production build와 기존 E2E가 회귀 없이 통과한다.

### 단계 B 이후

- 원격 파일 CRUD·검색·감시·충돌 E2E
- 네트워크 단절·재연결·stale write 차단 E2E
- 원격 분석 receipt와 로컬 렌더링 validator E2E
- 원격 Agent worktree diff 검토·선택 적용·정리 E2E

## 11. 현재 구현 상태

이 문서가 처음 추가된 기능 브랜치에서는 단계 A를 구현한다. 단계 B–D는 이 계약을 유지하면서 별도의 검토 가능한 수직 변경으로 추가한다.
