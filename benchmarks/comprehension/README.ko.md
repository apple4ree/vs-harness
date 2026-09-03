# 사람의 아키텍처 이해도 벤치마크

[한국어](README.ko.md) · [English](README.md)

이 protocol은 사용자가 Witch에서 entry point를 찾고, Agent/risk 의존성을
따라가며, retry 근거를 확인하고, 그래프에서 source로 왕복할 수 있는지
측정합니다. Python, Rust, TypeScript case는 같은 과제를 표현합니다.

Witch는 사람 점수를 만들어내지 않습니다. 이름을 기록한 reviewer가 과제
결과를 판정해야 session이 최종 상태가 됩니다. evaluator는 과제 성공률,
일치하는 근거까지의 중앙 시간, 잘못 연 source 수, 탐색 횟수를 따로
보고합니다. source 내용과 가중/종합 점수는 거부합니다.

```sh
npm run benchmark:comprehension:check
npm run benchmark:comprehension:check -- --session path/to/session.json
```

`witch.comprehension-session/v1` event(`task-start`, `view-open`, `node-select`,
`edge-select`, `source-open`, `answer`)와 가명 participant ID를 사용합니다.
경로와 graph ID는 허용하지만 source text는 저장하지 않습니다.
