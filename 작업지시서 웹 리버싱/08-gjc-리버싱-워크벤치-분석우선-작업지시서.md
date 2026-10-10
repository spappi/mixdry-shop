# gjc 리버싱 워크벤치 작업지시서 — 분석-우선(Analyze-First) 루프

## 0. 순서

이 작업지시서는 **멀티페이지 크롤 엔진 작업지시서 이후**에 착수한다.
엔진(추출)이 먼저 완성되어야 분석 결과를 받아 실행할 수 있다.

## 1. 목표

"추출이 먼저"에서 **"분석이 먼저"**로 플로우를 뒤집는다.

```
[사이트 분석] → 프로파일 표시 → 범위 확정 → [추출 시작] → (백엔드) API 추론
     ↑ 에이전트 + Playwright MCP (판단)      ↑ 워크벤치 엔진 (기계적 실행)
```

- 프론트엔드: 워크벤치 최고의 기능 — 어떤 사이트든 분석 후 자동 추출.
- 백엔드: 분석 단계에서 관찰된 실제 API 트래픽을 OpenAPI 스펙으로 추론하고,
  프론트가 기대하는 형태의 백엔드 스캐폴드와 연결.

## 2. 배경

- 현재: 사용자가 URL을 넣고 바로 추출. 사이트마다 구조가 달라 범위 판단이 사용자 몫.
- 목표: 에이전트가 사이트를 프로파일링해서 크롤 설정을 만들고, 사용자가 확정만 하면
  엔진이 기계적으로 추출하는 자동 루프.
- 근거 (2026-10-10 리서치):
  - 2026년 트렌드는 "앱이 아니라 SKILL" — 결정적 추출(토큰·스크린샷·아카이브) →
    에이전트 생성 → visual-diff 검증 루프 형태가 표준이 되어가고 있음.
  - 브라우저 조종 MCP의 사실상 표준은 Microsoft 공식 `playwright-mcp`
    (접근성 스냅샷 방식이라 비전 모델 불필요).
  - `thinkfar/siteforge`라는 선행 사례가 클로닝 + HAR 캡처 + API 스텁을 한 번에
    처리 — 우리의 "백엔드 API 추론" 아이디어와 가장 가까운 형태.
  - 트래픽→OpenAPI 변환은 `grokify/traffic2openapi`(Go)가 가장 성숙
    (path-param/type/auth/pagination 추론 내장).

## 3. Part A — Playwright MCP 연동 (가재코드)

IDA MCP 때와 동일한 요령으로 진행:

- `C:\Users\mixdr\.gjc-free\agent\mcp.json`에 playwright 서버 등록:
  `command: npx`, `args: [-y, @playwright/mcp@latest, --headless, --isolated]`
  (`--headless`는 백그라운드 분석용, `--isolated`는 세션 오염 방지)
- `free-gjc-real.bat`의 `--mcp-config` exact-file 모드 유지 (원작 이슈 #4284/#4335
  우회책 — IDA 때와 동일).
- 타임아웃 30000ms 유지 (node 기반이라 idalib보다 가볍지만 안전하게).
- **설정 변경 후에는 새 세션 시작** (인-세션 MCP 리로드 없음 — IDA 때와 동일).
- 새 세션에서 `browser_navigate` + `browser_snapshot` 호출로 도구 로드 확인 후 보고.
- 참고: https://github.com/microsoft/playwright-mcp (Apache-2.0)

## 4. Part B — web-analyzer 스킬 (사이트 프로파일러)

기존 web-cloner 스킬을 격상. **직접 긁지 않고 판단만 하는 스킬**로 재정의한다.

- 입력: URL 하나. 출력: 사이트 프로파일(JSON) + crawlConfig.
- 프로파일 스키마:
  - `siteType`: server-rendered / spa / board-heavy / login-walled 중 분류
  - `techStack`: Wappalyzer식 기술 스택 (알 수 있으면)
  - `menuTree`: 메뉴명 + URL 목록
  - `urlPatterns`: 대표 URL 패턴 5~10개
  - `linkMechanism`: 일반 `<a href>` / JS 내비게이션 / 무한스크롤 등
  - `pageEstimate`: 예상 페이지 수
  - `exclusions`: 제외해야 할 영역 (로그인/결제/글쓰기 등)
  - `crawlConfig`: maxDepth, maxPages, include/excludePatterns, paramBlacklist
