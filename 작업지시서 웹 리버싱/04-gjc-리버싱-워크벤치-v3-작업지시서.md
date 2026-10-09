# gjc 리버싱 워크벤치 작업지시서 v3 — 패턴 지식 베이스 + 프롬프트 패키저

## 1. 목표

v2(수집)가 뱉어내는 클론 폴더를 **쌓아두고 꺼내 쓸 수 있는 지식**으로 만든다.
"내가 벤치마킹한 실전 사이트 → 패턴 DB → 프롬프트로 생성" 루프의 축적/주문 단계를 구현.

핵심 원칙: **깊이가 넓이를 이긴다.** 사이트 100개 얕게 긁기보다 3개 깊게 파기.
DB는 개인 코퍼스 규모에 맞게 SQLite로 시작 (ChromaDB는 나중).

## 2. 배경

- v1/v1.1: 워크벤치 앱 뼈대 + 백엔드 스캐폴딩 생성기 (완료)
- v2: 진짜 클로닝 추출 엔진 (DOM 스냅샷 + CSS/에셋 수집 + URL 재작성) + electron-builder (진행 중)
- v3(이 지시서): 추출 결과를 패턴 DB에 축적하고, 프롬프트 입력 시 관련 패턴을 검색해서
  에이전트용 프롬프트 패키지로 묶어주는 기능.
- 참고 사례: `alim953/multi-agent-website-builder` (RAG 파이프라인),
  `abi/screenshot-to-code` (수집), `lucasol1337/openpage` (구조화된 에이전트 API)

## 3. 패턴 DB (축적)

### 3.1 스키마 (SQLite, better-sqlite3 — 이미 의존성에 있음)

```sql
CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT,
  captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  clone_dir TEXT,          -- v2 클론 폴더 경로
  screenshot_path TEXT     -- v2에서 같이 저장한 스크린샷 (포석)
);

CREATE TABLE patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES sites(id),
  category TEXT NOT NULL,  -- layout | component | color | typography | api | flow
  name TEXT NOT NULL,      -- "상품 카드 그리드", "결제 플로우" 등
  summary TEXT NOT NULL,   -- 한 줄 설명
  tags TEXT,               -- 콤마 구분 태그 ("쇼핑몰,상품목록,그리드")
  content_json TEXT NOT NULL, -- 패턴 상세 (HTML 스니펫, CSS 토큰, API 스펙 등 JSON)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2 패턴 등록 플로우

1. v2 추출 완료 후 [패턴으로 저장] 버튼 → 등록 UI (모달 또는 탭).
2. 등록 UI에서:
   - 사이트 정보 자동 입력 (URL, 도메인, 클론 폴더 경로)
   - 패턴을 하나씩 추가: 카테고리 선택 + 이름 + 요약 + 태그 + 내용
   - 내용은 v2 추출 결과(토큰, 레이아웃, 컴포넌트)에서 자동 채움 + 사용자 수정 가능
3. `sites` + `patterns`에 저장. 로그 패널에 "패턴 N개 저장됨" 표시.

*당장은 수동/반자동 등록. 에이전트 자동 분석 임포트는 v4.*

### 3.3 패턴 조회 UI

- [패턴 라이브러리] 탭 (신규):
  - 사이트별 / 카테고리별 / 태그별 필터
  - 패턴 목록 → 클릭 시 상세 (summary + content_json 예쁘게 표시)
  - 패턴 삭제, 태그 수정

## 4. 프롬프트 패키저 (주문/조립)

### 4.1 동작

1. [생성] 탭 (신규 또는 기존 탭 확장)에 프롬프트 입력창:
   예) "인쇄 쇼핑몰 상품 상세 페이지 만들어줘"
2. 입력에서 키워드 추출 (단순 토크나이저로 시작 — "쇼핑몰", "상품", "상세", "결제" 등) →
   `patterns` 테이블에서 태그/이름/summary 매칭으로 관련 패턴 검색 (LIKE 기반, v3는 벡터 검색 불필요).
3. 검색된 패턴들을 묶어서 **프롬프트 패키지** 생성:
   ```
   [사용자 요청]
   인쇄 쇼핑몰 상품 상세 페이지 만들어줘

   [참조 패턴 1] A사이트 — 상품 카드 그리드 (component)
   요약: ...
   HTML: ...
   CSS 토큰: ...

   [참조 패턴 2] B사이트 — 결제 플로우 (flow)
   ...
   ```
4. 패키지를 화면에 표시 + [복사] 버튼. 사용자가 가재코드 채팅에 붙여넣으면 됨.
   (앱 내 직접 에이전트 구동은 v4 — CLI 연동 조사 후.)

### 4.2 검색 품질

- 태그 정확 매칭 > 이름/요약 부분 매칭 순으로 정렬.
- 관련 패턴이 0개면 "패턴을 먼저 쌓아주세요" 안내 (빈 패키지 생성 금지).

## 5. UI 구조 (기존 탭에 추가)

- [프론트 추출] (v2 유지)
- [백엔드 생성] (v1.1 유지)
- **[패턴 라이브러리]** (신규): 3.3
- **[생성]** (신규): 4.1 프롬프트 입력 + 패키지 출력 + 복사
- 설정 모달에 "패턴 DB 경로" 항목 추가 (기본값: 앱 userData/patterns.db).

## 6. 완료 기준 (자체 검증 후 보고)

- [ ] v2 클론 완료 후 [패턴으로 저장]으로 사이트+패턴이 DB에 저장됨.
- [ ] 패턴 라이브러리 탭에서 사이트별/카테고리별/태그별 조회가 됨.
- [ ] 패턴 상세 보기, 삭제, 태그 수정이 동작함.
- [ ] "쇼핑몰 상품 페이지 만들어줘" 입력 시 관련 패턴이 검색되어 프롬프트 패키지가 생성됨.
- [ ] 패키지의 [복사] 버튼으로 클립보드에 복사됨.
- [ ] 관련 패턴 0개 시 안내 메시지가 표시됨 (빈 패키지 없음).
- [ ] 앱 재시작 후에도 DB 내용이 유지됨.

## 7. 제외 사항 (v4 이후)

- 벡터 검색 (ChromaDB/임베딩): 개인 코퍼스 규모에선 LIKE로 충분. v4에서 검토.
- 앱 내 에이전트 직접 구동 (CLI 연동): v4에서 free-gjc CLI 헤드리스 모드 조사 후.
- 스크린샷 기반 비전 분석: v2에서 스크린샷만 저장해두고, 분석은 v4.

## 8. 주의사항

- safe-shell 스킬 준수.
- diagnose-first: 패치 전 원인 가설과 설명부터.
- DB 파일은 사용자 데이터이므로 asar 밖에 저장 (userData 경로).
- 완료 보고 전 체크리스트를 직접 실행해서 확인한 뒤 보고할 것.
