# Federation 벤치마크

[한국어](README.ko.md) · [English](README.md)

Witch가 소유한 이 회귀 Suite는 저장소 코드를 실행하거나 AI Provider를 호출하지 않고
`witch.graph-federation/v1` 계약을 측정합니다.

## Case

v1의 6개 Case는 다음 경계를 포함합니다.

- 정확한 npm Provider
- Python PEP 503 이름 정규화
- 연결되면 안 되는 Cargo 구분자 유사 이름
- 열린 모호성으로 남아야 하는 중복 npm Provider
- 실제 선언과 대조되는 `.witch/federation.json` Provider Mapping
- 해결되지 않고 질문으로 남아야 하는 잘못된 Authored Mapping

중복 Provider Case에는 정확한 Approval Receipt와 오래된 Receipt도 차례로 적용해
정상 해결과 fail-closed Staleness를 함께 검사합니다.

## 지표

Runner는 Link Precision·Recall, Exact-case 비율, 모호성 질문 Recall, Validation 비율,
입력 순서 불변성, Authored 해결, 명시적 Approval 해결, 오래된 Approval 거부를 각각
보고합니다. 가중 종합 점수는 만들지 않습니다.

실행 명령:

```sh
npm run benchmark:federation:check
```

선언된 지표 하나라도 회귀하면 명령이 실패하며, Suite SHA-256과 실행 환경이 포함된
`witch.federation-benchmark-run/v1` JSON을 출력합니다.

## 해석 경계

이 Fixture는 Witch가 소유한 결정적 개발 데이터입니다. 만점은 여기에 표현된 npm,
Python, Cargo의 정확한 Package Identity 회귀 동작만 보장합니다. Git URL, Alias,
Service Endpoint, Deployment Topology, 임의 Monorepo 또는 독립된 제3자 저장소에 대한
일반 정확도를 증명하지 않습니다.
