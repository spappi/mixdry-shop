# gjc 리버싱 워크벤치 작업지시서 (v1)

## 1. 목표

URL을 입력하면 해당 사이트의 프론트엔드를 추출(리버싱)하고, 표준 쇼핑몰 백엔드를 생성(엔지니어링)해서,
**주문관리까지 실제로 동작하는 쇼핑몰 프로젝트**를 스캐폴딩하는 Electron 데스크톱 앱을 만든다.

핵심 철학: **프론트엔드는 리버싱, 백엔드는 엔지니어링.**

## 2. 배경

- 사용자는 쇼핑몰(t-print 계열 인쇄 쇼핑몰) 수준의 실무용 몰을 직접 만들고 싶어함.
- 백엔드(주문 접수 → admin 확인/처리, 단가표, 세금계산서)는 이미 업계 표준 패턴이 확립되어 있음.
  → 기존 사이트의 admin을 캡처/역추적할 필요 없음 (사용자 결정: 캡처 방식 v1 제외).
- 프론트엔드는 참조 사이트에서 디자인·구조를 추출해서 재활용.
- UI/UX는 gjc-epub-translator 스타일을 따른다 (탭, 로그 패널, 설정 모달 등 재활용).

## 3. v1 범위

### 포함
- **[프론트 추출] 탭**: URL 입력 → web-cloner 스킬(스킬북에 등록됨) 호출 → 디자인 토큰(색상, 타이포, 레이아웃 구조),
  컴포넌트 구조, 핵심 클라이언트 로직 추출 → 결과 표시 및 저장.
- **[백엔드 생성] 탭**: 표준 쇼핑몰 백엔드 스캐폴딩 생성 (아래 §5 스펙).
- **[프로젝트 출력]**: 추출된 프론트 디자인 + 생성된 백엔드를 결합한 쇼핑몰 프로젝트를 로컬 폴더로 출력.
  출력물은 `npm install && npm start`로 바로 실행 가능해야 함.

### 제외 (v1)
- HAR/네트워크 캡처 → API 스펙 역추적 (사용자 결정으로 제외).
- 결제 PG 실연동 → 결제 인터페이스 + 목업만 (실연동은 v2).
- 세금계산서 실발급 → 발급 플로우 + 목업 provider만 (Popbill 등 실연동은 v2).

## 4. UI 구조 (epub-translator 스타일)

- epub-translator에서 재활용: 탭 구조, 하단 로그 패널, 설정 모달(리사이즈 대응 포함),
  responsive-ui 스킬의 레이아웃 규칙.
- 탭 구성:
  - **[프론트 추출]**: URL 입력창 + [추출 시작] 버튼, 추출 결과(디자인 토큰, 파일 트리, 로직 요약) 표시 영역.
  - **[백엔드 생성]**: 몰 이름/관리자 계정 등 기본 설정 입력, [백엔드 생성] 버튼, 생성 로그, 출력 폴더 열기 버튼.
- 모든 장기 작업은 로그 패널에 진행 상황 표시 (auto-continue-handoff 패턴 참고).

## 5. 백엔드 스펙 (표준 쇼핑몰)

### 5.1 엔티티
- **Product** (상품): id, name, description, price, options(JSON), stock, images, category, status
- **Order** (주문): id, customer_name, customer_phone, customer_email, items(JSON 또는 별도 테이블),
  total_amount, status, created_at, updated_at
- **OrderItem** (주문상품): order_id, product_id, option_detail, quantity, unit_price
- **Admin** (관리자): id, username, password_hash(bcrypt), role
- **PriceRule** (단가표): product_id, option_key, price — 인쇄몰식 옵션별 단가 대응
- **TaxInvoice** (세금계산서): order_id, business_number, company_name, amount, status(요청/발급완료/실패),
  issued_at — 외부 연동 인터페이스 뒤에 목업 provider

### 5.2 주문 상태 전이
`pending`(신규) → `confirmed`(확인) → `shipping`(배송중) → `completed`(완료), 어느 단계에서든 `cancelled`(취소).
상태 변경은 admin API를 통해서만 가능.

### 5.3 API
- 스토어프론트:
  - `GET /api/products` — 상품 목록 (카테고리/검색 쿼리 지원)
  - `GET /api/products/:id` — 상품 상세 (단가표 포함)
  - `POST /api/orders` — 주문 생성
  - `GET /api/orders/:id` — 주문 조회 (주문번호+연락처 인증)
- Admin (JWT 또는 세션 인증):
  - `POST /api/admin/login`
  - `GET /api/admin/orders` — 주문 목록 (상태 필터, 페이징)
  - `PATCH /api/admin/orders/:id/status` — 상태 변경
  - `GET/POST/PUT/DELETE /api/admin/products` — 상품 관리
  - `GET/PUT /api/admin/prices` — 단가표 관리
  - `POST /api/admin/invoices` — 세금계산서 발급 요청 (목업)

### 5.4 기술 스택 (권장)
- 생성되는 백엔드: Node.js + Express + better-sqlite3 (설치형 DB 불필요, Windows에서 바로 실행).
- 생성되는 스토어프론트: 추출된 디자인 토큰을 입힌 정적 프론트 + 위 API 연동.
- 워크벤치 앱 자체: Electron (epub-translator와 동일 구조).

## 6. 프론트 추출 → 백엔드 결합 방식

1. [프론트 추출]에서 디자인 토큰(컬러, 폰트, 레이아웃 패턴)을 JSON으로 저장.
2. [백엔드 생성] 시 스토어프론트 템플릿에 토큰을 주입해서 참조 사이트 분위기의 몰을 생성.
3. 디자인은 "참고/변형" 수준으로 — 픽셀 단위 복제가 아니라 토큰 기반 재구성.

## 7. 재사용 자산

- `gjc-epub-translator`의 탭 UI, 로그 패널, 설정 모달, viewer 컴포넌트.
- 스킬북의 web-cloner 스킬 (프론트 추출 엔진).
- safe-shell 스킬 준수 (파일 생성/삭제 시).

## 8. 완료 기준

- [ ] URL 입력 → 프론트 추출 결과가 화면에 표시됨 (디자인 토큰, 구조 요약).
- [ ] 백엔드 생성 → 출력 폴더에 실행 가능한 쇼핑몰 프로젝트 생성됨.
- [ ] 생성된 몰 E2E 동작: 상품 목록 → 주문 생성 → admin 로그인 → 주문 확인/상태 변경.
- [ ] 단가표 기반 옵션별 가격 계산이 동작함.
- [ ] 세금계산서 발급 요청 플로우가 목업으로 동작함 (상태 전이까지).
- [ ] 출력 프로젝트에 README (실행 방법) 포함.

## 9. 주의사항

- admin 캡처 방식은 v1에서 제외됨 (사용자 결정). 관련 UI/코드를 넣지 말 것.
- diagnose-first 스킬: 패치 전에 원인 가설과 설명부터.
