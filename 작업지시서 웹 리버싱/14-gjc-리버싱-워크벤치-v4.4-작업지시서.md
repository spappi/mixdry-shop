# gjc 리버싱 워크벤치 작업지시서 v4.4 — 인터랙션 부활 (Interaction Revival)

## 0. 배경

- 정적 클론은 `<script>`를 전부 제거하므로 JS 인터랙션이 죽음.
- 대표 사례: t-print "전체상품" 토글 (`<a class="menu-all">`, href 없음, 순수 JS 토글).
  트리 링크는 정상 재작성됐으나 토글 버튼 자체가 무응답.
- 단순 UI 인터랙션(토글/아코디언/탭/슬라이더/드롭다운/모달)은 패턴이 정형화돼 있어
  결정적 코드로 재구현 가능. 비즈니스 로직(견적/장바구니/결제)은 백엔드 단계에서 처리.

## 1. 목표

1. 표준 인터랙션 라이브러리 (`interactions.js`) 작성 — 의존성 없음, data-attribute 기반.
2. 추출 시 인터랙션 패턴 감지 → data-attribute 부착 → 라이브러리 주입.
3. 복구(repair-clone)에 "인터랙션 부활" 옵션 추가 — 기존 클론도 재추출 없이 업그레이드.

## 2. 설계 원칙

- **동작 관찰 → 표준 코드로 재구현.** 원본 JS를 복사하지 않음.
- **보수적 감지.** 오탐(false positive)이 미탐보다 나쁨. 확신 없는 건 건드리지 않음.
- **방어적 초기화.** 요소가 없으면 조용히 스킵. 에러를 던지지 않음.
- **버전 스탬프.** 주입된 라이브러리에 버전 표기로 중복 주입 방지.

---

## Part A — 인터랙션 라이브러리

### A.1 파일 위치

- 소스: 레포 루트 `lib/interactions.js`
- 클론 출력: `<clone>/js/interactions.js` 로 복사
- 버전 상수: `window.GJC_INTERACTIONS_VERSION = '1.0.0'`

### A.2 지원 패턴 (data-attribute 계약)

| 패턴 | 감지 힌트 | data-attribute | 동작 |
|---|---|---|---|
| 토글 | href 없는 클릭 요소 + 형제 중 `display:none` | `data-gjc-toggle="target-selector"` | 클릭 시 타겟 show/hide |
| 아코디언 | 반복되는 header/content 쌍 | `data-gjc-accordion` (컨테이너) | 하나 열면 다른 건 닫힘 |
| 탭 | 탭 목록 + 패널 | `data-gjc-tabs` (컨테이너), `data-gjc-tab="id"` | 클릭 시 해당 패널 표시 |
| 슬라이더 | `swiper-*`, `slick-*`, `owl-*` 클래스 또는 반복 slide | `data-gjc-slider` (컨테이너) | prev/next + 도트, 자동재생 없음 |
| 드롭다운 | 커스텀 셀렉트 구조 | `data-gjc-dropdown` | 클릭 시 옵션 표시, 선택 시 반영 |
| 모달 | 숨겨진 오버레이 div | `data-gjc-modal="id"`, `data-gjc-modal-open="id"` | 열기/닫기, ESC 닫기, 배경 클릭 닫기 |

### A.3 구현 요구사항

- `DOMContentLoaded`에 자동 초기화.
- 각 패턴은 독립 함수로 분리 (`initToggles()`, `initAccordions()` 등).
- 이미 초기화된 요소는 중복 바인딩 금지 (`data-gjc-init` 플래그).
- CSS는 최소한만 인라인으로 처리 (display 토글 등). 디자인은 원본 CSS를 최대한 활용.
- 슬라이더는 터치/스와이프 없이 버튼+도트만. 자동재생은 기본 off.

---

## Part B — 패턴 감지 (추출 시)

### B.1 위치

- `extract-multi`의 페이지 스크립트 템플릿 내 (스크립트 제거 직전).
- 감지 결과를 페이지 데이터에 포함해서 main 프로세스로 반환.

### B.2 감지 휴리스틱

