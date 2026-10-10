# gjc 리버싱 워크벤치 작업지시서 v4.2 — 크롤링 단일화 + Smart Scope

## 0. 목표

1. **UI 단일화**: 단일 추출 / 멀티페이지 추출 구분을 없애고 "크롤링" 하나로 통일.
   단일 추출은 초기 테스트용이었음. 깊이 0 (=시작 페이지만)이 그 역할을 대체.
2. **Smart Scope**: 무한 크롤을 페이지 상한(maxPages)으로 막는 구식 방식에서 탈피.
   분석 단계에서 sitemap 조회·패턴 그룹화·콘텐츠 중복 감지로 범위를 확정.
3. **잔여 버그 수정**: 빈 이미지 3종 세트, 멀티페이지 패턴 저장 버튼.

## 1. 배경

- 현재 탭 1에는 `chk-multipage` 체크박스, `btn-run-extract`(단일 추출 시작),
  `btn-crawl`(링크 수집), `btn-extract-multi`(수집된 페이지 추출 시작)가 혼재.
  사용자는 "단일 추출"이 테스트용 잔재인 줄 모르고 헤맴.
- maxPages=50은 안전망이 아니라 평소 상한처럼 동작했고, 상한 도달 여부를 알 수 없어
  잘린 클론을 "완료"로 오인하게 만듦. t-print 실측에서 게시판 글 7,000개 같은
  무한 공간이 상한을 갉아먹는 것이 확인됨.
- 2026 트렌드: 분석 단계에서 범위 확정 (sitemap 기반, 쿼리 변형 붕괴,
  네비게이션 스코프 발견, 발견 경고 표시).

---

## Part A — UI 단일화 + 설정 정리

### A.1 제거

제거 대상 전체 목록 (하나라도 남기면 깨짐):

- index.html:60 — `chk-multipage` 체크박스 및 라벨
- index.html:89 — `btn-run-extract` (단일 추출 시작) 버튼
- renderer.js:142-144 — 분석 완료 후 UI 조작 3줄
  (체크박스 자동 체크, multi-settings 표시, 단일 버튼 숨김) 전체 제거
- renderer.js:171, 181-182 — `chkMulti` const 및 change 리스너
- renderer.js:173, 275 — `btnExtractSingle` const 및 click 리스너
- `extract-frontend` IPC 핸들러는 main.js에 유지 (예비용). UI에서는 호출하지 않음.

### A.2 크롤 설정을 설정 모달로 이동

현재 추출 탭에 있는 4개 입력이 너무 번잡하고, 사용자가 의미를 몰라도 됨:

- `inp-depth` (크롤 깊이)
- `inp-maxpages` (최대 페이지)
- `inp-exclude` (제외 패턴)
- `inp-param-ignore` (URL 파라미터 무시)

이동 작업:

- 추출 탭에서 4개 입력 + 라벨 전체 제거 (index.html:67, 71, 76, 80).
- `settings-modal`에 "고급 크롤 설정" 섹션 신설, 4개 입력을 여기로 이동
  (id는 그대로 유지해서 renderer.js 참조 변경을 최소화).
- `loadSettings`/`saveSettings`에 4개 항목 추가.
  localStorage 키 `gjc-wb-settings`에 저장:
  `crawlMaxDepth` (기본 2), `crawlMaxPages` (기본 500),
  `crawlExclude` (기본 `login, cart, member, mymenu, my_group, mypage, auth, board_style=view, write`),
  `crawlParamIgnore` (기본 `timeKey`).
- 설정 모달을 열지 않는 사용자는 기본값 그대로 사용. 고급 사용자만 ⚙에서 조정.
- ⚠️ 분석 결과가 설정값을 영구히 덮어쓰면 안 됨. 분석의 crawlConfig는
  런타임 변수에만 보관 (아래 A.4).

### A.3 수집 계획 패널 (읽기 전용)

분석 완료 후, 숫자 입력창 대신 **분석이 결정한 수집 계획**을 요약 표시:

```
수집 계획
- 깊이 2 · 최대 500페이지
- 게시판 본문 자동 제외 (board_style=view, 3,200개 규모 감지)
- sitemap.xml에서 42개 URL 발견 → 시드로 사용
- 추적 파라미터 timeKey, utm_source 정규화
```

구현:

- `analyze-result-panel` 아래에 새 div `id="crawl-plan-panel"` 추가.
- renderer.js에 런타임 변수 `let lastCrawlPlan = null;` 추가 (localStorage에 저장 금지).
- 기존 renderer.js:147-149 (분석 결과를 입력창에 채우던 코드)를 교체:
  입력창 채우기 → `lastCrawlPlan`에 보관 + 계획 패널 렌더링.
