# GJC 리버싱 워크벤치 v3.2 작업지시서

## 1. 개요

- **버전:** v3.2
- **목표:** 에셋 다운로드 아키텍처 변경 — "재다운로드" → "로드 중 캡처"
- **대상 파일:** `main.js` (`extract-frontend` 핸들러)

## 2. 배경 — 왜 바꾸는가

### 2.1 지금까지의 경과

| 단계 | 방식 | 결과 |
|------|------|------|
| v2 | Main 프로세스의 Node `fetch`로 에셋 재다운로드 | t-print 28개 전부 403 Forbidden |
| v3.1.6 | offscreen 브라우저 컨텍스트 안의 `fetch`로 변경 (쿠키/UA/Referer 상속) | 여전히 28개 전부 403 |

### 2.2 핵심 통찰

t-print 추출 로그를 보면 모순이 하나 있다:

- `screenshot.png`는 **정상**이다 → 페이지 로드 시 브라우저가 CSS/이미지를 **이미 다 받아왔다**
- 그런데 우리가 **또** 31개를 요청하면 403이 난다

즉, 서버가 클라이언트를 차단하는 게 아니라 **짧은 시간의 대량 재요청(버스트)** 을 막는 것이다. 브라우저는 0.3초 만에 다 받아오는데, 우리가 굳이 두 번째로 31개를 때릴 이유가 없다.

쓰로틀링(요청 사이 1초 대기)으로 우회할 수도 있지만, 31개 × 1초 = 40초다. "별것도 아닌 사이트 하나 긁는데 40초"는 이 도구의 존재 이유를 부정한다.

### 2.3 정석 — SingleFile류의 방식

웹페이지 저장 도구들(SingleFile 등)은 재다운로드를 하지 않는다. **브라우저가 로드하면서 받은 응답 바디를 가로챈다.** 추가 HTTP 요청이 0개이므로 레이트 리미팅에 걸릴 일이 없고, 속도도 페이지 로드 시간 그대로다.

Electron에서는 `webContents.debugger` (Chrome DevTools Protocol)로 이게 가능하다:

- `Network.enable` 후 `Network.responseReceived` / `Network.loadingFinished` 이벤트 수신
- `Network.getResponseBody({ requestId })` 로 브라우저가 실제 수신한 바디 획득

## 3. 변경 설계

### 3.1 현재 흐름 (v3.1.6)

```
1. offscreenWindow 생성
2. loadURL → 3초 대기
3. capturePage (스크린샷)
4. executeJavaScript → pageData { html, assetUrls[], tokens, layout, components }
5. processQueue: assetUrls를 in-page fetch로 하나씩 재다운로드 → 파일 저장  ← 문제 구간
6. manifest.json, index.html 저장 → data 반환
```

### 3.2 변경 후 흐름 (v3.2)

```
1. offscreenWindow 생성
2. 디버거 부착 + Network.enable + 이벤트 핸들러 등록   ← 신규
3. loadURL → 3초 대기 (이 동안 모든 리소스 바디가 자동 캡처됨)
4. capturePage (스크린샷)
5. executeJavaScript → pageData (기존 그대로 — assetUrls의 localPath 매핑에 필요)
6. 캡처된 바디를 assetUrls의 URL과 매칭 → 파일 저장   ← 재다운로드 없음
7. 디버거 detach + window destroy
8. manifest.json, index.html 저장 → data 반환 (기존과 동일한 구조)
```

## 4. 상세 구현 스펙

### 4.1 디버거 부착 (loadURL 이전)

```js
const capturedBodies = new Map();  // url -> Buffer
const reqOriginalUrl = new Map();  // requestId -> 요청 시점 URL
const reqFinalUrl = new Map();     // requestId -> 최종 응답 URL

let debuggerAttached = false;
try {
    // 이전 추출이 비정상 종료됐을 때를 대비해 이미 붙어 있으면 떼고 다시 붙임
    if (offscreenWindow.webContents.debugger.isAttached()) {
        offscreenWindow.webContents.debugger.detach();
    }
    await offscreenWindow.webContents.debugger.attach();
    await offscreenWindow.webContents.debugger.sendCommand('Network.enable');
    debuggerAttached = true;
} catch (e) {
    sendLog('디버거 부착 실패, 폴백 모드로 진행: ' + e.message, 'error');
}

offscreenWindow.webContents.debugger.on('message', async (event, method, params) => {
    try {
        if (method === 'Network.requestWillBeSent') {
            reqOriginalUrl.set(params.requestId, params.request.url);
        } else if (method === 'Network.responseReceived') {
            reqFinalUrl.set(params.requestId, params.response.url);
        } else if (method === 'Network.loadingFinished') {
            const requestId = params.requestId;
            // 원본 URL과 최종 URL(리다이렉트 대응) 양쪽 키로 저장
            const urls = [reqOriginalUrl.get(requestId), reqFinalUrl.get(requestId)].filter(Boolean);
            try {
                const { body, base64Encoded } = await offscreenWindow.webContents.debugger.sendCommand(
                    'Network.getResponseBody', { requestId }
                );
                const buf = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
                for (const u of urls) capturedBodies.set(u, buf);
            } catch (e) {
                // 바디를 못 가져오는 요청(data: URL, 실패 요청, 캐시에서 밀린 것)은 무시
            }
            reqOriginalUrl.delete(requestId);
            reqFinalUrl.delete(requestId);
        }
    } catch (e) { /* 핸들러 내부 에러는 추출을 막지 않음 */ }
});
```

