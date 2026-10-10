# gjc 리버싱 워크벤치 작업지시서 v4.3.2 — Dead Link 처리 + 보관함 경로 버그 수정

## 0. 배경

- `bullet.png`처럼 원본 서버에도 없는 dead link가 있음.
  직접 확인 결과 서버에서 404 반환 (슬롭 주소).
- **긴급 버그**: 보관함 경로 입력란이 비어있으면 `libraryPath`가 빈 문자열로 넘어가
  `path.join('', cName)`이 상대경로가 됨. 그 결과:
  - "클론 실행" → Windows가 `www_t-print_co_kr\index.html`을 URL로 오인 →
    `http://www_t-print_co_kr/index.html` 열림.
  - "출력 폴더 열기" → `shell.showItemInFolder`가 상대경로를 못 찾아 무응답.
- 현재 동작의 문제점 (dead link):
  1. 같은 URL이 페이지마다 `[에셋 실패]`로 로그 도배됨 (20회 이상).
  2. 죽은 링크인지 일시적 실패인지 구분이 안 됨.
  3. 죽은 이미지는 깨진 아이콘으로 남거나 불필요한 네트워크 시도를 유발.

## 1. 목표

1. 보관함 경로가 비어있을 때 기본값으로 폴백 (긴급).
2. 실패 로그 중복 제거 (고유 URL당 1회).
3. Dead link 판정 (404/403/410).
4. Dead 이미지는 투명 플레이스홀더로 교체 (깨진 아이콘 제거).
5. `dead-links.txt` 리포트 생성.

---

## Part A — 실패 로그 중복 제거

### A.1

`extract-multi`에 추가:

```js
const loggedFailures = new Set();
// ...
// [에셋 실패] 로그 출력 전에:
if (!loggedFailures.has(item.url)) {
    loggedFailures.add(item.url);
    sendLog(`[에셋 실패] ${item.url} - ${e.message}`, 'error');
}
```

- CSS inner url 실패 로그에도 동일하게 적용.
- `[폴백 다운로드 성공]`은 중복 제거하지 않음 (성공은 매번 의미 있음).

### A.2 종료 요약

추출 마무리 시 (urlmap.json 저장 근처):

```js
if (loggedFailures.size > 0) {
    sendLog(`[에셋 실패 요약] 고유 ${loggedFailures.size}개 URL 실패`, 'warn');
}
```

---

## Part B — Dead 판정

### B.1 상태 코드 확보

현재 폴백 fetch는 `if(!r.ok)throw` 로 상태 코드를 버림.
상태 코드를 살리도록 수정:

```js
expression: `(async()=>{
    try {
        const r = await fetch("${u}");
        if (!r.ok) return { ok: false, status: r.status };
        const b = await r.blob();
        // ... base64 변환 ...
        return { ok: true, status: 200, b64: ... };
    } catch(e) {
        return { ok: false, status: 0 };  // 네트워크 에러/타임아웃
    }
})()`,
```

### B.2 판정 규칙

| 조건 | 판정 | assetMap status |
|---|---|---|
| CDP 캡처 성공 | alive | `ok` |
| 폴백 fetch 성공 (status 200) | alive | `ok` |
| 폴백 fetch status 404/403/410 | dead | `dead` |
| 폴백 fetch 네트워크 에러 (status 0) / 타임아웃 | unreachable | `unreachable` |

- `unreachable`는 나중에 복구 가능하므로 원본 URL 유지 (기존 동작).
- `dead`는 아래 Part C에서 처리.

### B.3 assetMap 확장

```json
{
  "assets/img-117.png": {
    "url": "https://www.t-print.co.kr/html/img/sub/bullet.png",
    "status": "dead"
  }
}
```

- 기존 `ok` / `failed` 에 `dead`, `unreachable` 추가.
- 기존 `failed`는 `unreachable`로 재분류해도 되고, 그대로 둬도 됨.
  (단, 판정 로직은 새로 적용할 것)

---

## Part C — Dead 처리

### C.1 `<img>` 태그 → 투명 플레이스홀더

