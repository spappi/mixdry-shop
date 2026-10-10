# gjc 리버싱 워크벤치 작업지시서 v4.2.6 — 링크 미재작성 + 깨진 에셋 참조 수정

## 0. 배경

v4.2.5로 t-print 추출 테스트 (77페이지, 436에셋, 실패 0건).
추출은 성공했으나 클론 결과물에서 아래 버그 확인됨.

## 1. 버그 #1 — 탭 메뉴(책자/스티커/포스터) 클릭 시 빈 페이지 (원인 확정)

### 증상
- 탭 메뉴 링크가 로컬 파일로 재작성되지 않고 원본 URL 그대로 남음 (96개).
- 클릭 시 "파일에 액세스할 수 없음" (존재하지 않는 로컬 경로).
- 트리 메뉴는 정상 동작 (우연히 파라미터 순서가 맞아서).

### 원인
- `crawl-links`의 `normalizeUrl()` (main.js 약 665행):
  `u.searchParams.sort()` 로 파라미터를 정렬해서 urlMap 키 생성.
  예: `?cate_code=26010000&mode=POD`
- `extract-multi` 페이지 스크립트의 `normalize()` (약 1196행):
  블랙리스트 파라미터는 제거하지만 **정렬을 안 함**.
  예: `?mode=POD&cate_code=26010000`
- 문자열 불일치 → `urlMap[norm]` 조회 실패 → 재작성 안 됨.

### 수정
페이지 스크립트의 `normalize()`에 크롤러와 동일한 정규화를 적용:
```js
function normalize(href) {
    try {
        const u = new URL(href, window.location.href);
        u.hash = '';
        paramBlacklist.forEach(p => u.searchParams.delete(p.trim()));
        const keys = Array.from(u.searchParams.keys());
        keys.forEach(k => {
            if (u.searchParams.get(k) === '') u.searchParams.delete(k);
        });
        u.searchParams.sort();
        let s = u.toString();
        if (s.endsWith('/') && s.length > u.origin.length + 1) s = s.slice(0, -1);
        return s;
    } catch(e) { return href; }
}
```
- 크롤러의 `normalizeUrl()`과 **한 글자라도 다르면 안 됨**.
  앞으로 정규화 로직을 바꾸면 두 곳을 동시에 바꿀 것.

## 2. 버그 #2 — 에셋 바디 없음 + 깨진 참조 167개 (원인 확정, 2겹)

### 증상
- `[에셋 바디 없음]` 5건 (빨간 로그).
- CSS 파일에서 79개, HTML에서 88개의 깨진 로컬 참조
  (`../assets/img-117.png` 등 존재하지 않는 파일).

### 원인 (a) — 바디 캡처 실패
- 브라우저 캐시에 있는 이미지(bullet.png 같은 공용 에셋)는
  네트워크 요청이 발생하지 않아 CDP 캡처에 바디가 없음.

### 원인 (b) — 저장 실패했는데도 재작성은 함
- `extract-multi` 에셋 저장 부분 (약 1395행 근처):
  ```js
  if (innerBody) {
      fs.writeFileSync(...);  // 바디 있을 때만 저장
      ...
  }
  const newRelativePath = '../' + lp;
  cssText = cssText.split(m).join(`url("${newRelativePath}")`);  // 바디 없어도 재작성!
  ```
- 일반 에셋도 마찬가지: `[에셋 바디 없음]`이어도 HTML은 이미
  로컬 경로로 바뀌어 있음 → 깨진 참조.

### 수정
1. **바디가 없어서 저장에 실패하면 URL을 재작성하지 말고 원본 유지.**
   - CSS inner url: `if (innerBody)` 블록 안으로
     `cssText.split(m).join(...)` 이동.
     바디 없으면 해당 `url(...)`은 손대지 않음.
   - 일반 에셋: `[에셋 바디 없음]`인 경우, 페이지 스크립트에서
     이미 바뀐 `src`/`href`를 원본으로 되돌릴 수 없으므로,
     **폴백 다운로드를 먼저 시도**할 것 (아래 2).
2. **폴백 다운로드 추가** (캐시 때문에 캡처 못 한 경우):
   `bodyData`가 없을 때 `fetch(item.url)`로 직접 다운로드 시도.
   - v4.1의 폴백 모드에 있던 `executeJavaScript(fetch(...))` 패턴 재사용.
     단, 지금은 Runtime.evaluate 파이프라인이므로
     `debugger.sendCommand('Runtime.evaluate', ...)` 로 fetch 수행.
   - 성공하면 파일 저장 + 매니페스트 기록.
   - 실패하면 `[에셋 실패]` 로그만 남기고 URL은 원본 유지
     (깨진 로컬 참조를 만들지 않음).
3. 같은 이유로 `globalImgMap`에 `lp`를 등록하는 시점도
   **실제 저장 성공 후**로 이동할 것.
   (저장 안 됐는데 맵에 있으면 다른 페이지에서 같은 URL을
   "이미 저장됨"으로 오인함.)

## 3. 수정하지 않는 것 (설계상 한계, 문서에만 기록)

- **메인 슬라이더가 사진 나열**: Swiper JS 라이브러리 기반.
  script 태그 제거 정책상 동작 불가. 구조는 보존됨.
- **주문 페이지 사이즈 입력 막힘**: JS로 동작하던 선택기.
  백엔드 재구축 단계에서 해결할 문제.
- 위 두 건은 README의 "알려진 한계" 섹션에 기록할 것.

## 4. 완료 기준

- [ ] t-print 추출 후 `index.html`의 책자/스티커/포스터 탭 링크가
      로컬 파일(`./pages/goods_list_php_*.html`)로 재작성됨.
- [ ] 미재작성 외부 링크(`t-print.co.kr`로 남은 href) 0건.
- [ ] 깨진 로컬 참조(CSS+HTML) 0건.
      검증 방법: 클론 폴더에서 모든 `url(...)`/`src`/`href` 로컬 경로가
      실제 파일로 존재하는지 스크립트로 검사.
- [ ] `[에셋 바디 없음]` 발생 시 fetch 폴백이 동작하고,
      그래도 실패하면 원본 URL이 유지됨 (깨진 참조 생성 금지).
- [ ] `node -c` 파이프라인 통과 후 푸시.

## 5. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- 정규화 로직은 크롤러/페이지 스크립트 두 곳에 있음.
  한쪽만 고치면 이번과 같은 불일치가 재발함.
- 템플릿 리터럴 안의 정규식은 이중 백슬래시 유지
  (v4.2.4 교훈: 단일 백슬래시는 증발함).
