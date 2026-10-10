# GJC Reversing Workbench

### 개발자 가이드 (기여자 필독)
이 레포지토리는 잘못된 코드가 푸시되는 것을 방지하기 위해 강제 문법 검사(pre-push hook)를 사용합니다.
레포지토리를 최초로 클론한 후, 반드시 아래 명령어를 한 번 실행해 주세요.

```bash
git config core.hooksPath .githooks
```

이 설정을 적용해야 푸시 시 `node -c` 검증 파이프라인이 정상적으로 동작합니다.
