# gjc 리버싱 워크벤치 작업지시서 v4.2.4 — 중지 버튼 + 에러 로그 + 전 페이지 실패 진단

## 0. 배경

- v4.2.3에서 t-print 추출 시 87개 페이지 전부가
  `[페이지 실패] ... Script failed to execute`로 실패함.
- 현재 중지 버튼이 없어서 실패가 계속되는 동안 창을 닫을 수밖에 없었음.
- 에러 메시지가 "Script failed to execute" 한 줄뿐이라 원인 파악 불가.
- 참고: v4.1.3 (maxPages 50)에서는 정상 동작했음.
  실패한 URL을 일반 브라우저에서 직접 열면 정상 표시됨 (사이트 차단 아님).

## 1. 목표

1. 링크 수집 / 추출 중 언제든 멈출 수 있는 **[중지] 버튼** 추가.
2. 실패 시 **원인을 알 수 있는 에러 로그 파일**을 출력 폴더에 자동 생성.
3. 전 페이지 실패의 **진짜 원인 확정** (추측이 아닌 로그 기반).

---

## Part A — 중지 버튼

### A.1 UI

- 추출 탭에 `id="btn-stop-operation"` 버튼 추가.
  배치: `[링크 수집]` 버튼 옆 + `[수집된 페이지 추출 시작]` 버튼 옆 (두 곳 중
  보이는 곳에 하나만 두어도 됨. 작업 중일 때만 `display: inline-block`).
- 평상시에는 숨김. `btnCrawl` 또는 `btnExtractMulti` 클릭 시 표시,
  작업 완료/실패/중지 시 숨김.

### A.2 취소 메커니즘 (main.js)

- 모듈 스코프에 취소 플래그 추가:
  `let cancelRequested = false;`
- 새 IPC 핸들러:
  `ipcMain.handle('cancel-operation', () => { cancelRequested = true; return { success: true }; });`
- `crawl-links` 시작 시 `cancelRequested = false`로 리셋.
  while 루프 조건에 `&& !cancelRequested` 추가.
  루프 탈출 후 `cancelRequested`가 true면
  `[사용자에 의해 링크 수집이 중지됨]` 로그 + `{ success: true, cancelled: true, data: results }` 반환.
- `extract-multi` 시작 시 `cancelRequested = false`로 리셋.
  for 루프 각 페이지 시작 부분에 체크 추가:
  ```js
  if (cancelRequested) {
      sendLog('[사용자에 의해 추출이 중지됨]', 'warn');
      break;
  }
  ```
- 중지 후 정리: offscreenWindow가 살아있으면 debugger detach 후 destroy.
  (다음 작업 시작 시 새로 생성되므로 상태 오염 없음)

### A.3 renderer.js

- `btn-stop-operation` 클릭 → `window.api.cancelOperation()` 호출.
  (preload.js에 `cancelOperation: () => ipcRenderer.invoke('cancel-operation')` 추가)
- 중지 후 버튼 숨김 + 로그에 `[중지 요청 전송]` 표시.
- 주의: 진행 중인 `loadURL` 1회는 즉시 끊기지 않고 끝난 뒤 멈춤.
  (v1 스펙. 즉시 중단이 필요하면 다음 버전에서 AbortController 검토)

---

## Part B — 에러 로그 파일

### B.1 페이지 스크립트 내부 에러 포착 (핵심)

현재 "Script failed to execute"만 나와서 원인 불명임.
페이지 스크립트 IIFE 전체를 try/catch로 감싸서 에러를 반환값으로 전달:

```js
const pageData = await offscreenWindow.webContents.executeJavaScript(`
    (() => {
        try {
            return { ok: true, data: (() => {
                ... 기존 IIFE 바디 전체 ...
            })() };
        } catch (err) {
            return { ok: false, error: err.message, stack: err.stack };
        }
    })()
`);
```

- Node 쪽에서:
  ```js
  let pageData = await offscreenWindow.webContents.executeJavaScript(`...`);
  if (pageData && pageData.ok === false) {
      throw new Error('[페이지 스크립트 내부 에러] ' + pageData.error + '\n' + pageData.stack);
  }
  if (pageData && pageData.ok === true) pageData = pageData.data;
  ```
  (기존 `const pageData`를 `let`으로 변경해야 재할당 가능)
- ⚠️ 기존 반환 형태(`{ html, textContent, newAssets, ... }`)를 바꾸면
  이후 코드(`pageData.html`, `pageData.newAssets` 등)가 전부 깨짐.
  `{ ok, data }` 래퍼를 쓰되, Node 쪽에서 `pageData = pageData.data`로
  풀어서 이후 코드를 그대로 쓸 것.

### B.2 실패 정보 수집

catch 블록에서 수집할 정보 (기존 `[페이지 실패]` 로그를 대체/확장):

