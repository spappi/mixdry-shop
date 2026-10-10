# gjc 리버싱 워크벤치 작업지시서 v4.3 — 클로너 탭 (보관함 + 불러오기 + 복구)

## 0. 개요

추출은 일회성이 아니라 연속 작업이다. 지금까지는 추출할 때마다 폴더를 따로 정하고,
누락이 생기면 전체를 다시 긁어야 했다. v4.3은 추출 결과물을 **관리되는 프로젝트**로 만든다.

- **클로너 탭**: 프론트 추출과 백엔드 생성 사이에 신설. 보관함의 클론들을
  유튜브 썸네일처럼 카드로 보여줌.
- **불러오기/이어하기**: 카드를 클릭하면 그 클론이 현재 작업 프로젝트가 되어
  프론트 추출 탭에서 작업을 이어갈 수 있음.
- **복구**: 카드별 [복구] 버튼. 실패/누락된 에셋만 골라서 다시 다운로드.
  전체를 다시 긁지 않음.

## 1. 전체 흐름

```
프론트 추출 → (추출 완료, 보관함에 자동 저장)
                ↓
클로너 탭 → 카드 목록 → [이어하기] → 프론트 추출 탭에서 계속 작업
                    → [복구] → 누락 에셋만 재다운로드
                    → [삭제] / [폴더 열기]
                ↓
백엔드 생성 (활성 프로젝트 기준, 추후 연동)
```

---

## Part A — assetMap.json (추출 시 저장)

복구의 전제 조건. 현재는 성공한 에셋만 `manifest.assets`에 남고,
실패한 것은 에러 로그에만 있어서 나중에 매칭이 불가능함.

### A.1 형식

추출 출력 폴더에 `assetMap.json` 저장:

```json
{
  "assets/img-1.png": {
    "url": "https://www.t-print.co.kr/html/img/logo.png",
    "status": "ok"
  },
  "assets/img-117.png": {
    "url": "https://www.t-print.co.kr/html/img/sub/bullet.png",
    "status": "failed",
    "error": "[에셋 바디 없음]"
  },
  "css/style-1.css": {
    "url": "https://www.t-print.co.kr/html/css/main.css",
    "status": "ok"
  }
}
```

- 키: 로컬 경로 (출력 폴더 기준 상대경로)
- `url`: 원본 URL (복구에 사용)
- `status`: `ok` | `failed`
- `error`: 실패 시 에러 메시지 (선택)

### A.2 기록 시점

`extract-multi`의 에셋 저장 루프에서:

- 파일 저장 성공 직후 → `{ url: item.url, status: 'ok' }` 기록.
  (v4.2.6에서 `manifest.assets.push` 하는 그 자리)
- 저장 실패 시 (바디 없음, fetch 폴백 실패, 예외) →
  `{ url: item.url, status: 'failed', error: e.message }` 기록.
- CSS inner url (`lp = 'assets/img-N...'`)도 동일하게 기록.
  현재 inner url은 `manifest.assets`에만 push되므로, assetMap에도 추가할 것.
- `globalImgMap`에 이미 있어서 스킵된 경우:
  이미 `ok`로 기록되어 있으므로 다시 쓰지 않음.

### A.3 저장 위치와 시점

- `manifest.json`, `urlmap.json` 저장하는 곳 바로 옆에
  `assetMap.json` 저장.
- `extract-frontend` (단일 추출)도 동일하게 적용.
  (로직이 다르면 multi를 우선, single은 시간이 되면)

---

## Part B — 보관함 규칙 + 설정

### B.1 보관함 경로 설정

- 설정 모달(⚙)에 **"클론 보관함"** 경로 입력 추가.
- 기본값: `path.join(os.homedir(), 'Documents', 'GJC-Clones')`
  (Windows: `C:\Users\<이름>\Documents\GJC-Clones`)
- 기존 설정 저장 방식 그대로 사용 (localStorage 또는 설정 파일).
- 설정에서 경로를 바꾸면 클로너 탭이 새 경로를 스캔.

### B.2 추출 출력 폴더 규칙

**핵심 원칙: 이름 = 프로젝트 identity. 타임스탬프마다 폴더가 쌓이지 않음.**

- 추출 탭에 **"클론 이름"** 입력란 추가 (URL 입력란 근처).
  - 기본값: URL 입력 시 도메인에서 자동 생성 (예: `www.t-print.co.kr`).
  - 사용자가 직접 수정 가능 (예: `t-print-리뉴얼전`, `t-print-가을프로모션`).
  - 같은 URL이라도 디자인 변경 시점에 이름을 다르게 주면 버전별 관리 가능.
