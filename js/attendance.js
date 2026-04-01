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
 * ws (근무 설정) 는 부서별 또는 개인별로 다를 수 있음.
 * 휴가(leaves) 상태에 따라 ws가 자동 조정됨.
 */
const Attendance = (() => {
  const DEFAULT_WS = {
    start: '09:00', end: '18:00',
    late_min: 0, early_min: 0,
    work_days: [1, 2, 3, 4, 5],
    lunch:  { start: '12:00', end: '13:00' },
    breaks: [],
  };

  async function generateLogId() {
    const today     = todayStr();
    const dateStr   = today.replace(/-/g, '');
    const prefix    = 'LOG' + dateStr;
    const todayLogs = await Storage.getLogsByDate(today);
    let maxNum = 0;
    todayLogs.forEach(l => {
      if (l.log_id.startsWith(prefix)) {
        const num = parseInt(l.log_id.slice(prefix.length), 10);
        if (num > maxNum) maxNum = num;
      }
    });
    return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
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

  /** 두 시간 범위의 겹치는 분 수 계산 */
  function overlapMin(s1, e1, s2, e2) {
    const start = Math.max(s1, s2);
    const end   = Math.min(e1, e2);
    return Math.max(0, end - start);
  }

  /** 점심+휴게 시간 중 실제 근무 구간과 겹치는 총 분 */
  function calcBreakMin(inMin, outMin, ws) {
    let total = 0;
    if (ws.lunch && ws.lunch.start && ws.lunch.end) {
      total += overlapMin(inMin, outMin, toMin(ws.lunch.start), toMin(ws.lunch.end));
    }
    if (ws.breaks && ws.breaks.length > 0) {
      ws.breaks.forEach(b => {
        if (b.start && b.end) {
          total += overlapMin(inMin, outMin, toMin(b.start), toMin(b.end));
        }
      });
    }
    return total;
  }

  /** 실 근로시간 계산 (점심/휴게 제외, 조기출근 cap) */
  function calcDuration(inTime, outTime, ws) {
    let inMin  = toMin(inTime);
    const outMin = toMin(outTime);
    // 출근시간이 근무 시작보다 빠르면 근무 시작 시간으로 cap
    if (ws && toMin(ws.start) > inMin) {
      inMin = toMin(ws.start);
    }
    const raw = outMin - inMin;
    if (raw <= 0) return null;
    const breakTotal = ws ? calcBreakMin(inMin, outMin, ws) : 0;
    const diff = raw - breakTotal;
    if (diff <= 0) return null;
    return `${Math.floor(diff / 60)}시간 ${diff % 60}분`;
  }

  /**
   * 휴가 유형에 따라 ws를 조정
   * @param {object} ws  원본 근무 설정
   * @param {object} leave  휴가 레코드 (null이면 조정 없음)
   * @returns {object|null}  null이면 출근 불필요 (휴가)
   */
  function getAdjustedWs(ws, leave) {
    if (!leave) return ws;
    switch (leave.type) {
      case '휴가':
        return null; // 출근 불필요
      case '조퇴':
        return { ...ws, early_min: 999 }; // 조퇴 페널티 제거
      case '반차':
        // 오전/오후 구분 없이 기록만 → 지각·조퇴 판정 제거
        return { ...ws, late_min: 999, early_min: 999 };
      case '반반차':
        // 1/4일 사용 → 지각·조퇴 판정 제거
        return { ...ws, late_min: 999, early_min: 999 };
      default:
        return ws;
    }
  }

  return {
    /** ws 조정 (외부에서도 사용 가능) */
    getAdjustedWs,

    /**
     * 카드 태그 처리
     * @param {string} cardId
     * @param {object} [ws]  부서 근무 설정 (미전달 시 기본값 사용)
     */
    async processTag(cardId, ws = null) {
      const effectiveWs = ws || DEFAULT_WS;
      const employee    = await Employees.findByCardId(cardId);

      if (!employee) {
        return { success: false, type: 'unknown', cardId, message: `미등록 카드` };
      }

      return this._processEmployee(employee, effectiveWs);
    },

    /** 수동 출퇴근 등록 (emp_id 기반, 해싱 불필요) */
    async processTagByEmpId(empId, ws = null) {
      const effectiveWs = ws || DEFAULT_WS;
      const employee    = await Employees.findById(empId);
      if (!employee) throw new Error('직원을 찾을 수 없습니다.');
      return this._processEmployee(employee, effectiveWs);
    },

    /** 내부: 직원 객체로 출퇴근 처리 */
    async _processEmployee(employee, deptWs) {
      // 개인 근무설정 적용
      const baseWs = await Storage.getEffectiveWorkSettings(employee, deptWs);

      // 오늘 휴가 확인
      const today = todayStr();
      const leave = await Storage.getLeavesByEmpAndDate(employee.id, today);
      const effectiveWs = getAdjustedWs(baseWs, leave);

      // 휴가인 경우 안내 (태그는 정상 처리)
      const leaveType = leave?.type || null;

      const empLogs  = (await Storage.getLogsByDate(today)).filter(l => l.emp_id === employee.id);
      const checkin  = empLogs.find(l => l.type === '출근');
      const checkout = empLogs.find(l => l.type === '퇴근');

      if (checkin && checkout) {
        return {
          success: false, type: 'already_done', employee, leaveType,
          message: `${employee.name}님은 오늘 이미 퇴근 완료하였습니다.`,
        };
      }

      const type = checkin ? '퇴근' : '출근';
      const now  = new Date();
      const log  = {
        log_id:    await generateLogId(),
        card_id:   employee.card_id,
        emp_id:    employee.id,
        name:      employee.name,
        dept:      employee.dept || '',
        type,
        timestamp: toLocalISOString(now),
        synced:    true,
      };

      await Storage.addAttendanceLog(log);

      const tStr          = timeStr(log.timestamp);
      const wsForCalc     = effectiveWs || baseWs;
      const lateMin       = type === '출근' ? calcLateMin(tStr, wsForCalc)      : 0;
      const earlyLeaveMin = type === '퇴근' ? calcEarlyLeaveMin(tStr, wsForCalc) : 0;

      return {
        success: true, type, employee, log, leaveType,
        timeStr: tStr, lateMin, earlyLeaveMin,
        message: `${employee.name} ${type} (${tStr})`,
      };
    },

    /**
     * 오늘 전체 직원 출퇴근 현황
     * @param {string|null} deptFilter  부서명 필터 (null = 전체)
     * @param {object|null} ws          부서 근무 설정
     */
    async getTodayStatus(deptFilter = null, ws = null) {
      const deptWs    = ws || DEFAULT_WS;
      const today     = todayStr();
      const todayLogs = await Storage.getLogsByDate(today);
      const leaveMap  = await Storage.getLeaveMap(today, today);

      let employees = await Employees.getAll();
      if (deptFilter) employees = employees.filter(e => e.dept === deptFilter);

      return employees.map(emp => {
        const empLogs  = todayLogs.filter(l => l.emp_id === emp.id);
        const checkin  = empLogs.find(l => l.type === '출근');
        const checkout = empLogs.find(l => l.type === '퇴근');
        const leave    = leaveMap[`${emp.id}_${today}`] || null;

        // 개인 ws 적용
        const baseWs     = emp.work_settings ? { ...DEFAULT_WS, ...emp.work_settings } : deptWs;
        const effectiveWs = getAdjustedWs(baseWs, leave);

        let status = 'absent';
        if (leave?.type === '휴가') status = 'leave';
        else if (checkin && checkout) status = 'left';
        else if (checkin)             status = 'present';
        else if (leave)               status = 'leave'; // 반차/반반차/조퇴 등록했는데 아직 미출근이면 leave 표시

        const wsForCalc     = effectiveWs || baseWs;
        const checkInTime   = checkin  ? timeStr(checkin.timestamp)  : null;
        const checkOutTime  = checkout ? timeStr(checkout.timestamp) : null;
        const duration      = (checkInTime && checkOutTime)
          ? calcDuration(checkInTime, checkOutTime, wsForCalc) : null;
        const lateMin       = checkInTime  ? calcLateMin(checkInTime, wsForCalc)       : 0;
        const earlyLeaveMin = checkOutTime ? calcEarlyLeaveMin(checkOutTime, wsForCalc) : 0;

        return { employee: emp, status, checkInTime, checkOutTime, duration, lateMin, earlyLeaveMin, leaveType: leave?.type || null };
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
        leave:   statuses.filter(s => s.status === 'leave').length,
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
      const deptWs = ws || DEFAULT_WS;
      let logs = await Storage.getLogsByDateRange(startDate, endDate);
      if (empId) logs = logs.filter(l => l.emp_id === empId);

      // 휴가 맵 + 직원 맵 로드
      const [leaveMap, allEmps] = await Promise.all([
        Storage.getLeaveMap(startDate, endDate),
        Employees.getAll(),
      ]);
      const empMap = {};
      allEmps.forEach(e => { empMap[e.id] = e; });

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
            leaveType: null,
          };
        }
        if (log.type === '출근') byKey[key].checkIn  = timeStr(log.timestamp);
        if (log.type === '퇴근') byKey[key].checkOut = timeStr(log.timestamp);
      });

      const rows = Object.values(byKey);
      rows.forEach(r => {
        const emp   = empMap[r.emp_id];
        const baseWs = (emp?.work_settings) ? { ...DEFAULT_WS, ...emp.work_settings } : deptWs;
        const leave  = leaveMap[`${r.emp_id}_${r.date}`] || null;
        const adjWs  = getAdjustedWs(baseWs, leave) || baseWs;

        r.leaveType = leave?.type || null;
        if (r.checkIn && r.checkOut) r.duration = calcDuration(r.checkIn, r.checkOut, adjWs);
        r.lateMin       = r.checkIn  ? calcLateMin(r.checkIn, adjWs)       : 0;
        r.earlyLeaveMin = r.checkOut ? calcEarlyLeaveMin(r.checkOut, adjWs) : 0;
      });

      return rows.sort((a, b) => b.date.localeCompare(a.date));
    },

    /** CSV 내보내기 (동기) */
    exportCSV(rows) {
      const header = '날짜,이름,부서,출근,퇴근,근무시간,지각(분),조퇴(분),휴가유형';
      const lines  = rows.map(r =>
        `${r.date},${r.name},${r.dept},${r.checkIn || ''},${r.checkOut || ''},${r.duration || ''},${r.lateMin || ''},${r.earlyLeaveMin || ''},${r.leaveType || ''}`
      );
      return [header, ...lines].join('\n');
    },
  };
})();
