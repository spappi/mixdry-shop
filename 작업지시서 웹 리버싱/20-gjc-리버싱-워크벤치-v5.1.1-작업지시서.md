# 리버싱 워크벤치 v5.1.1 작업지시서 — 객체 리터럴 백엔드 호출 탐지

## 1. 배경

v5.1.0(64cd9f1) 코드 검증 결과 (2026-10-10 22:45):
새 탐지 정규식(`main.js:1562`)도 `$.ajax('url', ...)`처럼 **첫 인자가 문자열 리터럴**인 형태만 매칭한다.
t-print 실제 코드는 객체 리터럴 + 변수 간접 참조라 여전히 0건 매치 — "POD_module.php가 잡힌다"는 보고와 달리 재추출해도 탐지되지 않는다.

실측 코드 (`tprint-v5/original/js/script-21.js`에서 직접 추출):
```js
var surl = '/ORDER_POD/POD_module.php?' + str;
$.ajax({
    url: surl,
    type: "POST",
    dataType: "json",
    ...
});
```

## 2. 기능 명세

### 2.1 `$.ajax({...})` 객체 리터럴 탐지 (핵심)

정규식 한 줄로 해결하려 하지 말 것. 결정적 스캔 알고리즘으로 구현:

1. 코드에서 `$.ajax(` 위치를 찾는다.
2. `(` 다음 첫 non-space 문자가 `{`이면 **객체 리터럴 모드**:
   - 중괄호 카운터(`{`+1, `}`-1)로 매칭되는 `}`까지의 구간(span)을 구한다.
   - 구간 안에서 `url\s*:\s*` 뒤의 값을 추출:
     - **문자열 리터럴** (`'...'`, `"..."`, `` `...` ``) → 그대로 기록
     - **식별자(변수명)** → 같은 스크립트에서 **역방향**으로 `(var|let|const) <이름>\s*=\s*['"\`]` 할당을 찾아 리터럴 부분을 해결. `'...?' + str` 같은 문자열 연결이면 `+` 앞의 리터럴만 취한다 (URL 판별에 필요한 `.php`/`/api/`/`?`는 리터럴 쪽에 있음).
     - **해결 실패** → `url: "<변수명> (미해결)"` 형태로 기록. 놓치지 말고 보이게 할 것.
   - `type\s*:\s*['"](GET|POST|PUT|DELETE|PATCH)['"]` 또는 `method\s*:` 프로퍼티가 있으면 HTTP 메서드로 기록, 없으면 `UNKNOWN`.
3. 첫 인자가 문자열 리터럴이면 기존 동작 유지 (회귀 금지).
4. `$.ajax('url', {...})` 2인자 형태도 기존처럼 처리.

판별 필터는 기존과 동일: URL에 `.php` 또는 `/api/` 또는 `?` 포함 시 백엔드 후보. `(미해결)` 항목도 필터 통과 시 기록한다.

### 2.2 스텁 교체도 객체 형태 대응 (`main.js:1575`)

현재 `stubBackendCalls`는 `$.post(url, data, callback)` 형태만 교체한다. `$.ajax({...})` 형태도 교체 대상에 추가:

- 중괄호 매칭으로 `$.ajax({...})` 호출 구간 전체를 구한 뒤, 아래 IIFE로 교체한다:
```js
(function(){ var cfg = {원본_객체_리터럴_텍스트_그대로}; console.warn('[STUB] Backend call intercepted:', cfg.url); var fake = { total_price: '99,000원 (스텁)', goods_price_vat: '108,900원 (스텁)' }; try { if (cfg.success) cfg.success(fake); } catch(e){} })()
```
- 원본 객체 리터럴 텍스트를 `var cfg = {...}` 안에 그대로 넣으므로, 중괄호 매칭이 정확해야 한다. `cfg.success`가 원본 콜백을 그대로 호출하므로 클론 미리보기에서 기존 동작(스텁 응답 표시)이 유지된다.
- 탐지와 같은 URL 필터(`.php`, `/api/`, `?`)를 통과한 경우에만 교체한다. 필터 판정에는 §2.1에서 해결된 리터럴을 사용한다.
- 교체 후 클론 JS 전체에 `node --check` 파싱 검증을 한다 (v4.2.0 SyntaxError 사고 반복 금지).

### 2.3 XHR 탐지 일반화

현재 정규식의 `(?:xhr|req|ajax)\.open`은 변수명 휴리스틱이라 `var x = new XMLHttpRequest(); x.open('POST', url)` 같은 형태를 놓친다.

- 같은 스크립트에서 `new XMLHttpRequest()`를 할당받은 변수명을 먼저 수집한다.
- 그 변수들의 `.open('METHOD', url)` 호출을 탐지한다. `url`이 변수면 §2.1과 같은 역방향 리터럴 해결을 적용한다.
- 기존 휴리스틱 매칭은 폴백으로 유지한다 (회귀 금지).

### 2.4 인라인 JS의 source를 페이지 경로로 (`main.js:1591`)

현재 `extractBackendCalls(item.text, 'inline-script')` — source가 고정 문자열이라 어느 페이지에서 발견됐는지 알 수 없다.
`currentLocalPath` (예: `pages/POD_goods_php_26010100_73_POD_2.html`)로 변경한다. v5.1 UI의 페이지별 필터가 이 필드에 의존하므로 선행 조건이다.

### 2.5 미리보기 서버 경로 정리 (`main.js:2092`)

현재 `path.join(dir, req.url === '/' ? 'index.html' : req.url.split('?')[0])` — `..` 를 정리하지 않아 `http://localhost:8000/../` 요청으로 클론 폴더 밖 파일이 읽힐 수 있다. localhost 한정이라 긴급도는 낮음.

- `path.normalize()`로 정리한 뒤 결과가 `dir`로 시작하는지 확인하고, 벗어나면 403을 반환한다.
- 쿼리스트링 제거는 기존대로 유지한다.

### 2.6 forms 중복 기록 순서 (`main.js:1541`–`1551`)

현재 `pageData.formsData`/`onclickUrls`의 push가 콘텐츠 중복 제외(`continue`, 1551행)보다 앞에 있어서, 중복 콘텐츠로 판정된 페이지의 form이 두 번 기록된다. `backendForms` 자체에는 dedup 로직도 없다.

- push를 `continue` 이후로 이동하거나, `backendForms`를 `action|method` 키로 dedup한다 (엔드포인트 dedup과 같은 방식).

## 3. 검증 기준

1. t-print 재추출 시 `POD_module.php`가 `backend-raw.json`에 포함되는지 (method `POST`, type `api`)
2. 변수 미해결 케이스가 `(미해결)` 표시로 누락 없이 기록되는지
3. 기존 탐지 회귀 없음 (log1.toup.net 추적 스크립트 등 v5.1.0에서 잡히던 항목이 그대로 잡히는지)
4. 스텁 교체 후 클론 JS 전체 `node --check` 통과
5. `http://localhost:8000/../package.json` 같은 요청이 클론 폴더 밖 파일을 반환하지 않는지 (403 또는 404)
6. 인라인 JS 탐지 항목의 `source`가 페이지 경로로 기록되는지
7. `node --check main.js renderer.js` 통과

## 4. 버전

- v5.1.1로 버전 범프
