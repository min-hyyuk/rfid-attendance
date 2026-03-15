/**
 * attendance.js - 출퇴근 판별 로직 (async)
 *
 * 판별 규칙:
 *   오늘 출근 기록 없음          → ✅ 출근 처리
 *   오늘 출근만 있음             → ✅ 퇴근 처리
 *   오늘 출근 + 퇴근 모두 있음   → ⚠️ 이미 퇴근 완료 알림
 *
 * 로그 ID 형식: LOG20260312001
 *
 * ws (근무 설정) 는 부서별로 다를 수 있으므로 외부에서 주입받음.
 * 미전달 시 기본값 사용.
 */
const Attendance = (() => {
  const DEFAULT_WS = {
    start: '09:00', end: '18:00',
    late_min: 0, early_min: 0,
    work_days: [1, 2, 3, 4, 5],
  };

  async function generateLogId() {
    const today     = todayStr();
    const dateStr   = today.replace(/-/g, '');
    const todayLogs = await Storage.getLogsByDate(today);
    const count     = todayLogs.filter(l => l.log_id.startsWith('LOG' + dateStr)).length;
    return `LOG${dateStr}${String(count + 1).padStart(3, '0')}`;
  }

  function toLocalISOString(date) {
    const y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${M}-${d}T${h}:${m}:${s}`;
  }

  function todayStr() {
    return toLocalISOString(new Date()).slice(0, 10);
  }

  function timeStr(timestamp) {
    return timestamp.slice(11, 19); // HH:MM:SS
  }

  function toMin(t) {
    const [h, m] = t.slice(0, 5).split(':').map(Number);
    return h * 60 + m;
  }

  function calcLateMin(checkInTime, ws) {
    if (!checkInTime) return 0;
    return Math.max(0, toMin(checkInTime) - (toMin(ws.start) + (ws.late_min || 0)));
  }

  function calcEarlyLeaveMin(checkOutTime, ws) {
    if (!checkOutTime) return 0;
    return Math.max(0, (toMin(ws.end) - (ws.early_min || 0)) - toMin(checkOutTime));
  }

  function calcDuration(inTime, outTime) {
    const diff = toMin(outTime) - toMin(inTime);
    if (diff <= 0) return null;
    return `${Math.floor(diff / 60)}시간 ${diff % 60}분`;
  }

  return {
    /**
     * 카드 태그 처리
     * @param {string} cardId
     * @param {object} [ws]  부서 근무 설정 (미전달 시 기본값 사용)
     */
    async processTag(cardId, ws = null) {
      const effectiveWs = ws || DEFAULT_WS;
      const employee    = await Employees.findByCardId(cardId);

      if (!employee) {
        return { success: false, type: 'unknown', cardId, message: `미등록 카드: ${cardId}` };
      }

      const today    = todayStr();
      const empLogs  = (await Storage.getLogsByDate(today)).filter(l => l.emp_id === employee.id);
      const checkin  = empLogs.find(l => l.type === '출근');
      const checkout = empLogs.find(l => l.type === '퇴근');

      if (checkin && checkout) {
        return {
          success: false, type: 'already_done', employee,
          message: `${employee.name}님은 오늘 이미 퇴근 완료하였습니다.`,
        };
      }

      const type = checkin ? '퇴근' : '출근';
      const now  = new Date();
      const log  = {
        log_id:    await generateLogId(),
        card_id:   cardId,
        emp_id:    employee.id,
        name:      employee.name,
        dept:      employee.dept || '',
        type,
        timestamp: toLocalISOString(now),
        synced:    true,
      };

      await Storage.addAttendanceLog(log);

      const tStr          = timeStr(log.timestamp);
      const lateMin       = type === '출근' ? calcLateMin(tStr, effectiveWs)      : 0;
      const earlyLeaveMin = type === '퇴근' ? calcEarlyLeaveMin(tStr, effectiveWs) : 0;

      return {
        success: true, type, employee, log,
        timeStr: tStr, lateMin, earlyLeaveMin,
        message: `${employee.name} ${type} (${tStr})`,
      };
    },

    /**
     * 오늘 전체 직원 출퇴근 현황
     * @param {string|null} deptFilter  부서명 필터 (null = 전체)
     * @param {object|null} ws          근무 설정
     */
    async getTodayStatus(deptFilter = null, ws = null) {
      const effectiveWs = ws || DEFAULT_WS;
      const today       = todayStr();
      const todayLogs   = await Storage.getLogsByDate(today);

      let employees = await Employees.getAll();
      if (deptFilter) employees = employees.filter(e => e.dept === deptFilter);

      return employees.map(emp => {
        const empLogs  = todayLogs.filter(l => l.emp_id === emp.id);
        const checkin  = empLogs.find(l => l.type === '출근');
        const checkout = empLogs.find(l => l.type === '퇴근');

        let status = 'absent';
        if (checkin && checkout) status = 'left';
        else if (checkin)        status = 'present';

        const checkInTime   = checkin  ? timeStr(checkin.timestamp)  : null;
        const checkOutTime  = checkout ? timeStr(checkout.timestamp) : null;
        const duration      = (checkInTime && checkOutTime)
          ? calcDuration(checkInTime, checkOutTime) : null;
        const lateMin       = checkInTime  ? calcLateMin(checkInTime, effectiveWs)       : 0;
        const earlyLeaveMin = checkOutTime ? calcEarlyLeaveMin(checkOutTime, effectiveWs) : 0;

        return { employee: emp, status, checkInTime, checkOutTime, duration, lateMin, earlyLeaveMin };
      });
    },

    /**
     * 오늘 요약 통계
     * @param {string|null} deptFilter
     * @param {object|null} ws
     */
    async getTodaySummary(deptFilter = null, ws = null) {
      const statuses = await this.getTodayStatus(deptFilter, ws);
      return {
        total:   statuses.length,
        present: statuses.filter(s => s.status === 'present').length,
        left:    statuses.filter(s => s.status === 'left').length,
        absent:  statuses.filter(s => s.status === 'absent').length,
      };
    },

    /**
     * 출퇴근 기록 조회
     * @param {string} startDate  'YYYY-MM-DD'
     * @param {string} endDate    'YYYY-MM-DD'
     * @param {string|null} empId
     * @param {object|null} ws
     */
    async queryLogs(startDate, endDate, empId = null, ws = null) {
      const effectiveWs = ws || DEFAULT_WS;
      let logs = await Storage.getLogsByDateRange(startDate, endDate);
      if (empId) logs = logs.filter(l => l.emp_id === empId);

      const byKey = {};
      logs.forEach(log => {
        const key = `${log.timestamp.slice(0, 10)}_${log.emp_id}`;
        if (!byKey[key]) {
          byKey[key] = {
            date: log.timestamp.slice(0, 10),
            emp_id: log.emp_id, name: log.name,
            dept: log.dept || '',
            checkIn: null, checkOut: null, duration: null,
            lateMin: 0, earlyLeaveMin: 0, synced: true,
          };
        }
        if (log.type === '출근') byKey[key].checkIn  = timeStr(log.timestamp);
        if (log.type === '퇴근') byKey[key].checkOut = timeStr(log.timestamp);
      });

      const rows = Object.values(byKey);
      rows.forEach(r => {
        if (r.checkIn && r.checkOut) r.duration = calcDuration(r.checkIn, r.checkOut);
        r.lateMin       = r.checkIn  ? calcLateMin(r.checkIn, effectiveWs)       : 0;
        r.earlyLeaveMin = r.checkOut ? calcEarlyLeaveMin(r.checkOut, effectiveWs) : 0;
      });

      return rows.sort((a, b) => b.date.localeCompare(a.date));
    },

    /** CSV 내보내기 (동기) */
    exportCSV(rows) {
      const header = '날짜,이름,부서,출근,퇴근,근무시간,지각(분),조퇴(분)';
      const lines  = rows.map(r =>
        `${r.date},${r.name},${r.dept},${r.checkIn || ''},${r.checkOut || ''},${r.duration || ''},${r.lateMin || ''},${r.earlyLeaveMin || ''}`
      );
      return [header, ...lines].join('\n');
    },
  };
})();
