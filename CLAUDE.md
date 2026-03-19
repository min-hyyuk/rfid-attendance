# RFID 출퇴근 관리 시스템 — 프로젝트 컨텍스트

> 이 파일은 Claude Code 대화 간 컨텍스트 유지를 위한 문서입니다.
> 새 대화 시작 시 이 파일을 먼저 읽어주세요.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 시스템명 | RFID 출퇴근 관리 시스템 |
| 목적 | CR100 RFID 리더기(125KHz EM, RS-232)를 이용한 직원 출퇴근 자동 기록 |
| 기술 스택 | 순수 HTML + CSS + JS (프레임워크 없음) |
| DB | **Supabase** (PostgreSQL) — LocalStorage 완전 대체 완료 |
| 브라우저 | Chrome 필수 (Web Serial API) |
| 리더기 1 | **CR100** — 125KHz EM, RS-232, Web Serial API, CP210x 드라이버 |
| 리더기 2 | **ACR122U** — 13.56MHz NFC, USB PC/SC, 키보드 에뮬레이션 방식 (nfc_reader.py 중계) |

---

## 2. 파일 구조

```
rfid-attendance/
├── index.html              ← SPA 메인 (관리자 모드 + 부서 모드 통합)
├── admin.html              ← index.html#admin 리디렉트용
├── sync.html               ← index.html#sync 리디렉트용
├── css/
│   └── style.css           ← 공통 스타일 (CSS 변수, 반응형)
├── js/
│   ├── config.js           ← Supabase URL + anon key (git 포함)
│   ├── config.example.js   ← config.js 템플릿
│   ├── serial.js           ← 카드 리더기 통신 (Web Serial + 키보드 에뮬레이션)
│   ├── storage.js          ← Supabase CRUD 모듈 (모든 DB 접근 담당)
│   ├── employees.js        ← 직원 데이터 관리 (CRUD)
│   ├── attendance.js       ← 출퇴근 판별 로직 (출근/퇴근/이미완료)
│   └── report.js           ← 월 출근부 HTML 생성 + 새 창 인쇄
├── nfc_reader.py           ← ACR122U NFC WebSocket 서버 (Python, ws://localhost:8765)
├── install_nfc.bat         ← ACR122U 1회 설치 스크립트 (Python+라이브러리+자동시작 등록)
├── .gitignore
└── CLAUDE.md               ← 이 파일
```

---

## 3. 아키텍처 핵심 구조

### 모드 분리 (URL 파라미터 기반)
- **관리자 모드**: `index.html` (dept 파라미터 없음)
  - 비밀번호 로그인 (기본: `1234`, `ADMIN_PASSWORD` 상수)
  - 부서 관리 (추가/삭제/링크 복사)
  - 연휴/휴무일 관리
  - DB 연결 상태 확인, JSON 백업, 전체 삭제
- **부서 모드**: `index.html?dept=DEPT001`
  - 출퇴근 태그 화면 (카드 스캔 → 자동 판별)
  - 직원 등록/수정/삭제
  - 출퇴근 기록 조회 + CSV 내보내기
  - 월 출근부 PDF 출력
  - 근무 설정 (출퇴근 시간, 지각/조퇴 허용, 점심/휴게, 근무 요일)

### SPA 네비게이션
- `navigate(sec)` 함수로 섹션 전환 (`#attendance`, `#admin`, `#deptmgr`, `#status`)
- `section[id="sec-XXX"]` + `hidden` 속성으로 표시/숨김

### 데이터 흐름
```
카드 태그 → SerialReader.onCard() → handleCardScan()
  → Employees.findByCardId()     ← storage.js (Supabase)
  → Attendance.processTag()      ← 출/퇴근 판별
  → Storage.addAttendanceLog()   ← Supabase INSERT
  → showScanResult()             ← UI 업데이트 + 음성 안내
  → renderRightPanel()           ← 직원 현황 갱신
```

---

## 4. Supabase 테이블 구조

### `employees`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | text PK | EMP001 형식 |
| card_id | text UNIQUE | RFID 카드 ID |
| name | text NOT NULL | 이름 |
| dept | text | 부서명 |
| hire_date | text | 입사일 YYYY-MM-DD |
| leave_date | text | 퇴사일 YYYY-MM-DD |
| created_at | text | ISO 문자열 |

### `attendance_logs`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| log_id | text PK | LOG20260312001 형식 |
| card_id | text | RFID 카드 ID |
| emp_id | text | 직원 ID (FK) |
| name | text | 직원 이름 |
| dept | text | 부서명 |
| type | text | '출근' / '퇴근' |
| timestamp | text | 로컬 ISO 문자열 (KST, Z 없음) |
| synced | boolean | 항상 true (Supabase 직접 기록) |

### `departments`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | text PK | DEPT001 형식 |
| name | text | 부서명 |
| work_settings | jsonb | 근무 설정 (start, end, late_min, early_min, work_days, lunch, breaks) |
| created_at | text | ISO 문자열 |

### `holidays`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| date | text PK | YYYY-MM-DD |
| name | text | 휴일 이름 |

### `settings`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| key | text PK | 설정 키 |
| value | text | 설정 값 |

---

## 5. 완료된 개발 단계

