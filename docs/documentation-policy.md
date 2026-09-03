# Witch documentation language policy / Witch 문서 언어 정책

<!-- witch-doc-languages: ko,en -->

## 한국어

Witch의 공개 Markdown 문서는 한국어와 영어 독자가 문서의 목적, 적용 범위와 중요한 제한을 같은 파일에서 파악할 수 있어야 합니다.

- 모든 `.md`와 `.mdx` 파일은 `<!-- witch-doc-languages: ko,en -->` 표식을 포함합니다.
- 모든 문서는 최소한 제목 또는 개요에서 한국어와 영어를 함께 제공합니다.
- 루트 `README.md`처럼 사용자가 처음 접하는 문서는 핵심 사용법, 지원 범위, 검증 결과와 안전 경계를 양쪽 언어로 제공합니다.
- 새로 추가하거나 의미를 바꾸는 규범적 요구사항, 안전 경계와 평가 해석은 한·영 내용을 함께 갱신합니다.
- 코드, 명령, API 이름, IR schema, metric 이름과 측정값은 번역 과정에서 바꾸지 않습니다.
- 자동 생성 문서는 생성기 자체가 두 언어의 제목과 설명을 출력해야 합니다.
- 두 언어가 충돌하면 구현과 검증 evidence를 다시 확인해 같은 의미로 고칩니다. 어느 한쪽을 임의로 우선해 사실을 바꾸지 않습니다.

`npm run docs:check`는 추적 중인 Markdown 문서의 언어 표식과 한글·영문 존재 여부를 검사합니다. 이 검사는 번역 품질을 대신하지 않으므로 리뷰에서는 의미, 수치, 링크와 비지원 범위의 일치도 함께 확인해야 합니다.

## English

Public Witch Markdown documentation must let both Korean and English readers identify a document's purpose, scope, and important limitations in the same file.

- Every `.md` and `.mdx` file includes the `<!-- witch-doc-languages: ko,en -->` marker.
- Every document provides both Korean and English in at least its title or overview.
- Entry-point documents such as the root `README.md` provide core usage, supported scope, verification results, and safety boundaries in both languages.
- New or materially changed normative requirements, safety boundaries, and evaluation interpretations must update both languages together.
- Code, commands, API names, IR schemas, metric names, and measured values must not change during translation.
- Generated documentation must emit bilingual titles and descriptions from its generator.
- If the languages disagree, re-check implementation and verification evidence and correct them to the same meaning. Do not change facts by treating either language as arbitrarily authoritative.

Run `npm run docs:check` to verify the language marker and the presence of Korean and English text in every tracked Markdown document. This mechanical check does not replace translation review; reviewers must also compare meaning, measurements, links, and unsupported-scope statements.