- 값은 직접 수정 불가. 바꾸고 싶으면 ⚙ 설정 모달에서.
- 분석 없이 바로 [링크 수집]을 누르면 설정 모달의 기본값으로 동작
  (`lastCrawlPlan`이 null이므로).
- URL 입력(`extract-url`)이 변경되면 `lastCrawlPlan = null`로 리셋하고
  계획 패널을 숨김 (다른 사이트의 계획이 적용되는 사고 방지).

### A.4 플로우 + 설정 우선순위

- 플로우: URL 입력 → [사이트 분석] → 수집 계획 확인 → [링크 수집] →
  수집 결과 확인 → [수집된 페이지 추출 시작] → 완료 →
  [출력 폴더 열기] [클론 실행] [패턴으로 저장]
- 크롤 깊이 0 = 시작 페이지만 수집·추출 (기존 단일 추출의 테스트 용도 대체).
  코드상 시작 URL은 results에 선탑재되므로 깊이 0에서도 정상 동작함
  (main.js crawl-links 확인됨).
- 설정 우선순위: **분석 결과(lastCrawlPlan) > 설정 모달 기본값**.
  renderer.js에 `getEffectiveCrawlConfig()` 헬퍼를 신설:
  설정 모달 입력값(또는 기존처럼 DOM에서 직접 읽기)을 읽은 뒤
  `lastCrawlPlan`이 있으면 그 값으로 덮어씀.
- 교체 대상 (현재 입력창에서 직접 읽던 코드):
  - renderer.js:202-205 — `btnCrawl`의 config 조립
  - renderer.js:234 — `btnExtractMulti`의 paramBlacklist
  두 곳 모두 `getEffectiveCrawlConfig()`를 사용하도록 변경.
- 패턴 저장 버튼(`btn-open-pattern-modal`)은 Part D 수정 후
  크롤링 완료 시 항상 표시 (단일/멀티 구분 없음).

---

## Part B — Smart Scope (분석이 자동으로 판단)

방향: 사용자가 maxDepth·제외 패턴·파라미터 무시의 의미를 몰라도 되게.
분석이 사이트를 보고 결정하고, 수집 계획 패널(A.3)에 "왜"를 보여줌.

### B.0 분석의 crawlConfig 자동 결정 강화 (analyze-site 핸들러)

현재 휴리스틱 crawlConfig (maxDepth 2, maxPages 50, excludePatterns 고정 목록)를
아래처럼 사이트 특성에 따라 자동 결정하도록 확장:

- **maxDepth**: 프로파일 기반. `board-heavy`(게시판 링크 비중 높음) → 2,
  `catalog`(상품 목록/상세 구조) → 2, `blog`(글 목록) → 1, 단일 랜딩 → 0.
- **excludePatterns**: 프로파일 기반 자동 추가.
  - 전제: 분석 스크립트가 nav뿐 아니라 페이지 전체의 `<a href>`를 샘플링해서
    URL 패턴 분포를 계산할 것 (현재는 nav/header/.menu/.gnb만 수집).
  - 게시판 본문 URL 패턴이 발견 링크의 30% 이상이면 해당 패턴 자동 추가
    (예: `board_style=view`).
  - 로그인/장바구니/마이페이지 계열은 기존처럼 기본 포함.
  - ⚠️ 기본값에 상품 경로와 충돌하는 문자열 금지 (`order` 사고 재발 방지).
- **paramBlacklist**: 분석 중 수집된 URL의 파라미터명을 훑어서 추적/세션성
  파라미터를 자동 감지: `utm_*`, `timeKey`, `sessionid`, `PHPSESSID`,
  `fbclid`, `gclid` 패턴. 발견된 것만 블랙리스트에 추가하고 계획 패널에 표시.
- **maxPages**: 500 고정 (B.8). 평소 범위 제어는 B.2~B.6이 담당하므로
  분석이 이 값을 바꿀 필요 없음.
- 분석 결과의 crawlConfig는 A.4 우선순위에 따라 설정 모달 기본값을 덮어씀.

### B.1 sitemap 조회 (analyze-site 핸들러)

- main process에서 `{origin}/sitemap.xml`과 `{origin}/sitemap_index.xml`을
  직접 fetch (CDP 불필요, 10초 타임아웃).
- `<loc>` 정규식 파싱으로 URL 목록 추출. 외부 라이브러리 추가 금지.
- 프로파일에 추가: `sitemapFound` (bool), `sitemapCount` (number).
- sitemap이 있으면 수집 단계의 시드로 사용 (옵션, UI 체크박스 "sitemap URL 포함",
  기본값 true).