- `const manifest = {...}` 선언부 옆에 `const failedDetails = [];` 추가.
- catch 블록:
```js
} catch (e) {
    const failInfo = {
        url: currentUrl,
        time: new Date().toISOString(),
        phase: currentPhase, // 'load' | 'script' | 'assets' | 'write' (아래 B.3)
        message: e.message,
        stack: e.stack || '(스택 없음)'
    };
    failedDetails.push(failInfo);
    sendLog(`[페이지 실패] ${currentUrl} - ${e.message}`, 'error');
    manifest.failedPages.push({ url: currentUrl, error: e.message });
}
```

### B.3 단계(phase) 추적

try 블록 안에 단계 변수를 두고, 각 구간 진입 시 갱신:

```js
let currentPhase = 'load';
const loadPromise = offscreenWindow.loadURL(...);
await loadPromise;
currentPhase = 'script';
const pageData = await ...executeJavaScript(...);
currentPhase = 'assets';
... 에셋 처리 ...
currentPhase = 'write';
... 파일 쓰기 ...
```

- 이렇게 하면 "어느 단계에서 죽는지"가 로그에 남음.

### B.4 로그 파일 출력

- 추출 종료 시 (정상/중지/실패 무관) `failedDetails`가 비어있지 않으면
  출력 폴더에 파일 생성:
  `error-log-YYYYMMDD-HHmmss.txt`
- 작성 위치: for 루프 종료 후, `urlmap.json`/`manifest.json` 저장 부분 근처.
  (manifest 저장 후에 써도 됨. 단, 중지로 break된 경우에도 실행되도록
  루프 바깥에 둘 것)
- 파일 형식:
  ```
  # GJC 리버싱 워크벤치 에러 로그
  # 생성: 2026-10-10T05:31:11.000Z
  # 대상: https://www.t-print.co.kr/
  # 수집: 87개 / 성공: 0개 / 실패: 87개 / 중지됨: 아니오
  #
  ============================================================
  [1] https://www.t-print.co.kr/
      단계: script
      시간: 2026-10-10T05:31:11.000Z
      메시지: ...
      스택:
      ...
  ```
- 로그 파일 경로를 시스템 로그에도 출력:
  `[에러 로그 저장됨] D:\...\error-log-....txt`

---

## Part C — 전 페이지 실패 진단

B의 로그가 나오면 아래 순서로 원인을 확정할 것:

### C.1 페이지 스크립트 내부 에러인 경우

- 스택을 보고 해당 줄 수정. 수정 후 t-print 5페이지로 재테스트.

### C.2 `phase: script`인데 내부 에러가 없는 경우 (인프라 문제)

아래를 순서대로 테스트:

1. `executeJavaScript` 호출 직전에 `debugger.detach()` 후 실행.
   성공하면 원인 확정: 디버거 부착 상태의 CDP `Runtime.evaluate`와
   `Network.getResponseBody` 폭주의 경합.
   → 정식 수정: 에셋 캡처가 끝난 뒤 detach하고 스크립트 실행,
   또는 `debugger.sendCommand('Runtime.evaluate')`로 직접 실행.
2. `capturePage()` 호출을 debugger detach 이후로 이동.
   (디버거 부착 중 capturePage는 실패하기로 유명함)

### C.3 버전 bisect

- v4.2.3에서 maxPages를 50으로 낮춰서 테스트.
  1페이지부터 실패하면 버전 문제 확정 (페이지 수 무관).
  50개는 되고 87개에서만 실패하면 urlMap 크기 등 규모 문제.

### C.4 재발 방지

- `node -c main.js && node -c renderer.js` 파이프라인 유지 (v4.2.2에서 도입됨).
- 앞으로 extract-multi 페이지 스크립트를 바꾸면, t-print 3페이지로
  스모크 테스트 후 푸시할 것.

---

## 2. 완료 기준

- [ ] 링크 수집 중 [중지] 버튼이 보이고, 누르면 수집이 멈추고 지금까지
      모은 URL이 유지됨.
- [ ] 추출 중 [중지] 버튼이 보이고, 누르면 현재 페이지 이후 멈춤.
- [ ] 페이지 실패 시 `error-log-*.txt`가 출력 폴더에 생성되고,
      단계·메시지·스택이 기록됨.
- [ ] t-print 추출 시 첫 페이지의 진짜 에러 (메시지+스택)가 로그 파일에
      남음. (원인 확정까지가 이번 지시서의 목표. 수정은 다음 지시서)
- [ ] `node -c` 파이프라인 통과 후 푸시.

## 3. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- B.1의 `{ ok, data }` 래퍼 도입 시: `const pageData`를 `let`으로 바꾸고
  unwrap(`pageData = pageData.data`)한 뒤 기존 `pageData.xxx` 참조를
  그대로 쓸 것. unwrap을 빼먹으면 전부가 `undefined`가 됨.
- 중지 버튼이 "다음 작업 시작을 막는" 좀비 상태가 되지 않도록,
  작업 종료 시마다 플래그와 버튼 표시를 초기화할 것.
