# Graph 전달과 시각 검증

[한국어](visual-validation.ko.md) · [English](visual-validation.md)

Witch는 source 분석이 유효하다는 이유만으로 화면 그래프도 유효하다고 보지
않습니다. 화면에 그려진 그래프를 별도의 전달 artifact로 다루며 세 receipt를
분리합니다.

| 계약 | Gate |
| --- | --- |
| `witch.visual-quality/v1` | 결정적인 projection geometry |
| `witch.rendered-graph/v1` | 실제 React Flow DOM/SVG 측정 결과 |
| `witch.graph-delivery/v1` | Source + projection + rendered 전달 |

projection validator는 node overlap, 무관한 node를 통과하는 edge, 실제 교차,
모호한 공용 corridor, route rhythm, label clearance, boundary border run,
projection된 글자 크기, density, viewport overflow를 검사합니다. 각 diagnostic은
대상, 측정 근거와 지원 가능한 수정 종류를 담습니다.

React Flow가 그려진 뒤에는 실제 node rectangle, sampling한 SVG route, edge
label rectangle, projection된 label 크기와 viewport overflow를 측정합니다.
Source, projection, rendered 단계가 모두 유효해야 candidate를 `accepted`로
바꿉니다. 이후 candidate가 실패하면 같은 view family의 마지막 유효 화면을
유지하고 `preserved-last-good`을 표시합니다. 이전 유효 화면이 없으면 실패한
candidate를 명시적인 오류와 함께 보여주며 조용히 valid로 표시하지 않습니다.

## 재현

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run capture:visual-matrix -- path/to/project test-results/visual-matrix
```

matrix는 overview와 component lens를 대상으로 night, twilight, high-contrast
테마와 desktop/compact viewport 조합을 캡처합니다. 개별 screenshot,
`contact-sheet.html`, `contact-sheet.png`, `visual-matrix-receipt.json`을
생성합니다. 기계 receipt의 valid는 시각적 의미까지 승인하지 않으며, 공개 시각
주장에는 이름을 기록한 사람의 review가 필요합니다.

첫 candidate Composer와 이해도 protocol은 `benchmarks/semantic-composer`와
`benchmarks/comprehension`에서 versioning합니다. Composer 결과는 Provider별로
분리하고, 사람 이해도 결과는 reviewer가 고정 과제를 모두 판정할 때까지
`pending`입니다.