- dead로 판정된 이미지 에셋:
  - v4.2.6 롤백과 같은 방식으로 HTML에서 로컬 경로를 찾아서,
    원본 URL이 아니라 플레이스홀더로 교체:
    ```js
    const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    pageData.html = pageData.html.split(brokenUrl).join(PLACEHOLDER);
    ```
  - 이유: 레이아웃 유지 + 깨진 아이콘 없음 + 네트워크 시도 없음.
  - 태그 자체를 삭제하지 않음 (레이아웃 붕괴 방지).

### C.2 CSS `url()` → 원본 유지

- v4.2.6에서 이미 "저장 성공 시에만 재작성"하므로 dead는 원본 URL 그대로 남음.
- CSS 선언문을 뜯어내는 것은 위험하므로 추가 처리하지 않음.

### C.3 `dead-links.txt` 리포트

- 출력 폴더에 생성:
  ```
  # Dead Links (원본 서버에 존재하지 않음)
  # 생성: 2026-10-10T...
  #
  https://www.t-print.co.kr/html/img/sub/bullet.png (404)
  ```
- 상태 코드도 함께 기록.

---

## Part D — 복구(Repair) 연동

- `repair-clone`에서 `status === 'dead'`인 항목은 스킵.
  - 로그: `[복구 스킵] assets/img-117.png (dead link)`
  - 카드 UI에는 "복구 불가" 로 표시 (추후).
- `failed` / `unreachable`만 복구 시도.
- 복구 성공 시 assetMap 상태를 `ok`로 갱신 (기존 동작 유지).

---

## Part E — 보관함 경로 폴백 (긴급 버그 수정)

### E.1 원인

- `renderer.js`가 `libraryPath: document.getElementById('inp-library-path').value`로 전달.
- 입력란이 비어있으면 빈 문자열 → main.js에서:
  ```js
  const outDir = path.join('', 'www_t-print_co_kr');
  // → 'www_t-print_co_kr' (상대경로!)
  ```
- main 프로세스에는 기본값이 있음
  (`let cloneLibraryPath = path.join(os.homedir(), 'Documents', 'GJC-Clones')`)
  그런데 `extract-multi`가 config 값을 그대로 써서 기본값이 무용지물.

### E.2 수정

`extract-multi`의 config 분해 부분 (약 1060줄):

```js
// 변경 전:
const { urls, libraryPath, cloneName, paramBlacklist } = config;

// 변경 후:
const { urls, cloneName, paramBlacklist } = config;
let libraryPath = config.libraryPath;
if (!libraryPath || !libraryPath.trim()) {
    libraryPath = cloneLibraryPath;
}
libraryPath = path.resolve(libraryPath);
```

- `extract-frontend`도 동일한 패턴이면 같이 수정.
- `path.resolve()`로 절대경로 보장 (상대경로 입력 대비).

### E.3 검증

- 입력란 비운 채로 추출 → `<기본보관함>/<이름>/` 에 저장됨.
- "클론 실행" → 로컬 `index.html`이 브라우저에서 `file://`로 열림.
- "출력 폴더 열기" → 탐색기가 해당 폴더를 보여줌.

---

## 2. 완료 기준

- [ ] 보관함 경로 입력란이 비어있어도 추출이 정상 동작하고,
      "클론 실행"/"출력 폴더 열기"가 동작함.
- [ ] 같은 URL의 `[에셋 실패]` 로그가 1회만 출력됨.
- [ ] 추출 종료 시 `[에셋 실패 요약]`이 출력됨.
- [ ] 404 URL이 `dead`로 판정되어 assetMap에 기록됨.
- [ ] dead 이미지의 `<img src>`가 플레이스홀더 data URI로 교체됨.
      (깨진 로컬 경로도, 원본 URL도 아닌 플레이스홀더)
- [ ] `dead-links.txt`가 출력 폴더에 생성됨.
- [ ] repair-clone이 `dead` 항목을 스킵함.
- [ ] `node -c` 파이프라인 통과 후 푸시.

## 3. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- 플레이스홀더 data URI는 상수로 정의 (매번 하드코딩 금지).
- `status === 0` (네트워크 에러)은 `dead`가 아님.
  섣불리 dead로 찍으면 나중에 복구할 기회를 날림.
- 템플릿 리터럴 안의 정규식은 이중 백슬래시 유지.
- **E.2 수정 시 `cloneLibraryPath` 변수가 extract-multi 스코프에서
  접근 가능한지 확인할 것.** (모듈 스코프 변수이므로 접근 가능해야 함)