| 단계 | 작업 | 상태 |
|------|------|------|
| 1단계 | 프로젝트 구조 + 공통 스타일 | ✅ 완료 |
| 2단계 | COM 포트 연결 + 카드 ID 읽기 | ✅ 완료 |
| 3단계 | Supabase CRUD 모듈 | ✅ 완료 (LocalStorage → Supabase 전환) |
| 4단계 | 직원 등록 화면 | ✅ 완료 |
| 5단계 | 메인 출퇴근 태그 화면 | ✅ 완료 |
| 6단계 | 기록 조회 + CSV 내보내기 | ✅ 완료 |
| 7단계 | Supabase 연동 + 동기화 | ✅ 완료 |

### 추가 구현 기능
- ✅ 관리자/부서 모드 URL 분리
- ✅ 관리자 비밀번호 로그인 (sessionStorage)
- ✅ 부서별 근무 설정 (출퇴근 시간, 지각/조퇴 허용, 점심/휴게시간, 근무 요일)
- ✅ 월 출근부 PDF 출력 (A4 가로, 새 창 인쇄)
- ✅ 연휴/휴무일 관리
- ✅ 수동 출퇴근 등록 (카드 미소지 시)
- ✅ 음성 안내 (Web Speech API)
- ✅ UTC→KST 마이그레이션 (1회성 자동 실행)
- ✅ 카드 중복 태그 30초 방지
- ✅ JSON 백업 내보내기
- ✅ 대기 화면 실시간 시계
- ✅ ACR122U NFC 리더기 지원 (WebSocket 자동 연결, nfc_reader.py 중계)
- ✅ NFC 설치 자동화 (install_nfc.bat → Python + 라이브러리 + Windows 시작프로그램 등록)

---

## 6. Git 커밋 히스토리

```
fde1e3d feat: 이미 출퇴근 완료 시에도 음성안내 추가
edcf898 feat: 점심/휴게시간 설정, 실 근로시간 계산, 대기화면 시계, 음성안내 추가
ea8e00b fix: 마이그레이션 like 쿼리 오류 수정
6a6d588 fix: 출퇴근 시간 UTC→KST 변환 및 기존 기록 자동 마이그레이션
8bcffc4 feat: 관리자 페이지 비밀번호 로그인 보호 추가
7501280 feat: Supabase 완전 대체 — LocalStorage → PostgreSQL
4d37cab fix: 부서 모드에서 관리자 네비게이션이 보이는 버그 수정
158460e feat: 부서별 URL 분리 및 출근부 고도화
74bda88 feat: RFID 출퇴근 관리 시스템 초기 구현
```

---

## 7. Supabase 연결 정보

- **Project URL**: `https://yfvskcrvfnusgtznrkhh.supabase.co`
- anon key는 `js/config.js`에 저장 (RLS로 보호, 클라이언트 노출 안전)
- `js/config.example.js`가 템플릿으로 제공됨

---

## 8. 주의사항

- **시간 저장 형식**: 로컬 ISO 문자열 (`2026-03-12T09:05:23`, Z 접미사 없음) — UTC 아님
- **근무시간 계산**: 조기출근은 근무 시작시간으로 cap, 점심/휴게시간 자동 제외
- **부서 모드 전용 기능**: Serial 연결, 카드 스캔, 수동 출퇴근은 부서 모드에서만 동작
- **Supabase SDK**: CDN으로 로드 (`@supabase/supabase-js@2/dist/umd/supabase.min.js`)
- **Chrome 전용**: Web Serial API는 Chrome/Edge만 지원, HTTPS 또는 localhost 필요

---

## 9. 리더기 이중 지원 구조

| | CR100 (기존) | ACR122U (신규) |
|--|-------------|----------------|
| 주파수 | 125KHz EM | 13.56MHz NFC |
| 연결 | RS-232 → USB COM | USB PC/SC |
| 웹 통신 | Web Serial API (직접) | WebSocket (nfc_reader.py → ws://localhost:8765) |
| 동시 사용 | ✅ 가능 | ✅ 가능 |
| 연결 방식 | 헤더 [COM 연결] 버튼 수동 클릭 | 페이지 로드 시 자동 연결 + 5초 간격 자동 재연결 |
| 설치 | CP210x 드라이버 | install_nfc.bat 1회 실행 (Python + 라이브러리 + 자동시작) |

- `serial.js`가 두 방식을 동시 처리: Web Serial(CR100) + WebSocket(ACR122U)
- ACR122U 설치: 관리자 페이지 → DB 연결 상태 → [install_nfc.bat 다운로드] → 실행
- install_nfc.bat이 Python 라이브러리 설치 + Windows 시작프로그램 자동 등록
- 설치 후 PC 부팅 시 `nfc_reader.py` 백그라운드 자동 실행 (pythonw)
- 헤더에 NFC/COM 뱃지 각각 표시 (연결 상태 실시간 반영)

---

## 10. 향후 고려사항 (미구현)

- 다중 출퇴근 (하루 여러 번 출퇴근 허용)
- 직원별 개별 근무 설정
- 실시간 알림 (Supabase Realtime)
- 모바일 최적화 강화
- RLS (Row Level Security) 정책 세분화
- 배포 환경 설정 (Cloudflare Pages 등)
