# Witch Architecture Knowledge v1 명세

[한국어](architecture-knowledge-v1.ko.md) · [English](architecture-knowledge-v1.md)

상태: P2 첫 단계 구현
계약: `witch.knowledge/v1`
입력: `witch.architecture/v1`, 선택적 `witch.semantic/v1`, 저장소의 ADR/RFC·manifest·설정 파일

## 1. 목적

코드가 보여주는 현재 구조와 사람이 남긴 결정·패키지 경계·프로젝트 설정을 하나의 질의 가능한 그래프에서 비교한다. Knowledge overlay는 Source·Semantic·Behavior IR을 대체하지 않으며 모든 항목에 원본 파일, 행, content hash, extractor rule을 남긴다.

## 2. 지원 입력

- ADR/RFC: `adr`, `adrs`, `rfc`, `rfcs`, `architecture/decisions` 경로와 번호가 있는 ADR/RFC Markdown
- npm: `package.json`의 package name과 dependencies/devDependencies/peerDependencies/optionalDependencies
- Python: `pyproject.toml`의 PEP 621/Poetry package 및 dependency, `requirements*.txt`
- Rust: `Cargo.toml`의 package와 dependency/dev-dependency/build-dependency
- 설정: `tsconfig*`, `jsconfig*`, Ruff·Mypy·Pytest·Tox·Rust toolchain, Cargo config, Compose, GitHub Actions
- Federation 작성 정보: `.witch/federation.json`의 안정적 `repositoryKey`와 Package Provider Mapping

프로젝트 코드는 실행하지 않는다. 알려진 파일 경로와 정적 문법만 읽는다.

## 3. 노드와 관계

노드 종류는 `decision`, `rfc`, `manifest`, `package`, `dependency`, `configuration`, `federation-repository`, `federation-mapping`이다.

관계는 `documented-in`, `declared-in`, `depends-on`, `configures`, `documents`, `describes`, `supersedes`, `evidenced-by`로 제한한다.

- Manifest에 직접 선언된 package/dependency는 `verified/accepted`이다.
- ADR/RFC 본문과 명시적인 supersedes 선언은 `authored`이다.
- 문서·설정이 전체 System을 설명하거나 구성한다는 연결은 경로 관례에 따른 `inferred/provisional`이다.
- Authored와 Inferred를 합쳐 하나의 확정 사실로 만들지 않는다.
- Federation Repository Key와 Mapping은 `authored/accepted`이며, 정확한 Package 선언은 별도의 `verified/accepted` 근거로 유지한다.

## 4. Rationale 추출

ADR/RFC의 제목, Status, Context/Problem, Decision/Proposal, Consequences/Tradeoffs 첫 문단을 결정적으로 추출한다. 각 필드는 600자로 제한한다. `Supersedes:` 또는 `Replaces:`가 현재 문서 집합의 제목·경로와 명확히 맞으면 authored `supersedes` 관계를 만든다. 해석할 수 없는 대상은 관계를 추측하지 않고 warning으로 남긴다.

## 5. 개인정보와 신뢰 경계

- 일반 설정 값, script 명령, 환경 값과 credential은 Knowledge node 설명에 복사하지 않는다.
- Manifest/config evidence는 path·line·hash만 저장하고 원문 excerpt를 저장하지 않는다.
- Dependency 이름과 package 이름은 구조 식별에 필요한 선언 사실로 보존한다.
- ADR/RFC rationale만 bounded authored text로 보존한다.
- Federation Node는 제한된 Repository Key, Ecosystem, Package/Provider Identity만 보존하며 Source에 로컬 Provider 절대경로를 기록하지 않는다.

## 6. 검증과 한계

- 모든 evidence hash는 같은 Architecture source node의 hash와 일치해야 한다.
- 관계 endpoint는 Source, Semantic 또는 Knowledge IR에 실제로 존재해야 한다.
- 최대 2,000 nodes, 5,000 relations, manifest당 1,200 dependencies를 허용한다.
- malformed `package.json`과 해석하지 못한 supersedes는 warning으로 남기고 다른 knowledge를 유지한다.
- lockfile 해석, transitive dependency resolution, license/CVE 판단, Markdown 자연어 의미 추론은 아직 수행하지 않는다.

## 7. 제품 연결

Graph Intelligence index는 Knowledge node/relation과 `knowledgeRevision`을 포함한다. Query, typed impact, Architecture Brief, Codex/Claude preflight가 동일한 bounded knowledge를 사용한다. Constellation의 **Intelligence → Knowledge**에서 결정, package/dependency, 설정을 분리해 보고 source를 열거나 Agent context에 첨부할 수 있다.

Semantic Composer가 새 semantic revision을 만들면 존재하는 endpoint만 유지해 Knowledge overlay를 다시 결박한다. Behavior와 Framework처럼 의미 revision이 바뀐 관계를 오래된 상태로 전달하지 않는다.

## 8. 완료 기준

- Python, Rust, TypeScript 프로젝트 manifest fixture가 같은 규칙으로 재현된다.
- ADR rationale와 명시적 supersedes가 source evidence를 가진다.
- 임의 config 값이 Knowledge JSON에 복사되지 않는다.
- 변조된 evidence와 stale semantic revision은 fail-closed한다.
- Knowledge node를 path 변경 영향과 Agent graph query에서 찾을 수 있다.
- Federation Key와 Mapping은 Source Evidence를 유지하고 예약 Field가 잘못되면 거부한다.