### B.2 URL 패턴 그룹화 + fan-out 측정 (crawl-links 핸들러)

- 발견된 URL을 `(pathname + 정렬된 파라미터명 집합)` 기준으로 그룹화.
  예: `/sub_board/board_pds.php?{board_style,cate_code,clone,target}` 가 1개 그룹.
- 그룹별 발견 개수를 측정.

### B.3 고위험 패턴 자동 제외 + 경고 표시

- 그룹 개수가 임계값(기본 100, UI에서 변경 가능)을 초과하면 해당 패턴을
  제외 목록에 **자동 추가**.
- `crawl-links` 반환값에 `autoExcluded: [{pattern, count, reason}]`를 포함.
  (UI 경고 패널이 이 데이터를 사용)
- 제외된 패턴은 UI의 별도 경고 패널에 사유와 함께 표시:
  `⚠️ 자동 제외: board_pds.php?*board_style=view* (3,200개 발견 — 무한 공간 의심)`
- 자동 추가된 패턴은 제외 패턴 입력창에 그대로 노출되어 사용자가 삭제 가능
  (삭제 = 해당 패턴 재포함).
- ⚠️ 패턴 설계 주의: 같은 pathname을 쓰는 형제 그룹까지 죽이면 안 됨.
  t-print 실측 케이스: 게시판 목록(`/sub_board/board_pds.php?clone=...`)과
  글 본문(`/sub_board/board_pds.php?board_style=view&target=...`)은 pathname이
  같고 파라미터 집합이 다름. 단순 pathname 부분문자열로 제외하면 목록 페이지까지
  날아감. 따라서 자동 제외 패턴은 "pathname + 해당 그룹을 구분하는 파라미터"를
  함께 포함해야 함 (예: `board_pds.php` + `board_style=view`).
  현재 `isExcluded`의 단순 부분문자열 매칭으로 부족하면, 자동 제외 항목은
  `{pathname, requiredParams[]}` 형태의 구조체로 별도 보관하고 매칭 로직을
  확장할 것. t-print에서 목록은 살고 본문만 제외되는 것으로 검증.

### B.4 쿼리 변형 붕괴 (정규화 강화)

- 값이 빈 파라미터는 제거 (`?mode=` → 파라미터 삭제).
- 파라미터 키 정렬 후 비교.
- 목적: `goods_no=73&mode=POD`와 `goods_no=73&mode=` 같은 중복 수집을
  정규화 단계에서 하나로 합침.

### B.5 콘텐츠 중복 제거 (extract-multi 핸들러)

- 추출된 페이지 본문 텍스트를 정규화(공백 붕괴, 소문자화) 후 SHA-256 해시.
- 이미 저장된 해시와 동일하면 파일 저장을 건너뛰고, 해당 URL을
  `manifest.json`의 `duplicatePages`에 기록.
- 단, urlmap.json에는 URL을 유지 (다른 페이지의 링크가 깨지지 않도록).

### B.6 네비게이션 스코프 옵션 (crawl-links 핸들러)

- `discoveryScope` 설정 추가: `'all'` (기본값) | `'nav'`.
- `'nav'` 선택 시 `nav, header, footer` 요소 안의 `<a>`만 수집.
  (게시판 글 목록 같은 본문 링크를 원천 배제하고 싶을 때 사용)
- UI에 체크박스 추가: "메뉴 링크만 따라가기 (본문 링크 제외)".

### B.7 수집 결과 리포트

수집 완료 시 아래를 구분해서 표시 (로그 + UI):

- 총 수집 N개 (고유 URL 기준)
- 패턴별 제외 내역과 사유: `board_style=view 3,200개 제외 (fan-out)`,
  `*.pdf 12개 제외 (확장자)` …
- 상한 도달 여부: 도달 시 `⚠️ 최대 페이지 상한(500개) 도달 — 전체 수집이 아닐 수 있음`
  (자연 종료 시 "전체 N개 수집 완료")
- 전제: `crawl-links`에서 제외 발생 시 사유별 카운터를 수집하고, 반환값에
  `excludedStats: [{reason, pattern, count}]`로 포함할 것.
  (현재 코드는 제외 카운트를 세지 않음)

### B.8 maxPages 기본값 변경

- 설정 모달 기본값: `crawlMaxPages` = **500** (기존 추출 탭 기본값 100에서 상향).
- analyze-site의 crawlConfig: maxPages = **500** 고정 (기존 50에서 상향).
- maxPages는 최후의 안전망으로만 기능하도록. 평소 범위 제어는 B.0~B.6이 담당.

