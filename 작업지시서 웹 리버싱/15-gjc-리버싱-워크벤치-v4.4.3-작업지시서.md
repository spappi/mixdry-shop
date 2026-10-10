# gjc 리버싱 워크벤치 작업지시서 v4.4.3 — 인터랙션 버그 수정 및 복구 UX 개선

## 0. 배경

- v4.4.2에서 인터랙션 부활 기능이 동작하지 않음.
- 원인: `data-gjc-toggle`이 중첩 요소에 중복 부착되어 이벤트 버블링으로 더블토글 발생.
- 복구 UI의 체크박스가 사용자 관점에서 인위적이라는 피드백.
- 복구 완료 로그가 인터랙션 로그보다 먼저 출력되는 순서 문제.

## 1. 목표

1. 더블토글 버그 수정 (긴급).
2. 체크박스 제거, 복구는 항상 전체 수행.
3. 클로너 카드 더블클릭으로 클론 열기.
4. 로그 출력 순서 정상화.

---

## Part A — 더블토글 버그 수정 (긴급)

### A.1 원인

t-print 전체상품 메뉴 구조:
```html
<a class="menu-all" data-gjc-toggle="true">
    <div class="hamburger" data-gjc-toggle="true">  <!-- 중첩! -->
```

감지 정규식이 부모(`<a>`)와 자식(`<div class="hamburger">`) 모두에
`data-gjc-toggle`을 부착. 햄버거 클릭 시:
1. div 핸들러 → 토글
2. 이벤트 버블링 → a 핸들러 → 다시 토글
3. 결과: 변화 없음 (사용자는 "안 살아남"으로 인식)

### A.2 수정

`lib/interactions.js`의 토글 핸들러에 `e.stopPropagation()` 추가:

```js
el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();  // ← 추가: 부모 토글 핸들러로의 버블링 차단
    // ... 기존 로직
});
```

### A.3 추가 방어 (권장)

감지 단계에서 이미 `data-gjc-toggle`을 가진 요소의 자손은 스킵:
- repair-clone의 정규식 교체 콜백에서 `match`가 중첩된 경우 처리
- 또는 interactions.js 초기화 시 부모-자식 중복을 감지하여 자식의 핸들러만 유지

최소한 `stopPropagation()`은 필수. 추가 방어는 선택.

### A.4 검증

- t-print 클론에서 전체상품 클릭 시 메뉴가 접혔다 펼쳐졌다 하는지 확인.
- 햄버거 아이콘 직접 클릭과 텍스트 클릭 모두 테스트.

---

## Part B — 체크박스 제거, 복구 통합

### B.1 변경사항

1. 클로너 카드에서 "인터랙션 부활" 체크박스 UI 완전 제거.
2. `repair-clone`은 항상 에셋 복구 + 인터랙션 부활을 모두 수행.
3. `preload.js`의 `repairClone: (dir, revive)`에서 `revive` 파라미터 제거
   → `repairClone: (dir)`로 단순화.
4. `main.js`의 `repair-clone` 핸들러에서 `reviveInteractions` 분기 제거,
   인터랙션 부활 로직을 항상 실행.

### B.2 이유

- 사용자 관점에서 "복구"는 "클론을 완전히 고치는 것" 하나의 개념.
- 에셋 복구 vs 인터랙션 부활의 구분은 구현자의 관점이 UI에 새어 나온 것.
- 엣지 케이스(HTML 수동 수정 후 복구)를 위해 99%의 UX를 희생할 이유 없음.

### B.3 로그 메시지 업데이트

- `[복구] ... 복구 시작...` 에서 `(인터랙션 부활: true)` 표시 제거.
- 단순히 `[복구] ... 복구 시작...`으로.

---

## Part C — 클로너 카드 더블클릭으로 열기

### C.1 구현

클로너 카드의 루트 div에 `ondblclick` 핸들러 추가:
```js
ondblclick="window.api.openClone('${c.dir}')"
```

### C.2 주의사항

- 더블클릭이 버튼 클릭과 충돌하지 않도록: 버튼 영역에서의 더블클릭은
  버튼의 onclick이 두 번 실행될 수 있음. `event.stopPropagation()`으로
  버튼 클릭이 카드 더블클릭으로 전파되지 않게 처리.
- 모바일/터치 환경은 고려하지 않음 (데스크탑 앱).

---

## Part D — 로그 순서 정상화

### D.1 원인

`sendLog`는 `e.sender.send('log', ...)`로 비동기 IPC 전송.
`repair-clone`의 `return`은 동기적으로 실행되어 렌더러가 `[복구 완료]`를
먼저 출력하고, 뒤늦게 `[인터랙션 부활]` 로그들이 도착함.

### D.2 수정

인터랙션 부활 섹션의 모든 `sendLog` 호출이 완료된 후에
`return`하도록 보장. 방법:
- `sendLog`를 동기적으로 처리하거나,
- 완료 로그를 main.js에서 직접 `sendLog`로 출력 (렌더러가 아닌 main에서).

권장: main.js의 repair-clone 마지막에:
```js
sendLog(`[복구 완료] ...`);
return { success: true, ... };  // 렌더러에서는 로그 출력하지 않음
```

렌더러의 `doRepairClone`에서 `[복구 완료]` 로그 출력 부분 제거
(중복 방지).

---

## 2. 완료 기준

- [ ] 전체상품 토글이 정상 동작 (접힘/펼침).
- [ ] 체크박스 UI가 제거되고 복구 버튼만 남음.
- [ ] 복구 실행 시 에셋 + 인터랙션이 모두 처리됨.
- [ ] 클로너 카드 더블클릭 시 클론이 브라우저에서 열림.
- [ ] 로그 순서: `[인터랙션 부활]` 로그들이 `[복구 완료]`보다 먼저 출력됨.
- [ ] pre-push hook 통과 후 푸시.

## 3. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- `lib/interactions.js` 수정 후 `node --check`로 파싱 확인.
- 템플릿 리터럴 안의 정규식은 이중 백슬래시 유지.
- hook 파일 수정 시 실행 권한(100755) 유지 확인할 것.