```
1. 토글:
   - a[href 없음], button, [onclick] 중 cursor:pointer 이거나
     클래스에 menu-all, hamburger, toggle, btn-menu 포함
   - AND: 다음 형제 또는 자식 중 display:none인 ul/div 존재
   - → data-gjc-toggle 부착

2. 아코디언:
   - 동일한 부모 안에서 .acc-header + .acc-content (또는 dt+dd) 패턴이 2개 이상 반복
   - → 컨테이너에 data-gjc-accordion

3. 탭:
   - ul > li > a[href^="#"] 구조 + 대응하는 id의 div가 2개 이상
   - → 컨테이너에 data-gjc-tabs

4. 슬라이더:
   - 클래스에 swiper, slick, owl, carousel, slider 포함된 컨테이너
   - OR: 동일한 크기의 자식 div/img가 3개 이상 가로 배열
   - → data-gjc-slider

5. 드롭다운:
   - .select, .dropdown, .custom-select 클래스 + 숨겨진 ul
   - → data-gjc-dropdown

6. 모달:
   - display:none인 .modal, .popup, .layer-popup + 닫기 버튼
   - → data-gjc-modal
```

### B.3 주의사항

- 감지는 **제안** 수준. 확실하지 않으면 attribute를 붙이지 않음.
- 원본에 이미 `data-gjc-*`가 있으면 덮어쓰지 않음.
- 감지된 패턴 수를 로그에 출력: `[인터랙션 감지] 토글 2, 탭 1, 슬라이더 1`

---

## Part C — 추출 시 주입

### C.1 흐름

1. 페이지 스크립트에서 원본 `<script>` 제거 (기존 동작 유지).
2. 감지된 패턴에 data-attribute 부착 (B).
3. main 프로세스에서 `lib/interactions.js`를 `<clone>/js/`에 복사.
4. 각 HTML의 `</body>` 직전에 삽입:
   ```html
   <script src="./js/interactions.js"></script>
   ```
   (pages/ 하위에서는 `../js/interactions.js`)
5. 이미 주입된 경우 스킵 (버전 스탬프 확인).

### C.2 경로 처리

- `index.html`: `./js/interactions.js`
- `pages/*.html`: `../js/interactions.js`
- 기존 URL 재작성 로직과 동일한 상대경로 규칙 적용.

---

## Part D — 복구(repair-clone) 확장

### D.1 "인터랙션 부활" 옵션

- `repair-clone` IPC에 `reviveInteractions: true/false` 파라미터 추가.
- 클로너 카드의 복구 버튼 옆에 체크박스 또는 별도 버튼으로 노출 (UI는 간단히).

### D.2 동작

1. 클론 폴더의 모든 HTML 파일을 스캔.
2. `interactions.js`가 없으면 `lib/`에서 복사.
3. 각 HTML에서 B.2 휴리스틱으로 패턴 감지 (Node.js에서 JSDOM 없이 정규식/DOM 파싱 — 가벼운 접근).
   - 복잡하면: Chromium 오프스크린으로 로드 후 감지 스크립트 실행 (기존 인프라 재활용).
4. data-attribute 부착 + `<script>` 태그 삽입.
5. 로그: `[인터랙션 부활] index.html: 토글 1, 슬라이더 1 적용`.

### D.3 멱등성

- 이미 `data-gjc-init` 또는 버전 스탬프가 있으면 스킵.
- 반복 실행해도 안전해야 함.

---

## 3. 완료 기준

- [ ] `lib/interactions.js` 작성 및 단위 동작 확인 (간단한 테스트 HTML로).
- [ ] t-print 신규 추출 시 "전체상품" 토글이 동작함.
- [ ] 추출 로그에 `[인터랙션 감지]` 출력됨.
- [ ] 기존 v4.3.2 클론에 복구(인터랙션 부활) 실행 시 토글이 살아남.
- [ ] 복구 반복 실행 시 중복 주입 없음.
- [ ] `node -c` 파이프라인 통과 후 푸시.

## 4. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- **원본 JS를 절대 복사하지 않음.** 동작만 관찰하고 표준 코드로 재작성.
- 라이브러리는 200줄 이내로 유지. 비대해지면 분리 고려.
- 슬라이더 자동재생은 넣지 않음 (UX 이슈 + 복잡도).
- 템플릿 리터럴 안의 정규식은 이중 백슬래시 유지 (v4.2.4 교훈).
- `od -c`로 백슬래시 바이트 수 확인 (AGENTS.md 교훈).