---

## Part C — 빈 이미지 수정

### C.1 `src=""` 빈 이미지 (주범)

- 원인: `el.src` 프로퍼티는 빈 src를 페이지 자신의 URL로 해석함.
  결과로 페이지 HTML 28개가 `img-N.php`로 저장됨 (실측 확인).
- 수정: `el.getAttribute('src')`로 읽고, 비어있거나 없으면 수집에서 제외.

### C.2 MIME 타입 검증

- 전제 작업: 현재 `extract-multi`의 `Network.responseReceived` 핸들러는
  `params.response.url`만 저장함. `params.response.mimeType`도
  `requestId → mimeType` 맵에 함께 저장하도록 먼저 수정.
- `<img>`/`<link>` URL이 `text/html`을 반환하면 이미지/CSS로 저장하지 않고
  건너뛰며 `[MIME 불일치] URL (text/html)` 로그 기록.

### C.3 URL 인코딩 정규화

- 에셋 매칭(`capturedBodies.get`) 전에 URL을 정규화해서 비교.
  (한글 파일명 `%ED%95%98...` 인코딩 불일치로 인한 `[에셋 바디 없음]` 방지)

### C.4 CSS `url()` 수집 (v2 스펙 Phase 4 잔여)

- 수집된 CSS 파일 내용을 파싱해서 `url(...)` 참조 에셋도 수집 대상에 포함.
- `background-image`, `@font-face` 등이 클론에서 비어 보이는 문제 해결.

---

## Part D — 멀티페이지 패턴 저장 버튼

### D.1 문제

- 패턴 저장 버튼(`btn-open-pattern-modal`) 표시 코드가 단일 추출 경로에만 있음.
- `extract-multi` 반환값에 `tokens`/`layout`/`components`가 없어서
  버튼을 띄워도 빈 패턴이 저장됨.

### D.2 수정

- main.js `extract-multi`: 첫 번째 페이지(메인, index.html)의 토큰 분석 결과를
  반환값에 포함 (`data: { clonePath, assets, tokens, layout, components }`).
- renderer.js 멀티페이지 성공 경로: `btn-open-pattern-modal`을
  `display = 'inline-block'`으로 표시 (단일 경로와 동일).

---

## 2. 완료 기준 (자체 검증 후 보고 — t-print 실측)

- [ ] 탭 1에 체크박스·단일 추출 버튼·4개 크롤 설정 입력이 없음.
      ⚙ 설정 모달에 "고급 크롤 설정" 4개가 있고 저장/복원됨.
- [ ] 사이트 분석 후 수집 계획 패널에 결정 내용과 사유가 표시됨
      (깊이, 제외 패턴, sitemap, 파라미터).
- [ ] 설정 모달에서 크롤 깊이를 0으로 바꾸면 1페이지만 수집·추출됨.
- [ ] t-print 분석 시 `board_style=view`가 제외 패턴에 자동 추가되고
      계획 패널에 사유(게시판 본문 규모)가 표시됨.
- [ ] t-print 크롤 수집 시 fan-out 자동 제외가 동작하고 경고 패널에 표시됨.
      제외 패턴 입력창(설정 모달)에서 삭제하면 재포함됨.
- [ ] `goods_no=73&mode=POD`와 `goods_no=73&mode=`가 1개로 합쳐짐.
- [ ] 상한(500)에 도달하지 않은 정상 수집에서 "전체 N개 수집 완료" 표시.
- [ ] 빈 이미지 수정: `assets/`에 `.php` 파일이 없음. `[에셋 바디 없음]` 0건.
- [ ] CSS 배경이미지가 클론에 표시됨.
- [ ] 멀티페이지 추출 후 [패턴으로 저장] 버튼이 뜨고, 저장된 패턴이
  라이브러리에서 조회됨.
- [ ] 기본 제외 패턴이 상품 경로(`/ORDER/`, `/ORDER_POD/`)와 충돌하지 않음.

## 3. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- **기본 제외 패턴에 상품 경로와 충돌하는 문자열 금지.**
  (`order` → `/ORDER/` 전체 제외 사고의 재발 방지. 기본값 변경 시
  t-print 실측 URL 목록과 대조할 것.)
- 원본 서버에 과도한 부하 금지 (순차 1개씩 + 간격 준수).
- 완료 보고 전 체크리스트를 직접 실행해서 확인한 뒤 보고할 것.
  (보고서에 "검증 못 함"이 있으면 미완료로 표기.)
