# 리버싱 워크벤치 v5.1 작업지시서 — 백엔드 호출 탐지 고도화

## 1. 배경

v5.0의 백엔드 탐지는 메인 페이지의 JS만 분석해서 `backend-raw.json`을 생성함.
t-print 실측 결과, 진짜 백엔드 API(`POST /ORDER_POD/POD_module.php`)는 상품 상세 페이지의 인라인 스크립트에 있어서 탐지되지 않음.
잡힌 것은 `log1.toup.net` 추적 스크립트뿐.

교훈 (v4.4 반복 금지):
- 특정 사이트(t-print)의 스펙을 안다고 해서 하드코딩하지 말 것
- "백엔드가 항상 내가 아는 형태로 나오는 게 아니다"
- 워크벤치는 모르는 사이트에서도 동작하는 일반 도구여야 함

## 2. 기능 명세

### 2.1 전체 페이지 JS 분석

현재: 메인 페이지(`index.html`)의 JS만 분석
변경: 추출된 **모든 페이지**의 JS를 분석 대상으로 포함

- `pages/*.html`의 인라인 스크립트
- `pages/*.html`이 참조하는 외부 JS
- 각 페이지별로 `source` 필드에 페이지 경로 기록

### 2.2 Form 분석 추가

현재: AJAX/fetch만 탐지
추가: `<form>` 태그의 `action`/`method`도 `backend-raw.json`에 기록

```json
{
  "forms": [
    {
      "action": "/ORDER/cart.php",
      "method": "POST",
      "fields": ["goods_no", "qty", "options"],
      "source": "pages/POD_goods_....html"
    }
  ]
}
```

### 2.3 탐지 패턴 확장

현재 정규식: `$.ajax`, `$.post`, `$.get`, `$.getJSON`, `fetch`

추가:
- `XMLHttpRequest` (vanilla JS)
- `axios.post`, `axios.get`
- jQuery `$.getJSON`의 콜백 형태 변형
- HTML `onclick` 속성 내 URL (예: `onclick="location.href='/ORDER/...'"`)

### 2.4 중복 제거 및 우선순위

- 동일 URL이 여러 페이지에서 발견되면 하나로 합치고 `sources` 배열에 모든 출처 기록
- 추적/분석 스크립트 (`log*.`, `google-analytics`, `facebook.net` 등)는 `type: "tracking"`으로 분류해서 따로 표시
- 실제 백엔드 API (`type: "api"`)를 상단에 우선 표시

### 2.5 UI 개선

`[JS 백엔드 스텁 관리]` 섹션에 추가:
- 페이지별 탭 또는 필터 (어느 페이지에서 발견됐는지)
- `tracking` vs `api` 구분 표시
- "전체 backend-raw.json 보기" 버튼 (JSON 원문)

### 2.6 클론 미리보기 (로컬 서버)

**배경:** `file://`로 클론을 열면 브라우저 줌이 파일마다 따로 기억되는 등 실사용과 다른 동작 발생. `http://localhost`로 서빙해야 실사용 환경과 동일.

**기능:**
- 클론 카드에 [미리보기] 버튼 추가
- 클릭 시 해당 클론 폴더를 `http://localhost:8000`으로 서빙
- 브라우저에서 `http://localhost:8000/index.html` 자동 오픈
- 서버는 워크벤치 종료 시 함께 종료 (또는 [서버 중지] 버튼)

**구현 참고:**
- Node.js `http` 모듈 또는 `express.static` 사용
- 포트는 8000 기본, 충돌 시 8001, 8002... 자동 증가
- Electron의 `shell.openExternal()`로 브라우저 오픈

## 3. 검증 기준

1. t-print 재추출 시 `POD_module.php`가 `backend-raw.json`에 포함되는지
2. `forms` 배열에 장바구니/주문 폼이 기록되는지
3. `tracking`과 `api`가 올바르게 분류되는지
4. 중복 URL이 하나로 합쳐지는지
5. `node --check` 파싱 통과

## 4. 버전

- v5.1로 버전 범프
