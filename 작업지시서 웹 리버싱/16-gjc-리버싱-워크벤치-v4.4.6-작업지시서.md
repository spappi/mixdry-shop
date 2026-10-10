# 리버싱 워크벤치 v4.4.6 작업지시서

## 1. 배경

v4.4.5에서 `getTarget()`으로 토글 타겟 탐색을 고도화했으나, t-print의 "전체상품" 메뉴가 여전히 시각적으로 토글되지 않음.

원인 규명 (2026-10-10 실측):
- 원본 사이트(t-print.co.kr)를 브라우저로 직접 확인한 결과, "전체상품" 메뉴는 **클릭 토글** 방식 (호버 아님)
- 원본은 jQuery로 `.gnb-all`을 `slideDown()`/`slideUp()`으로 제어
- 클론의 HTML 구조:
  ```html
  <li class="gnb-1li gnb-1li-all">
      <a class="menu-all" data-gjc-toggle>...</a>
      <ul class="gnb2" style="display: block;">          <!-- 껍데기: 항상 보임 -->
          <div class="menu-all">...</div>
          <ul class="gnb-2ul gnb-all" style="display: none;">  <!-- 진짜 내용: 토글 대상 -->
      </ul>
      <div id="category-all-bg">...</div>
  </li>
  ```
- v4.4.5의 `getTarget()`은 형제 요소 중 첫 번째 `ul`인 `.gnb2`를 반환
- 하지만 `.gnb2`는 항상 `display: block`인 컨테이너라 토글해도 화면 변화 없음
- 실제 토글해야 할 요소는 중첩된 `.gnb-all` (현재 `display: none`)

## 2. 수정 사항

### 2.1 `lib/interactions.js` — `getTarget()` 고도화

현재 `getTarget()`이 형제 `ul`/`ol`을 찾으면, 그 **내부에 중첩된 숨겨진 메뉴가 있는지** 추가로 확인할 것.

```js
const getTarget = (base) => {
    let sib = base.nextElementSibling;
    while (sib) {
        if (sib.matches('ul, ol, nav, .menu, .submenu, .depth2')) {
            // 중첩된 실제 토글 대상이 있는지 확인
            // (껍데기 ul 안에 display:none인 실제 메뉴가 있는 경우)
            const nested = sib.querySelector('ul[style*="display: none"], ul[style*="display:none"], .gnb-all, .gnb-2ul, .submenu, .depth2');
            if (nested) return nested;
            return sib;
        }
        if (sib.matches('div') && window.getComputedStyle(sib).display === 'none' && !sib.matches('[data-gjc-toggle], .text, .hamburger, .icon, .label')) return sib;
        sib = sib.nextElementSibling;
    }
    return null;
};
```

핵심 로직:
1. 형제 `ul`을 찾으면 즉시 반환하지 말고
2. 그 안에 `display: none`인 중첩 `ul`이 있는지 먼저 확인
3. 있으면 중첩된 요소를 반환 (진짜 토글 대상)
4. 없으면 기존대로 형제 `ul` 반환

### 2.2 검증

- `node --check lib/interactions.js` 통과 필수
- pre-push hook이 자동으로 검사함

## 3. 주의사항

- 이 수정은 **타겟 탐색 로직**만 변경. 기존에 부여된 `data-gjc-toggle` 속성이나 HTML 구조는 그대로 유지
- 중첩 메뉴가 없는 일반적인 경우(형제 `ul`이 곧 토글 대상)에는 기존 동작과 동일해야 함
- `querySelector`의 선택자는 필요시 확장 가능 (현재는 t-print의 `.gnb-all` 패턴 + 일반적인 `display:none` 중첩 `ul` 커버)

## 4. 로그 개선 (UX)

### 4.1 문제

복구 실행 시 `[인터랙션 부활] HTML 스캔 및 패치 시작...` 이후에 완료 메시지가 없어서 사용자가 "멈춘 건지 끝난 건지" 헷갈림.

### 4.2 수정

`main.js`의 `repair-clone` 핸들러에서 인터랙션 스캔 루프가 끝난 뒤, 적용된 패턴 개수를 집계해서 완료 로그 출력:

```js
// 스캔 루프 전에 카운터 초기화
let patchStats = { toggle: 0, accordion: 0, tab: 0, slider: 0, dropdown: 0, modal: 0 };

// 각 파일에서 패턴 적용 시 해당 카운터 증가
// ...

// 스캔 루프 완료 후
const total = Object.values(patchStats).reduce((a, b) => a + b, 0);
if (total > 0) {
    const details = Object.entries(patchStats)
        .filter(([k, v]) => v > 0)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
    sendLog(`[인터랙션 부활] 패치 완료 (${details})`);
} else {
    sendLog('[인터랙션 부활] 패치 완료 (새로 적용할 항목 없음)');
}
```

기존의 `[복구 완료]` 메시지와 순서가 꼬이지 않도록, 인터랙션 부활 섹션의 완료 로그는 해당 try 블록 안에서 출력할 것.

## 5. 버전

- v4.4.6으로 버전 범프
- 커밋 메시지에 "Fix toggle target: prefer nested hidden menu over container ul" 명시