- `extract-multi` / `extract-frontend` 실행 시:
  - 출력 폴더는 `<보관함>/<이름>/` 로 생성.
    예: `GJC-Clones/t-print-리뉴얼전/`
  - **같은 이름으로 다시 추출하면 덮어쓰기.**
    단, 덮어쓰기 전에 기존 폴더를 `<이름>-backup-<YYYYMMDD-HHmmss>/` 로
    자동 백업. 백업은 최대 3개 유지, 초과분은 가장 오래된 것부터 삭제.
  - 이름이 비어있으면 도메인을 사용.
  - 파일명으로 쓸 수 없는 문자(`:`, `/`, `\`, `?`, `*` 등)는 제거/치환.
  - 이름이 50자를 넘으면 잘라냄.
- 기존처럼 사용자가 출력 폴더를 직접 지정한 경우도 허용.
  (이 경우 클로너 탭의 [폴더 가져오기]로 보관함에 등록 가능)
- `manifest.json`에 `name` 필드 추가:
  ```json
  { "name": "t-print-리뉴얼전", "targetUrl": "...", "extractedAt": "...", ... }
  ```
- 타임스탬프는 폴더명이 아니라 메타데이터로만 사용:
  `manifest.extractedAt` → 카드에 "마지막 추출" 날짜로 표시.

### B.3 보관함 폴더 구조 (1개 클론)

```
www.t-print.co.kr-20261010-163000/
├── index.html
├── pages/
├── assets/
├── css/
├── screenshot.png      # 카드 썸네일
├── manifest.json       # targetUrl, extractedAt, pages, assets
├── urlmap.json
├── assetMap.json       # v4.3부터
└── error-log-*.txt     # 실패가 있었으면
```

---

## Part C — 클로너 탭 UI

### C.1 탭 배치

- `index.html`의 탭 버튼 영역:
  ```html
  <button class="tab-btn" data-target="tab-extract">프론트 추출</button>
  <button class="tab-btn" data-target="tab-clones">클로너</button>   <!-- 신설 -->
  <button class="tab-btn" data-target="tab-scaffold">백엔드 생성</button>
  ...
  ```
- `id="tab-clones"` 콘텐츠 영역 신설.
- 기존 탭 전환 로직(`data-target`) 그대로 따르면 됨.

### C.2 탭 헤더

- 제목: "클로너 보관함"
- 버튼들:
  - [보관함 폴더 열기] → `shell.openPath(cloneLibraryPath)`
  - [새로고침] → 카드 목록 다시 스캔
  - [폴더 가져오기] → 폴더 선택 다이얼로그 →
    `manifest.json`이 있으면 보관함으로 복사 (아래 C.5)

### C.3 카드 목록

- CSS grid로 카드 나열 (반응형: 최소 220px 너비).
- 카드 1개의 구성:
  ```
  ┌─────────────────────┐
  │                     │
  │   screenshot.png    │  ← 없으면 회색 플레이스홀더
  │                     │
  ├─────────────────────┤
  │ t-print-리뉴얼전    │  ← manifest.name (사용자 지정 이름, 없으면 도메인)
  │ www.t-print.co.kr   │  ← manifest.targetUrl의 호스트
  │ 2026-10-10 16:30    │  ← manifest.extractedAt
  │ 77페이지 · 436에셋  │
  │ [● 정상] 또는 [● 누락 5건]  ← 상태 배지
  ├─────────────────────┤
  │ [이어하기] [복구]   │
  │ [폴더 열기] [삭제]  │
  └─────────────────────┘
  ```
- 상태 배지 규칙:
  - `assetMap.json`의 `failed` 수 + 디스크에 실제로 없는 파일 수를 합산.
  - 0건이면 초록색 "정상", 1건 이상이면 주황색 "누락 N건".
  - `assetMap.json`이 없는 구 클론은 회색 "복구 정보 없음".
- 빈 상태: "아직 클론이 없습니다.<br>프론트 추출 탭에서 사이트를 추출해보세요."

### C.4 카드 스캔 로직 (main.js)

- `ipcMain.handle('list-clones', ...)`:
  1. `cloneLibraryPath`의 하위 폴더 목록 읽기.
  2. 각 폴더에 `manifest.json`이 있으면 카드 1개.
     **단, `-backup-`으로 끝나는 폴더(백업)는 카드 목록에서 제외.**
     (백업은 [폴더 열기]로 직접 접근 가능. 카드로 보여주면 clutter)
  3. 반환 데이터:
     ```js
     {
       dir: '<절대경로>',
       name: 't-print-리뉴얼전',        // manifest.name, 없으면 domain으로 폴백
       domain: 'www.t-print.co.kr',       // manifest.targetUrl에서 추출
       extractedAt: '2026-10-10T...',      // manifest.extractedAt
       pages: 77,                          // manifest.pages.length
       assets: 436,                        // manifest.assets.length
       failed: 5,                          // assetMap에서 status==='failed' 수
       missing: 3,                         // 디스크에 없는 로컬 파일 수 (아래)
       hasScreenshot: true,
       hasAssetMap: true
     }
     ```
  4. `missing` 계산: assetMap의 `status==='ok'`인 항목 중
     디스크에 파일이 없는 것의 수. (사용자가 파일을 지웠을 경우 대비)
  5. 정렬: `extractedAt` 내림차순 (최신이 먼저).

### C.5 폴더 가져오기

- `ipcMain.handle('import-clone', ...)`:
  - `dialog.showOpenDialog({ properties: ['openDirectory'] })`
  - 선택된 폴더에 `manifest.json`이 없으면 에러 반환
    ("클론 출력 폴더가 아닙니다").
  - `<보관함>/<이름>/` 으로 복사. (`<이름>`은 manifest.name, 없으면 도메인)
  - 같은 이름이 이미 있으면 B.2의 백업 규칙 적용 후 덮어쓰기.
  - (복사 후 원본은 그대로 둠. 이동이 아니라 복사.)

### C.6 삭제

- `ipcMain.handle('delete-clone', ...)`:
  - renderer에서 `confirm()`으로 1차 확인.
  - `shell.trashItem(dir)` 로 휴지통으로 이동 (영구 삭제 금지).
  - 성공하면 카드 목록 새로고침.

---

## Part D — 불러오기 / 이어하기 (활성 프로젝트)

### D.1 개념

- **활성 프로젝트**: 현재 작업 중인 클론 1개.
- renderer의 변수 `activeClone = { dir, manifest, urlmap }` 로 유지.
  localStorage에 `activeCloneDir` 저장해서 재시작해도 유지 (선택).

### D.2 [이어하기] 동작

1. `ipcMain.handle('load-clone', ...)`:
   - `{ dir }`을 받아서 `manifest.json`, `urlmap.json`, `assetMap.json` 읽기.
   - `{ manifest, urlmap, assetMap }` 반환.
2. renderer:
   - `activeClone` 설정.
   - 프론트 추출 탭으로 전환 (`tab-extract` 활성화).
   - 추출 탭 상단에 활성 프로젝트 표시줄:
     ```
     현재 작업 중: t-print-리뉴얼전 (www.t-print.co.kr, 2026-10-10 16:30) · 77페이지 [해제]
     ```
     (manifest.name이 있으면 이름 우선 표시, 없으면 도메인만)
   - URL 입력란에 `manifest.targetUrl` 채우기 (재추출 시 편의).
   - 출력 폴더 입력란에 `activeClone.dir` 채우기.

### D.3 [해제]

- 활성 프로젝트 표시줄의 [해제] 버튼 → `activeClone = null`.

---

## Part E — 복구 (Repair)

### E.1 위치와 진입

- 클론 카드의 **[복구]** 버튼. (링크 추출 옆에 두지 않음 —
  "수집"과 "복구"가 헷갈리면 안 되므로 카드 문맥 안에 둠.)
- 클릭하면 확인 없이 바로 시작해도 됨 (읽기 위주 + 실패한 것만 받으므로 안전).
  진행 상황은 로그 패널에 표시.

### E.2 복구 로직 (`ipcMain.handle('repair-clone', ...)`)

입력: `{ dir }` (클론 폴더 절대경로)

```
1. assetMap.json 로드. 없으면:
   → { success: false, message: 'assetMap.json이 없습니다. v4.3 이후 추출본만 복구 가능합니다.' }
   → 단, manifest.assets가 있으면 "부분 스캔" 제안 (아래 E.4)

2. failed 항목 + 디스크에 없는 ok 항목을 수집 → repairList

3. repairList가 비어있으면:
   → { success: true, repaired: 0, message: '복구할 항목이 없습니다.' }

4. 각 항목에 대해 (순차 또는 동시성 5):
   a. Node의 fetch (또는 https)로 entry.url 다운로드.
      헤더: User-Agent(브라우저), Referer(도메인). WAF 우회용.
   b. 성공 → <dir>/<localPath>에 저장 → assetMap status를 'ok'로 변경.
   c. 실패 → status 'failed' 유지, error 갱신.
   d. 로그: `[복구 성공] assets/img-117.png` / `[복구 실패] ...`

5. assetMap.json 다시 저장.

6. 반환:
   { success: true, repaired: N, stillFailed: [...], total: M }
```

### E.3 주의사항

- **브라우저를 띄우지 않음.** 순수 Node HTTP 다운로드.
  (CDP 캡처가 필요 없는 단순 재시도이므로)
- 기존 파일을 덮어씀. (실패했던 것이므로 덮어써도 안전)
- 타임아웃 30초, 재시도 1회.
- `error-log`에는 남기지 않고 시스템 로그에만 표시.
  (복구는 추출이 아니라 유지보수 작업이므로)

### E.4 구 클론 (assetMap.json 없음) 대응

- `manifest.assets` (성공 목록, 로컬 경로들)는 있음.
- "부분 스캔" 모드:
  1. 모든 HTML/CSS에서 로컬 참조(`./assets/`, `../assets/`, `./css/`, `../css/`) 추출.
  2. 디스크에 없는 것들을 broken 리스트로 보고.
  3. 원본 URL을 알 수 없으므로 자동 복구는 불가.
     → "v4.3으로 재추출하거나, 수동으로 파일을 넣어주세요" 안내.
- 이 모드는 "진단"이지 "복구"가 아님을 UI에 명시.

---

## Part F — IPC 목록 (정리)

| 채널 | 방향 | 설명 |
|---|---|---|
| `list-clones` | renderer → main | 보관함 스캔, 카드 데이터 반환 |
| `load-clone` | renderer → main | `{ dir }` → manifest/urlmap/assetMap 반환 |
| `repair-clone` | renderer → main | `{ dir }` → 복구 실행, 결과 반환 |
| `delete-clone` | renderer → main | `{ dir }` → 휴지통으로 이동 |
| `import-clone` | renderer → main | 폴더 선택 → 보관함으로 복사 |
| `open-clone-folder` | renderer → main | `{ dir }` → 탐색기로 열기 |
| `get-library-path` | renderer → main | 현재 보관함 경로 반환 |
| `set-library-path` | renderer → main | `{ path }` → 보관함 경로 변경 |

- preload.js에 전부 노출.
- 기존 `open-folder` 핸들러가 있으면 재사용하고, 없으면 신설.

---

## Part G — 설정 모달 변경

- ⚙ 설정 모달에 **"클론 보관함"** 항목 추가:
  - 텍스트 입력 + [찾아보기] 버튼.
  - 기본값: `~/Documents/GJC-Clones`.
  - 저장 시 폴더가 없으면 자동 생성.
- 기존 설정 저장 방식과 동일하게.

---

## 2. 완료 기준

- [ ] 추출 완료 시 `assetMap.json`이 출력 폴더에 생성됨.
      (성공/실패 항목이 정확히 기록되는지 1개 클론으로 확인)
- [ ] 추출 탭에 "클론 이름" 입력란이 있고, URL 입력 시 도메인으로 자동 채워짐.
      추출 후 폴더명이 `<보관함>/<이름>/` 형식으로 생성됨.
- [ ] 같은 이름으로 재추출 시 기존 폴더가 `<이름>-backup-<타임스탬프>/`로
      백업되고 (최대 3개), 새 내용으로 덮어써짐.
- [ ] 클로너 탭 카드 제목에 사용자 지정 이름이 표시됨.
- [ ] [이어하기] 클릭 시 프론트 추출 탭으로 전환되고
      활성 프로젝트 표시줄 + URL/출력폴더가 채워짐.
- [ ] [복구] 클릭 시 실패한 에셋만 다시 받아지고
      assetMap의 상태가 `ok`로 갱신됨.
      (테스트: 에셋 파일 1개를 일부러 지우고 복구 실행)
- [ ] [삭제]가 휴지통으로 이동함 (영구 삭제 아님).
- [ ] assetMap 없는 구 클론은 "복구 정보 없음"으로 표시되고
      복구 버튼 클릭 시 안내 메시지가 나옴.
- [ ] `node -c` 파이프라인 통과 후 푸시.

## 3. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- 템플릿 리터럴 안의 정규식은 이중 백슬래시 유지 (v4.2.4 교훈).
- 정규화 로직은 크롤러/페이지 스크립트 두 곳 — 이번에 손대지 않음.
- 삭제는 반드시 `shell.trashItem` (영구 삭제 금지).
- 복구는 브라우저 없이 Node HTTP로만. (Electron 창 띄우지 말 것)
- 카드의 `missing` 계산은 스캔 시점의 디스크 상태 기준.
  복구 후에는 카드 목록을 새로고침해서 배지 갱신할 것.
