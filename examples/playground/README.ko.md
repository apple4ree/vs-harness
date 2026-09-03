# Witch playground

[한국어](README.ko.md) · [English](README.md)

패키지 설치 없이 실행할 수 있는 작은 JavaScript 프로젝트입니다. 외부 서비스·인증 정보·네트워크를 사용하지 않습니다. Node.js 22 이상을 사용하세요.

Witch에서 이 폴더를 **Open repository**로 열면 `src → src/services → src/domain`, `src → src/ui` 관계를 살펴볼 수 있습니다. 테스트 파일도 실제 import 관계로 표시됩니다.

1. Constellation에서 모듈을 더블클릭해 파일을 보고, 연결을 클릭해 import 근거를 확인합니다.
2. `src/services` 카드의 드래그 손잡이를 채팅창에 놓습니다.
3. Codex CLI가 로그인되어 있으면 Ask 모드에서 “인사말이 만들어지는 과정을 설명해줘”라고 요청합니다.
4. Change 모드에서 “인사말의 Hello를 Welcome으로 바꾸고, 테스트의 기대값도 맞춰줘”라고 요청합니다.
5. 격리 작업의 diff를 확인합니다. 아직 원본은 바뀌지 않습니다. 원하는 파일을 승인·적용하면 그래프의 변경 표시가 갱신됩니다.
6. 적용하지 않으려면 Archive without applying으로 변경안을 보관합니다.

터미널에서는 이 프로젝트 폴더에서 다음을 실행할 수 있습니다. Witch의 Tasks에서도 같은 npm scripts를 선택할 수 있으며, 실행 전에 명령을 확인합니다.

```sh
npm start
npm test
```

`src/main.js`를 열고 Run and debug에서 Node 실행을 시작해 브레이크포인트도 확인할 수 있습니다. AI 호출은 실제 공급자 사용량을 소비하지만, 코드 탐색·그래프·테스트 실행에는 AI가 필요하지 않습니다.
