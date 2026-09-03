# Semantic Composer 첫 후보 벤치마크

[한국어](README.ko.md) · [English](README.md)

이 suite는 Composer의 첫 응답을 동결한 뒤 Witch가 검증한 source candidate에
근거하는지 측정합니다. Python, Rust, TypeScript fixture는 같은 4개 영역의
Agent/order 흐름을 담아, 개념 과제를 바꾸지 않고 언어 지원을 비교합니다.

runner는 fixture 코드를 실행하지 않습니다. source 분석 후 fallback을 끈
Composer를 정확히 한 번 호출하고, graph와 receipt를 동결한 다음 source,
semantic, composition, evidence grounding, projection 결과를 따로 보고합니다.
기계 검증 통과는 사람의 시각 승인을 뜻하지 않습니다.

```sh
npm run benchmark:composer
npm run benchmark:composer -- --provider codex --case python-agent-risk
```

AI 실행은 로그인된 Codex 또는 Claude Code CLI를 사용할 수 있습니다. 결과를
공개할 때 provider, model, Witch revision, 환경, 수정하지 않은 첫 candidate를
함께 기록해야 합니다.