- 판단 불가 사이트는 **"자동 클로닝 불가(또는 부분만 가능)" 선언도 정상 출력**으로 취급.
  무리한 추출 시도 금지.
- Playwright MCP 도구(`browser_navigate`, `browser_snapshot`, `browser_evaluate`)를
  사용해 분석하도록 스킬에 명시.
- 스킬북 등록: `C:\Users\mixdr\.gjc-free\agent\skills\web-analyzer\SKILL.md`
  (+ `customize doctor`에서 `[loaded]` 확인).

## 5. Part C — UI 변경 (분석 우선 플로우)

[프론트 추출] 탭 개편. "추출이 먼저가 아니라 분석이 먼저":

1. URL 입력 → **[사이트 분석]** 버튼.
2. 분석 중 표시 → **프로파일 결과 패널**:
   사이트 유형, 메뉴 트리, 예상 페이지 수, URL 패턴, 제외 영역.
3. **범위 확정 UI**: 깊이 / 최대 페이지 수 / 제외 패턴 —
   프로파일 값으로 프리필되고 사용자가 수정 가능.
4. **[추출 시작]** → 멀티페이지 크롤 엔진 실행 (기존 파이프라인).
5. 프로파일 JSON은 저장해두고 같은 사이트 재추출 시 재사용 (재분석 스킵 옵션).

## 6. Part D — 백엔드 API 추론

- 분석 단계에서 CDP로 **XHR/fetch 트래픽도 함께 캡처**한다
  (v3.2의 에셋 인터셉트와 같은 CDP 세션 — 바디만 에셋이 아니라 API 응답도 저장).
- 캡처된 트래픽에서 API 목록을 추출: 메서드, 경로, 쿼리/바디 파라미터, 응답 형태.
- OpenAPI 스펙 파일(`api-spec.yaml`) 생성.
  참고 구현: `grokify/traffic2openapi` (Go, traffic→IR→OpenAPI 3.x, path-param·타입·
  인증·페이지네이션 추론) — 직접 갖다 쓰거나 로직을 참고.
- 관찰된 API에 맞는 백엔드 스캐폴드와 연결: 기존 `scaffold-backend`가 생성하는 라우트가
  실제 프론트가 호출하는 엔드포인트/페이로드 형태와 일치하도록.
- **1차 범위: 스펙 파일 생성까지.** 스캐폴드 자동 생성 연동은 2차.

## 7. 완료 기준 (자체 검증 후 보고)

- [ ] 가재코드 새 세션에서 Playwright MCP 도구 호출 확인
      (`browser_navigate` → `browser_snapshot`으로 t-print 메뉴 읽힘).
- [ ] web-analyzer 스킬이 t-print 프로파일 + crawlConfig 생성
      (대상: https://www.t-print.co.kr/ — t-print.com 아님,
      메뉴 9개, 상품 18개 등 — 기존 조사 결과와 일치).
- [ ] UI에서 분석 → 확정 → 추출 플로우가 동작함.
- [ ] 분석 단계 CDP 트래픽 캡처에서 XHR/fetch 목록이 추출됨.
- [ ] `api-spec.yaml` 생성 확인 (t-print 상품목록/상세 API 최소 2개).

## 8. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- MCP 등록 후 새 세션 시작 (IDA 때와 동일한 제약).
- 외부 스킬/레포의 코드를 가져올 때는 라이선스 확인 (AGPL 등 카피레프트 주의).
- web-analyzer가 "불가" 판정한 사이트는 추출 시도하지 말고 판정 결과를 보고.
- 완료 보고 전 체크리스트를 직접 실행해서 확인한 뒤 보고할 것.