### 4.2 파일 저장 (processQueue 대체)

기존 `processQueue`의 in-page fetch 로직을 아래로 교체한다:

```js
const failedAssets = [];
const assets = [];

for (const item of pageData.assetUrls) {
    try {
        if (item.type === 'inline-css') {
            fs.writeFileSync(path.join(outDir, item.localPath), item.text);
        } else {
            const buf = capturedBodies.get(item.url);
            if (!buf) throw new Error('캡처된 바디 없음');
            fs.writeFileSync(path.join(outDir, item.localPath), buf);
        }
        assets.push(item);
        sendLog(`[캡처 저장] ${item.localPath}`);
    } catch (e) {
        failedAssets.push({ url: item.url, error: e.message });
        sendLog(`[캡처 실패] ${item.url} - ${e.message}`, 'error');
    }
}
```

### 4.3 정리 (finally 성격으로 보장)

추출 성공/실패와 무관하게 반드시 실행:

```js
try {
    if (offscreenWindow.webContents.debugger.isAttached()) {
        offscreenWindow.webContents.debugger.detach();
    }
} catch (e) { /* 무시 */ }
if (offscreenWindow && !offscreenWindow.isDestroyed()) offscreenWindow.destroy();
```

기존 `catch (error)` 블록 안의 destroy 로직과 합쳐서, 어떤 경로로 끝나도 디버거가 붙은 채로 남지 않게 한다.

### 4.4 폴백

`debuggerAttached === false`인 경우(부착 실패)에만 기존 in-page fetch 방식(processQueue)을 사용한다. 코드는 삭제하지 말고 `if/else` 분기로 남겨둔다. 정상 케이스에서는 절대 타지 않는 경로다.

## 5. 유지할 것 / 바꿀 것

**유지:**
- DOM 스냅샷, 토큰 추출, 스크린샷, index.html 생성 로직 (그대로)
- `data` 응답 구조: `{ ...pageData, assets, failedAssets, clonePath }` (renderer가 이 구조에 의존)
- manifest.json, README.md 생성
- [클론 실행] 버튼 및 관련 IPC

**변경:**
- 에셋 다운로드: in-page fetch 재요청 → 디버거 캡처 (추가 HTTP 요청 0개)

**삭제하지 말 것:**
- 기존 processQueue 코드는 폴백용으로 유지 (4.4)

## 6. 완료 기준

- [ ] t-print 추출 시 외부 에셋 28개 중 25개 이상이 403 없이 저장됨
- [ ] 추출 전체 소요 시간 15초 이내 (쓰로틀링안의 40초가 아님)
- [ ] 클론 폴더의 index.html을 브라우저로 열면 이미지가 표시되고 원본과 시각적으로 유사함
- [ ] `node --check main.js` 통과
- [ ] 연속 2회 추출해도 에러 없음 (디버거 detach가 정상 처리됨)
- [ ] 기존 기능 정상 동작: 토큰 추출, 스크린샷, 패턴 저장, 프롬프트 패키지, 백엔드 생성
- [ ] 로그에 `[캡처 저장]` 메시지가 에셋별로 표시됨

## 7. 주의사항

- `Network.getResponseBody`는 리다이렉트 체인, 실패한 요청, `data:` URL에서 에러를 낸다. 반드시 try/catch로 감싸고, 하나가 실패해도 전체 추출이 중단되면 안 된다.
- `loadingFinished` 핸들러는 async다. `getResponseBody` 호출이 늦어져도 바디는 브라우저 내부 버퍼에 남아 있으므로 문제없다. 단, destroy 전에 모든 `getResponseBody`가 끝나길 기다릴 필요는 없다 — 3초 대기가 사실상 그 역할을 한다. 확실하게 하고 싶으면 저장 단계 전에 500ms 정도 추가 대기해도 된다.
- 디버거가 attach된 상태로 남으면 다음 추출의 attach가 실패한다. 4.3의 정리를 반드시 보장할 것.
- 이 작업은 "왜"가 중요한 작업이다. 구현 전에 위 2장(배경)을 읽고, CDP가 뭔지 모르면 먼저 확인할 것. 모르는 채로 짜맞추지 마라.
