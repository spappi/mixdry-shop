# gjc 리버싱 워크벤치 작업지시서 v2

## 1. 목표

1. **추출 엔진 v2**: v1.1의 표면 스캔(토큰 요약)을 실제 클로닝이 가능한 수준의 추출로 재구현.
2. **클론 생성**: 추출 결과를 독립 실행 가능한 정적 사이트 프로젝트로 조립.
3. **실행파일 빌드**: `npm start`가 아니라 electron-builder로 설치파일 + win-unpacked를 빌드.
   (gjc-epub-translator와 동일한 배포 형태)

## 2. 배경

- v1.1 추출은 "무슨 색/폰트를 쓰나" 수준의 요약만 반환. 클로닝(로컬 재현)에 필요한 DOM/CSS/에셋을
  수집하지 않음.
- t-print 같은 구형 사이트(jQuery 1.x 시대, table/div 마크업, 비시맨틱 태그)에서는 시맨틱 태그 기반
  분석이 무력함. 구형 마크업 대응이 필수.

## 3. 추출 엔진 v2 스펙

### 3.1 파이프라인 (offscreen BrowserWindow + main process 협업)

**Phase 1 — 페이지 로드**
- `loadURL` 후 `did-finish-load` + 네트워크 idle(2초 무요청)까지 대기.
  구형 사이트는 리소스 로딩이 느리므로 타임아웃 30초.

**Phase 2 — DOM 스냅샷**
- `document.documentElement.outerHTML` 취득.
- 정제: `<script>` 태그 전부 제거 (추적/광고 스크립트: wcslog, mirae_log 등),
  HTML 주석 제거, `on*` 인라인 이벤트 핸들러 제거.
- 인코딩: EUC-KR 등 비 UTF-8 페이지 대응 (meta charset 확인 → TextDecoder로 변환).
  출력 HTML은 UTF-8로 통일.

**Phase 3 — CSS 수집**
- `<link rel="stylesheet">`의 href 전부 → main process에서 fetch → 로컬 `css/`에 저장
  (`style-0.css`, `style-1.css`...).
- `<style>` 인라인 블록 → 별도 파일로 분리 저장.
- CSS 내 `@import`는 재귀적으로 따라가서 수집 (최대 깊이 3).

**Phase 4 — 에셋 다운로드**
- 대상: `<img src>`/`srcset`, CSS 내 `url(...)` (background-image, @font-face), 파비콘.
- main process에서 순차 다운로드 (동시 5개 이하 — 원본 서버 부하 방지).
- 로컬 `assets/`에 저장, 파일명 중복 제거 (`img-0.png`...).
- 다운로드 실패 시 로그에 기록하고 계속 진행 (전체 중단 금지).

**Phase 5 — URL 재작성**
- HTML 내 상대경로 → 로컬 상대경로로 매핑.
- CSS 내 `url()` → 로컬 `assets/` 경로로 매핑.
- 외부 추적/광고 도메인 URL → 제거.

**Phase 6 — 클론 프로젝트 조립 (출력)**
- 출력 폴더 구조:
  ```
  clone_<도메인>_<YYYYMMDD-HHmm>/
    index.html        (정제+URL 재작성된 DOM)
    css/
      style-0.css ...
    assets/
      img-0.png ...
    manifest.json     (원본 URL, 추출 시각, 리소스 목록, 실패 목록)
    README.md         (열람 방법)
  ```
- `index.html`을 브라우저로 열면 원본과 시각적으로 유사하게 렌더링될 것.

**Phase 7 — 진행 로그**
- 각 Phase 진입/완료 시 로그 패널에 표시 ("CSS 수집 중... (3/12)" 등).
- 실패한 리소스는 manifest.json + 로그에 기록.

### 3.2 구형 마크업 대응 (필수)
- 시맨틱 태그(`header`/`nav`/`main`...) 의존 금지.
- 레이아웃 요약은 `getBoundingClientRect()` 기반 주요 시각 블록(상단/본문/하단 영역)으로 탐지.
- v1.1의 토큰 요약(색상 빈도순 등)은 유지하되, `spacing` 더미값(`['8px','16px','24px']`)을
  실제 추출로 교체 (주요 margin/padding 값 빈도 분석).

### 3.3 UI 변경
- [프론트 추출] 탭: [추출 시작] → 전체 파이프라인 실행 → 완료 시 출력 폴더 경로 표시 +
  [폴더 열기] 버튼.
- 결과 패널: 요약(리소스 수, 성공/실패) + `<details>` 상세 유지.

## 4. 실행파일 빌드 (electron-builder)

- electron-builder 도입 (`npm install --save-dev electron-builder`).
- package.json에 build 설정:
  - appId, productName: "GJC 리버싱 워크벤치"
  - win 타겟: `nsis` (설치파일) + `dir` (win-unpacked — 압축 풀자마자 바로 실행 가능)
  - `npm run dist` 스크립트 추가 → `dist/` 출력
- 한글 파일명/경로 주의. asar 패키징 시 `better-sqlite3` 네이티브 모듈이 포함되도록 설정
  (필요시 `asarUnpack` 또는 rebuild 대응).
- v1.1에서 발견된 사소한 문제도 함께 수정:
  - 줌 슬라이더 변경 시 즉시 localStorage에 저장 (ESC로 닫아도 유지)
  - `GET /api/orders/:id` (주문 조회) 엔드포인트 복원
  - 스캐폴드 색상 매칭의 `rgb()` vs `#ffffff` 비교 버그 수정

## 5. 완료 기준 (자체 검증 후 보고)

- [ ] t-print급 구형 사이트 추출 시 `index.html`+`css/`+`assets/` 출력됨.
- [ ] 출력 `index.html`을 브라우저로 열면 원본과 시각적으로 유사함.
- [ ] 다운로드 실패 리소스가 manifest.json에 기록되고 전체가 중단되지 않음.
- [ ] `spacing` 토큰이 실제 값으로 추출됨 (더미 제거).
- [ ] `npm run dist` 성공 → `dist/`에 설치파일 + `win-unpacked/` 생성.
- [ ] `win-unpacked/` 안의 exe를 더블클릭하면 바로 실행됨 (설치 불필요).
- [ ] 설치파일로 설치 후에도 정상 실행됨.
- [ ] v1.1 사소한 문제 3건 (줌 저장 타이밍, 주문 조회 API, 색상 매칭) 수정됨.

## 6. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- 추출 시 원본 서버에 과도한 부하 금지 (동시 다운로드 5개 이하, 타임아웃 설정).
- 완료 보고 전 체크리스트를 직접 실행해서 확인한 뒤 보고할 것.
