# 리버싱 워크벤치 v5.0 작업지시서 — JS 리버싱 파이프라인

## 1. 배경과 방향 전환

### 1.1 v4.4의 한계

v4.4 "인터랙션 부활"은 UI 패턴을 감지해 표준 라이브러리로 재구현하는 방식이었음.
t-print 실측에서 한계가 명확해짐:
- "표준" UI 패턴은 존재하지 않음. 사이트마다 고유한 구현
- 메뉴 토글 하나에도 중첩 구조(`.gnb2` + `.gnb-all`), jQuery 애니메이션, 오버레이 등 복잡한 로직
- 패턴 매칭 방식은 사이트마다 새로운 리버스엔지니어링을 요구 ("자바스크립트 구현 대회")

### 1.2 v5의 철학

**"프론트엔드는 리버싱, 백엔드는 엔지니어링"**

IDA가 exe를 분석하듯, 원본 JS를 분석해서:
1. 백엔드 호출 부분만 식별하고 스텁으로 교체
2. 나머지 UI 로직은 원본 그대로 보존
3. 식별된 백엔드 호출을 `backend-raw.json`으로 문서화
4. 백엔드는 이 스펙을 보고 새로 구현 (엔지니어링)

## 2. 기능 명세

### 2.1 JS 수집 (추출 단계)

현재 추출기는 `<script>` 태그를 제거함. v5부터는:
- 인라인 `<script>` 내용 수집
- 외부 JS 파일 (`<script src>`) 다운로드 및 저장
- 수집된 JS 목록을 `js-manifest.json`에 기록

### 2.2 JS 분석 (분석 단계)

수집된 JS를 정적 분석하여 백엔드 의존성 식별:

**탐지 대상:**
- jQuery: `$.ajax()`, `$.post()`, `$.get()`, `$.getJSON()`
- Native: `fetch()`, `XMLHttpRequest`
- Form: `<form action="...">` (POST/GET)
- 기타: `location.href` 변경 중 쿼리스트링 포함된 것

**판별 기준:**
- URL이 API처럼 생겼으면 백엔드 호출 (예: `/ORDER_POD/POD_module.php`, `/api/`, `.php?`)
- 정적 에셋이면 제외 (예: `.js`, `.css`, `.png`)

**출력 (`backend-raw.json`):**
```json
{
  "endpoints": [
    {
      "url": "/ORDER_POD/POD_module.php",
      "method": "POST",
      "params": ["goods_no", "qty", "color"],
      "source": "inline-script:23",
      "responseFields": ["total_price", "goods_price_vat"]
    }
  ],
  "forms": [
    {
      "action": "/ORDER/cart.php",
      "method": "POST",
      "fields": ["..."]
    }
  ]
}
```

### 2.3 스텁 생성 (변환 단계)

식별된 백엔드 호출을 스텁으로 교체:

**원칙:**
- 원본 JS 파일은 `js/original/`에 보존
- 스텁 적용된 JS는 `js/`에 저장 (클론에서 실제 로드되는 버전)
- 스텁은 `console.warn('[STUB] Backend call intercepted:', url)` 출력 후 가짜 응답 반환

**스텁 예시:**
```js
// 원본
$.post('/ORDER_POD/POD_module.php', data, callback);

// 스텁 교체 후
console.warn('[STUB] POST /ORDER_POD/POD_module.php');
callback({ total_price: '99,000원 (스텁)', goods_price_vat: '108,900원 (스텁)' });
```

### 2.4 UI

- 추출 완료 후 "JS 분석" 섹션에 `backend-raw.json` 요약 표시
- 식별된 엔드포인트 목록 (URL, 메서드, 파라미터)
- 각 엔드포인트별 스텁 적용 여부 토글
- "스텁 재생성" 버튼

## 3. 기존 v4.4와의 관계

- v4.4의 패턴 감지/표준 라이브러리(`lib/interactions.js`)는 **보조 수단**으로 유지
- 원본 JS가 없거나 분석 실패한 경우에만 폴백으로 사용
- 우선순위: 원본 JS 보존 > 표준 라이브러리

## 4. 검증 기준

1. t-print 클론에서 원본 JS가 수집되는지
2. `POD_module.php` 호출이 `backend-raw.json`에 기록되는지
3. 스텁 적용 후 메뉴/슬라이더 등 UI가 원본처럼 동작하는지
4. 콘솔에 `[STUB]` 경고가 표시되는지
5. `node --check` 파싱 통과

## 5. 버전

- v5.0으로 버전 범프
- 이는 아키텍처 변경이므로 마이너 버전이 아닌 메이저 취급
