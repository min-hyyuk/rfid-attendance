/**
 * report.js - 월 출근부 PDF 출력 모듈
 *
 * 원본 양식 재현 + 확장:
 *  - A4 가로 / 직원 1명당 2행 (출근행 + 연장/재외행)
 *  - 부서 필터: 특정 부서만 출력 가능
 *  - 부서별/개인별 근무 설정(ws) 적용: 비근무요일, 지각▲, 조퇴▽, 결근×
 *  - 공휴일/휴무일 休, 입사 전/퇴사 후 빗금
 *  - 휴가/반차/반반차/조퇴 기호 및 비고 자동 기재
 *
 * 사용: Report.print(2026, 10, '작업장명', 'DEPT001', ws)
 */
const Report = (() => {
  const DOW_KR = ['일','월','화','수','목','금','토'];

  const DEFAULT_WS = {
    start: '09:00', end: '18:00',
    late_min: 0, early_min: 0,
    work_days: [1, 2, 3, 4, 5],
  };

  /* ── 유틸 ──────────────────────────────────────────────── */
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function getDow(y, m, d)   { return new Date(y, m - 1, d).getDay(); }
  function pad2(n)            { return String(n).padStart(2, '0'); }
  function toHHMM(isoStr)    { return isoStr.slice(11, 16); }
  function ds(y, m, d)       { return `${y}-${pad2(m)}-${pad2(d)}`; }

  function toMin(t) {
    const [h, mm] = t.slice(0, 5).split(':').map(Number);
    return h * 60 + mm;
  }

  function workDuration(inT, outT) {
    if (!inT || !outT) return '';
    const diff = toMin(outT) - toMin(inT);
    if (diff <= 0) return '';
    return `${Math.floor(diff / 60)}:${pad2(diff % 60)}`;
  }

  function lateMin(inT, ws) {
    if (!inT) return 0;
    return Math.max(0, toMin(inT) - (toMin(ws.start) + (ws.late_min || 0)));
  }

  function earlyMin(outT, ws) {
    if (!outT) return 0;
    return Math.max(0, (toMin(ws.end) - (ws.early_min || 0)) - toMin(outT));
  }

  function isOffDay(y, m, d, ws) {
    return !ws.work_days.includes(getDow(y, m, d));
  }

  function isHoliday(y, m, d, holidays) {
    return holidays.some(h => h.date === ds(y, m, d));
  }

  function holidayName(y, m, d, holidays) {
    return (holidays.find(h => h.date === ds(y, m, d)) || {}).name || '休';
  }

  function isActive(emp, y, m, d) {
    const dateStr = ds(y, m, d);
    if (emp.hire_date  && dateStr < emp.hire_date)  return false;
    if (emp.leave_date && dateStr > emp.leave_date) return false;
    return true;
  }

  /** 직원별 유효 ws 반환 */
  function getEmpWs(emp, deptWs) {
    if (emp.work_settings) return { ...DEFAULT_WS, ...emp.work_settings };
    return deptWs;
  }

  /* ── 데이터 구성 ────────────────────────────────────────── */
  function buildAttMap(employees, logs) {
    const map = {};
    employees.forEach(e => { map[e.id] = {}; });
    logs.forEach(log => {
      const day = parseInt(log.timestamp.slice(8, 10), 10);
      if (!map[log.emp_id]) return;
      if (!map[log.emp_id][day]) map[log.emp_id][day] = {};
      const t = toHHMM(log.timestamp);
      if (log.type === '출근') map[log.emp_id][day].in  = t;
      if (log.type === '퇴근') map[log.emp_id][day].out = t;
    });
    return map;
  }

  function calcSummary(emp, attMap, y, m, ws, holidays, leaveMap) {
    const days = daysInMonth(y, m);
    let worked = 0, absent = 0, late = 0, earlyLeave = 0;
    let leaveCount = 0, halfCount = 0, quarterCount = 0, earlyAuth = 0;
    for (let d = 1; d <= days; d++) {
      if (!isActive(emp, y, m, d)) continue;
      if (isOffDay(y, m, d, ws))   continue;
      if (isHoliday(y, m, d, holidays)) continue;

      const leave = leaveMap[`${emp.id}_${ds(y, m, d)}`];
      if (leave) {
        if (leave.type === '휴가')   { leaveCount++; continue; }
        if (leave.type === '반차')   halfCount++;
        if (leave.type === '반반차') quarterCount++;
        if (leave.type === '조퇴')   earlyAuth++;
      }

      const adjWs = leave ? (Attendance.getAdjustedWs(ws, leave) || ws) : ws;
      const rec = (attMap[emp.id] || {})[d];
      if (rec?.in) {
        worked++;
        if (lateMin(rec.in, adjWs) > 0)              late++;
        if (rec.out && earlyMin(rec.out, adjWs) > 0)  earlyLeave++;
      } else {
        absent++;
      }
    }
    return { worked, absent, late, earlyLeave, leaveCount, halfCount, quarterCount, earlyAuth };
  }

  /* ── HTML 생성 ──────────────────────────────────────────── */
  async function generateHTML(year, month, companyName, deptFilter = null, ws = null) {
    const effectiveWs = ws ? { ...DEFAULT_WS, ...ws } : DEFAULT_WS;
    const days        = daysInMonth(year, month);
    const padMonth    = pad2(month);
    const startDate   = `${year}-${padMonth}-01`;
    const endDate     = `${year}-${padMonth}-${pad2(days)}`;

    let [employees, logs, allHolidays, leaveMap] = await Promise.all([
      Employees.getAll(),
      Storage.getLogsByDateRange(startDate, endDate),
      Storage.getHolidays(),
      Storage.getLeaveMap(startDate, endDate),
    ]);
    if (deptFilter) employees = employees.filter(e => e.dept === deptFilter);
    const holidays = allHolidays.filter(h => h.date >= startDate && h.date <= endDate);
    const attMap   = buildAttMap(employees, logs);

    // 해당 월에 출근 기록 또는 휴가가 있는 직원만 표시
    const logEmpIds = new Set(logs.map(l => l.emp_id));
    const leaveEmpIds = new Set(Object.values(leaveMap).map(l => l.emp_id));
    employees = employees.filter(e => logEmpIds.has(e.id) || leaveEmpIds.has(e.id));

    // 전체 요약 집계
    let totalLeave = 0, totalLate = 0, totalAbsent = 0, totalEarly = 0;

    /* 날짜 헤더 */
    const dayHeaders = Array.from({length: 31}, (_, i) => {
      const d = i + 1;
      if (d > days) return `<th class="noday"></th>`;
      const dow = getDow(year, month, d);
      const off = isOffDay(year, month, d, effectiveWs) || isHoliday(year, month, d, holidays);
      return `<th class="${off ? 'wk' : ''}">${d}<br><em>${DOW_KR[dow]}</em></th>`;
    }).join('');

    /* 직원 행 */
    const empRows = employees.map((emp, idx) => {
      const att     = attMap[emp.id] || {};
      const empWs   = getEmpWs(emp, effectiveWs);
      const summary = calcSummary(emp, attMap, year, month, empWs, holidays, leaveMap);

      totalLeave  += summary.leaveCount;
      totalLate   += summary.late;
      totalAbsent += summary.absent;
      totalEarly  += summary.earlyLeave;

      const dayCells = Array.from({length: 31}, (_, i) => {
        const d = i + 1;
        if (d > days) return `<td class="noday"></td>`;
        if (!isActive(emp, year, month, d)) return `<td class="nohire"></td>`;
        if (isHoliday(year, month, d, holidays))
          return `<td class="holiday"><span class="hol">${holidayName(year, month, d, holidays)}</span></td>`;
        if (isOffDay(year, month, d, empWs)) return `<td class="wk"></td>`;

        const leave = leaveMap[`${emp.id}_${ds(year, month, d)}`];
        if (leave?.type === '휴가') return `<td class="holiday"><span class="lv-full">休가</span></td>`;

        const adjWs = leave ? (Attendance.getAdjustedWs(empWs, leave) || empWs) : empWs;
        const rec = att[d];
        if (rec?.in) {
          const isLate = lateMin(rec.in, adjWs) > 0;
          let badge = '';
          if (leave?.type === '반차')   badge = '<span class="lv-half">半</span>';
          if (leave?.type === '반반차') badge = '<span class="lv-qtr">¼</span>';
          return `<td class="att">${badge}<span class="chk${isLate ? ' late' : ''}">${isLate ? '▲' : '○'}</span><span class="tin">${rec.in}</span></td>`;
        }
        if (leave) {
          if (leave.type === '반차')   return `<td class="att"><span class="lv-half">半</span></td>`;
          if (leave.type === '반반차') return `<td class="att"><span class="lv-qtr">¼</span></td>`;
          if (leave.type === '조퇴')   return `<td class="abs">×</td>`;
        }
        return `<td class="abs">×</td>`;
      }).join('');

      const extCells = Array.from({length: 31}, (_, i) => {
        const d = i + 1;
        if (d > days) return `<td class="noday"></td>`;
        if (!isActive(emp, year, month, d)) return `<td class="nohire"></td>`;
        if (isHoliday(year, month, d, holidays)) return `<td class="holiday"></td>`;
        if (isOffDay(year, month, d, empWs)) return `<td class="wk"></td>`;

        const leave = leaveMap[`${emp.id}_${ds(year, month, d)}`];
        if (leave?.type === '휴가') return `<td class="holiday"></td>`;

        const adjWs = leave ? (Attendance.getAdjustedWs(empWs, leave) || empWs) : empWs;
        const rec = att[d];
        if (!rec?.out) return `<td></td>`;

        const outMin  = toMin(rec.out);
        const endMin  = toMin(adjWs.end);
        const diffMin = outMin - endMin; // 양수=연장, 음수=조퇴

        // 30분 단위로 반올림 (±30 미만은 표시 안 함)
        const rounded = Math.round(diffMin / 30) * 30;
        if (rounded === 0) return `<td></td>`;

        if (leave?.type === '조퇴') {
          return `<td class="dur"><span class="lv-early">▽조</span></td>`;
        }
        if (rounded > 0) {
          const h = Math.floor(rounded / 60);
          const m = rounded % 60;
          return `<td class="dur"><span class="ext-over">▲${h ? h + ':' : ''}${pad2(m)}</span></td>`;
        } else {
          const abs = Math.abs(rounded);
          const h = Math.floor(abs / 60);
          const m = abs % 60;
          return `<td class="dur"><span class="early">▽${h ? h + ':' : ''}${pad2(m)}</span></td>`;
        }
      }).join('');

      // 비고 자동 생성
      const remarks = [];
      if (summary.leaveCount > 0)  remarks.push(`휴가${summary.leaveCount}`);
      if (summary.halfCount > 0)   remarks.push(`반차${summary.halfCount}`);
      if (summary.quarterCount > 0) remarks.push(`반반차${summary.quarterCount}`);
      if (summary.earlyAuth > 0)   remarks.push(`조퇴${summary.earlyAuth}`);
      const remarkStr = remarks.join(', ');

      const sumWorked = `${summary.worked}${summary.late      > 0 ? `<br><span class="sum-sub">지각:${summary.late}</span>`      : ''}`;
      const sumAbsent = `${summary.absent}${summary.earlyLeave > 0 ? `<br><span class="sum-sub">조퇴:${summary.earlyLeave}</span>` : ''}`;

      return `
        <tr class="mr">
          <td rowspan="2" class="no">${idx + 1}</td>
          <td class="nm">${emp.name}<br><small>${emp.dept || ''}</small></td>
          ${dayCells}
          <td rowspan="2" class="sum">${sumWorked}</td>
          <td rowspan="2" class="sum">${sumAbsent}</td>
          <td rowspan="2" class="etc">${remarkStr}</td>
          <td rowspan="2" class="sig"></td>
        </tr>
        <tr class="er">
          <td class="elb">연장/재외</td>
          ${extCells}
        </tr>`;
    }).join('');

    const legendHTML = `
      <table class="leg">
        <tr><td>출근 ○ / 지각 ▲ / 결근 ×</td><td>1번줄: 출근기호</td></tr>
        <tr><td>▲연장 / ▽조퇴 (30분 단위)</td><td>기준 퇴근시간 대비</td></tr>
        <tr><td>休 / 休가</td><td>공휴일·휴무일 / 연차휴가</td></tr>
        <tr><td>半 / ¼</td><td>반차 / 반반차</td></tr>
        <tr><td>▽조</td><td>인가 조퇴</td></tr>
        <tr><td>비고</td><td>휴가·반차 사용 내역</td></tr>
        <tr><td>근로자서명</td><td>근로자 최종 서명</td></tr>
      </table>`;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${year}년 ${month}월 출근부${deptFilter ? ' — ' + deptFilter : ''}</title>
<style>
@page { size: A4 landscape; margin: 6mm 8mm; }
*     { box-sizing: border-box; margin: 0; padding: 0; }
body  { font-family: 'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif; font-size: 7pt; color: #111; }
.top { overflow: hidden; margin-bottom: 4px; }
.leg { float: right; border: 1px solid #444; border-collapse: collapse; font-size: 6.5pt; line-height: 1.7; }
.leg td { padding: 0 5px; border-bottom: 1px solid #ccc; }
.leg td:first-child { font-weight: bold; border-right: 1px solid #ccc; white-space: nowrap; }
.leg tr:last-child td { border-bottom: none; }
.report-title { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 5px; }
.info-table { border-collapse: collapse; font-size: 7pt; }
.info-table td { padding: 1px 4px; }
.info-table .box { border: 1px solid #555; min-width: 50px; display: inline-block; height: 13px; vertical-align: middle; padding: 0 3px; }
.ym-row { font-size: 7.5pt; font-weight: bold; margin: 3px 0 2px; }
.ym-note { font-size: 6pt; color: #555; margin-left: 8px; }
table.main { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.main th, table.main td { border: 1px solid #555; text-align: center; vertical-align: middle; overflow: hidden; padding: 0; }
.c-no  { width: 6mm; } .c-nm { width: 22mm; } .c-d { width: 7.1mm; }
.c-sum { width: 9mm; } .c-etc { width: 12mm; } .c-sig { width: 10mm; }
thead th { background: #e4e4e4; font-size: 6.5pt; font-weight: bold; height: 10mm; line-height: 1.3; }
thead th em { font-style: normal; font-size: 5.5pt; display: block; }
.wk    { background: #c0c0c0 !important; }
.noday { background: #d8d8d8; border-color: #aaa; }
.nohire { background: repeating-linear-gradient(45deg, #ddd, #ddd 2px, #ebebeb 2px, #ebebeb 8px); border-color: #bbb; }
.holiday { background: #fff0f0 !important; }
.hol { font-size: 6.5pt; font-weight: bold; color: #cc0000; display: block; line-height: 1.3; }
.lv-full { font-size: 6pt; font-weight: bold; color: #cc0000; display: block; line-height: 1.3; }
.lv-half { font-size: 5.5pt; font-weight: bold; color: #0055aa; display: block; line-height: 1; }
.lv-qtr  { font-size: 6pt; font-weight: bold; color: #7733aa; display: block; line-height: 1; }
.lv-early { font-size: 6pt; color: #0055aa; margin-left: 1px; }
tr.mr td { height: 11mm; }
.no { font-size: 6.5pt; }
.nm { font-size: 8pt; font-weight: bold; text-align: left; padding-left: 2px; line-height: 1.3; }
.nm small { font-size: 5.5pt; color: #555; font-weight: normal; display: block; }
.att { position: relative; }
.chk { font-size: 10pt; font-weight: bold; display: block; line-height: 1; }
.chk.late { color: #cc4400; font-size: 9pt; }
.tin { font-size: 5pt; color: #333; display: block; line-height: 1; }
.abs { color: #666; font-size: 9pt; }
tr.er td { height: 6.5mm; background: #fafafa; }
.elb { font-size: 6pt; color: #444; background: #f0f0f0; }
.dur { font-size: 6pt; color: #222; }
.early { font-size: 6pt; color: #0055aa; margin-left: 1px; }
.ext-over { font-size: 6pt; color: #cc4400; font-weight: bold; }
.sum { font-size: 8pt; font-weight: bold; }
.sum-sub { font-size: 5.5pt; color: #555; font-weight: normal; display: block; line-height: 1.4; }
.etc { font-size: 5.5pt; line-height: 1.3; word-break: keep-all; }
tr.mr, tr.er { page-break-inside: avoid; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none; } }
</style>
</head>
<body>
<div class="no-print" style="background:#fffbcd; border:1px solid #e0c040; padding:8px 14px; margin-bottom:8px; font-size:9pt; border-radius:4px;">
  <b>인쇄 방법:</b> Ctrl+P → 용지 방향 <b>가로</b> → 여백 <b>없음(최소)</b>
  <button onclick="window.print()" style="margin-left:12px; padding:4px 14px; background:#2563eb; color:white; border:none; border-radius:4px; cursor:pointer; font-size:9pt;">🖨 인쇄 / PDF 저장</button>
</div>
<div class="top">
  ${legendHTML}
  <div class="report-title">${year}년 ${month}월 출근부${deptFilter ? ' (' + deptFilter + ')' : ''}</div>
  <table class="info-table">
    <tr>
      <td>(남/여)</td><td style="padding-left:12px;">작업장 관리자</td>
      <td><span class="box">${companyName || ''}</span></td>
      <td style="padding-left:6px;">확인서명</td><td><span class="box"></span></td>
      <td style="padding-left:16px;">총인원수</td><td><span class="box">${employees.length}명</span></td>
      <td style="padding-left:6px;">인원MD</td><td><span class="box"></span></td>
    </tr>
    <tr><td colspan="5"></td><td style="padding-left:16px;">휴가</td><td><span class="box">${totalLeave || ''}</span></td><td style="padding-left:6px;">결근</td><td><span class="box">${totalAbsent || ''}</span></td></tr>
    <tr><td colspan="5"></td><td style="padding-left:16px;">지각</td><td><span class="box">${totalLate || ''}</span></td><td style="padding-left:6px;">조퇴</td><td><span class="box">${totalEarly || ''}</span></td></tr>
  </table>
</div>
<div class="ym-row">
  년월: ${year}-${padMonth}
  <span class="ym-note">※ 근무기준: ${effectiveWs.start}~${effectiveWs.end} / 지각허용 ${effectiveWs.late_min}분 / 조퇴허용 ${effectiveWs.early_min}분</span>
</div>
<table class="main">
  <colgroup>
    <col class="c-no"><col class="c-nm">
    ${Array.from({length:31}, () => `<col class="c-d">`).join('')}
    <col class="c-sum"><col class="c-sum"><col class="c-etc"><col class="c-sig">
  </colgroup>
  <thead>
    <tr>
      <th>no</th><th>이름</th>
      ${dayHeaders}
      <th>출근<br>일수</th><th>결근<br>일수</th><th>비고</th><th>근로자<br>서명</th>
    </tr>
  </thead>
  <tbody>${empRows}</tbody>
</table>
</body>
</html>`;
  }

  /* ── 공개 API ────────────────────────────────────────────── */
  return {
    async print(year, month, companyName = '', deptFilter = null, ws = null) {
      const html = await generateHTML(year, month, companyName, deptFilter, ws);
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
