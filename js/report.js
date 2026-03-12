/**
 * report.js - 월 출근부 PDF 출력 모듈
 *
 * 원본 양식 재현:
 *  - A4 가로 / 직원 1명당 2행 (출근행 + 연장/재외행)
 *  - 1~31일 컬럼, 주말 회색
 *  - 출근일: ○ + 출근시각 표시
 *  - 퇴근시각 있으면 연장/재외행에 근무시간 자동 기입
 *  - 출근일수 / 결근일수 자동 집계
 *
 * 사용: Report.print(2026, 10)
 */
const Report = (() => {
  const DOW_KR = ['일','월','화','수','목','금','토'];

  /* ── 유틸 ──────────────────────────────────────────────── */
  function daysInMonth(y, m)     { return new Date(y, m, 0).getDate(); }
  function getDow(y, m, d)       { return new Date(y, m - 1, d).getDay(); }
  function isWeekend(y, m, d)    { const w = getDow(y,m,d); return w===0||w===6; }
  function pad2(n)               { return String(n).padStart(2,'0'); }
  function toHHMM(isoStr)        { return isoStr.slice(11,16); }

  /** 출퇴근 시각으로 근무시간 계산 → 'H:MM' 형식 */
  function workDuration(inT, outT) {
    if (!inT || !outT) return '';
    const [ih,im] = inT.split(':').map(Number);
    const [oh,om] = outT.split(':').map(Number);
    const diff = (oh*60+om) - (ih*60+im);
    if (diff <= 0) return '';
    return `${Math.floor(diff/60)}:${pad2(diff%60)}`;
  }

  /* ── 데이터 구성 ────────────────────────────────────────── */
  /**
   * attMap[empId][day] = { in:'HH:MM', out:'HH:MM' }
   */
  function buildAttMap(employees, logs) {
    const map = {};
    employees.forEach(e => { map[e.id] = {}; });
    logs.forEach(log => {
      const day = parseInt(log.timestamp.slice(8,10), 10);
      if (!map[log.emp_id]) return;
      if (!map[log.emp_id][day]) map[log.emp_id][day] = {};
      const t = toHHMM(log.timestamp);
      if (log.type === '출근') map[log.emp_id][day].in  = t;
      if (log.type === '퇴근') map[log.emp_id][day].out = t;
    });
    return map;
  }

  /** 해당 직원의 출근일수 / 결근일수 (평일 기준) */
  function calcSummary(empId, attMap, y, m) {
    const days = daysInMonth(y, m);
    let worked = 0, absent = 0;
    for (let d = 1; d <= days; d++) {
      if (isWeekend(y, m, d)) continue;
      attMap[empId]?.[d]?.in ? worked++ : absent++;
    }
    return { worked, absent };
  }

  /* ── HTML 생성 ──────────────────────────────────────────── */
  function generateHTML(year, month, companyName) {
    const days      = daysInMonth(year, month);
    const padMonth  = pad2(month);
    const startDate = `${year}-${padMonth}-01`;
    const endDate   = `${year}-${padMonth}-${pad2(days)}`;

    const employees = Employees.getAll();
    const logs      = Storage.getLogsByDateRange(startDate, endDate);
    const attMap    = buildAttMap(employees, logs);

    /* ── 날짜 헤더 행 ── */
    const dayHeaders = Array.from({length: 31}, (_, i) => {
      const d = i + 1;
      if (d > days) return `<th class="noday"></th>`;
      const dow  = getDow(year, month, d);
      const wk   = (dow===0||dow===6);
      return `<th class="${wk?'wk':''}">${d}<br><em>${DOW_KR[dow]}</em></th>`;
    }).join('');

    /* ── 직원 행 ── */
    const empRows = employees.map((emp, idx) => {
      const att      = attMap[emp.id] || {};
      const summary  = calcSummary(emp.id, attMap, year, month);

      // 날짜 셀 (출근행)
      const dayCells = Array.from({length: 31}, (_, i) => {
        const d = i + 1;
        if (d > days) return `<td class="noday"></td>`;
        if (isWeekend(year, month, d)) return `<td class="wk"></td>`;
        const rec = att[d];
        if (rec?.in) {
          return `<td class="att"><span class="chk">○</span><span class="tin">${rec.in}</span></td>`;
        }
        return `<td></td>`;
      }).join('');

      // 날짜 셀 (연장/재외행)
      const extCells = Array.from({length: 31}, (_, i) => {
        const d = i + 1;
        if (d > days) return `<td class="noday"></td>`;
        if (isWeekend(year, month, d)) return `<td class="wk"></td>`;
        const rec = att[d];
        const dur = workDuration(rec?.in, rec?.out);
        return dur ? `<td class="dur">${dur}</td>` : `<td></td>`;
      }).join('');

      return `
        <tr class="mr">
          <td rowspan="2" class="no">${idx+1}</td>
          <td class="nm">${emp.name}<br><small>${emp.dept||''}</small></td>
          ${dayCells}
          <td rowspan="2" class="sum">${summary.worked}</td>
          <td rowspan="2" class="sum">${summary.absent}</td>
          <td rowspan="2" class="etc"></td>
          <td rowspan="2" class="sig"></td>
        </tr>
        <tr class="er">
          <td class="elb">연장/재외</td>
          ${extCells}
        </tr>`;
    }).join('');

    /* ── 범례 HTML ── */
    const legendHTML = `
      <table class="leg">
        <tr><td>출근</td><td>1번줄은 2번은 결근</td></tr>
        <tr><td>연장/재외</td><td>연장근무 또는 지각,조퇴등 시간 기입</td></tr>
        <tr><td>비고</td><td>월차사용일/퇴직사유표기(월차미사용 또는 없을시 공란)</td></tr>
        <tr><td>근로자서명</td><td>근로자 최종 서명</td></tr>
      </table>`;

    /* ── 완성 HTML ── */
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${year}년 ${month}월 출근부</title>
<style>
@page { size: A4 landscape; margin: 6mm 8mm; }
*     { box-sizing: border-box; margin: 0; padding: 0; }
body  {
  font-family: 'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif;
  font-size: 7pt;
  color: #111;
}

/* ── 상단 메타 영역 ── */
.top { overflow: hidden; margin-bottom: 4px; }

.leg {
  float: right;
  border: 1px solid #444;
  border-collapse: collapse;
  font-size: 6.5pt;
  line-height: 1.7;
}
.leg td { padding: 0 5px; border-bottom: 1px solid #ccc; }
.leg td:first-child { font-weight: bold; border-right: 1px solid #ccc; white-space: nowrap; }
.leg tr:last-child td { border-bottom: none; }

.report-title { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 5px; }

.info-table { border-collapse: collapse; font-size: 7pt; }
.info-table td { padding: 1px 4px; }
.info-table .box {
  border: 1px solid #555;
  min-width: 50px;
  display: inline-block;
  height: 13px;
  vertical-align: middle;
  padding: 0 3px;
}

.ym-row { font-size: 7.5pt; font-weight: bold; margin: 3px 0 2px; }
.ym-note { font-size: 6pt; color: #555; margin-left: 8px; }

/* ── 본표 ── */
table.main {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

table.main th,
table.main td {
  border: 1px solid #555;
  text-align: center;
  vertical-align: middle;
  overflow: hidden;
  padding: 0;
}

/* 컬럼 너비 (A4가로 285mm 기준) */
.c-no  { width: 6mm; }
.c-nm  { width: 22mm; }
.c-d   { width: 7.1mm; }   /* 31개 × 7.1mm = 220mm */
.c-sum { width: 9mm; }
.c-etc { width: 9mm; }
.c-sig { width: 10mm; }

/* 헤더 */
thead th {
  background: #e4e4e4;
  font-size: 6.5pt;
  font-weight: bold;
  height: 10mm;
  line-height: 1.3;
}
thead th em { font-style: normal; font-size: 5.5pt; display: block; }

/* 주말 */
.wk    { background: #c0c0c0 !important; }
.noday { background: #d8d8d8; border-color: #aaa; }

/* 출근 행 */
tr.mr td { height: 11mm; }

.no  { font-size: 6.5pt; }
.nm  {
  font-size: 8pt; font-weight: bold;
  text-align: left; padding-left: 2px; line-height: 1.3;
}
.nm small { font-size: 5.5pt; color: #555; font-weight: normal; display: block; }

.att { position: relative; }
.chk { font-size: 10pt; font-weight: bold; display: block; line-height: 1; }
.tin { font-size: 5pt; color: #333; display: block; line-height: 1; }

/* 연장/재외 행 */
tr.er td { height: 6.5mm; background: #fafafa; }
.elb { font-size: 6pt; color: #444; background: #f0f0f0; }
.dur { font-size: 6pt; color: #222; }

/* 합계 */
.sum { font-size: 8pt; font-weight: bold; }
.etc { }
.sig { }

/* 행 단위 페이지 나눔 방지 */
tr.mr, tr.er { page-break-inside: avoid; }

/* 인쇄 색상 강제 적용 */
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none; }
}
</style>
</head>
<body>

<!-- 안내 버튼 (인쇄 시 숨김) -->
<div class="no-print" style="background:#fffbcd; border:1px solid #e0c040;
     padding:8px 14px; margin-bottom:8px; font-size:9pt; border-radius:4px;">
  <b>인쇄 방법:</b> Ctrl+P → 용지 방향 <b>가로</b> → 여백 <b>없음(최소)</b> → PDF로 저장 또는 인쇄
  <button onclick="window.print()" style="margin-left:12px; padding:4px 14px;
    background:#2563eb; color:white; border:none; border-radius:4px; cursor:pointer; font-size:9pt;">
    🖨 인쇄 / PDF 저장
  </button>
</div>

<!-- 상단 -->
<div class="top">
  ${legendHTML}
  <div class="report-title">${year}년 ${month}월 출근부</div>
  <table class="info-table">
    <tr>
      <td>(남/여)</td>
      <td style="padding-left:12px;">작업장 관리자</td>
      <td><span class="box">${companyName||''}</span></td>
      <td style="padding-left:6px;">확인서명</td>
      <td><span class="box"></span></td>
      <td style="padding-left:16px;">총인원수</td>
      <td><span class="box">${employees.length}명</span></td>
      <td style="padding-left:6px;">인원MD</td>
      <td><span class="box"></span></td>
    </tr>
    <tr>
      <td colspan="5"></td>
      <td style="padding-left:16px;">휴가</td>
      <td><span class="box"></span></td>
      <td style="padding-left:6px;">결근</td>
      <td><span class="box"></span></td>
    </tr>
    <tr>
      <td colspan="5"></td>
      <td style="padding-left:16px;">지각</td>
      <td><span class="box"></span></td>
      <td style="padding-left:6px;">조퇴</td>
      <td><span class="box"></span></td>
    </tr>
  </table>
</div>

<div class="ym-row">
  년월: ${year}-${padMonth}
  <span class="ym-note">※ 매월 주말에 해당하는 요일의 경우 회색으로 표기해 작성하시면 됩니다.</span>
</div>

<!-- 본표 -->
<table class="main">
  <colgroup>
    <col class="c-no">
    <col class="c-nm">
    ${Array.from({length:31}, () => `<col class="c-d">`).join('')}
    <col class="c-sum">
    <col class="c-sum">
    <col class="c-etc">
    <col class="c-sig">
  </colgroup>
  <thead>
    <tr>
      <th>no</th>
      <th>이름</th>
      ${dayHeaders}
      <th>출근<br>일수</th>
      <th>결근<br>일수</th>
      <th>비고</th>
      <th>근로자<br>서명</th>
    </tr>
  </thead>
  <tbody>
    ${empRows}
  </tbody>
</table>

</body>
</html>`;
  }

  /* ── 공개 API ────────────────────────────────────────────── */
  return {
    /**
     * 월 출근부를 새 창에 열고 인쇄 다이얼로그 표시
     * @param {number} year
     * @param {number} month   1 ~ 12
     * @param {string} companyName  작업장명 (선택)
     */
    print(year, month, companyName = '') {
      const html = generateHTML(year, month, companyName);
      const win  = window.open('', '_blank', 'width=1400,height=900');
      if (!win) {
        alert('팝업이 차단되었습니다.\n브라우저 주소창 우측의 팝업 허용 버튼을 클릭한 후 다시 시도하세요.');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
    },
  };
})();
