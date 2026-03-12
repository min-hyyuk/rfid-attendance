/**
 * attendance.js - 출퇴근 판별 로직
 *
 * 판별 규칙 (기획서 §6):
 *   오늘 출근 기록 없음          → ✅ 출근 처리
 *   오늘 출근만 있음             → ✅ 퇴근 처리
 *   오늘 출근 + 퇴근 모두 있음   → ⚠️ 이미 퇴근 완료 알림
 *
 * 로그 ID 형식: LOG20260312001
 */
const Attendance = (() => {
  function generateLogId() {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const todayLogs = Storage.getAttendanceLogs()
      .filter(l => l.log_id.startsWith('LOG' + dateStr));
    const seq = String(todayLogs.length + 1).padStart(3, '0');
    return `LOG${dateStr}${seq}`;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function timeStr(isoString) {
    return isoString.slice(11, 19); // HH:MM:SS
  }

  /** 두 시각(HH:MM:SS) 사이의 근무 시간 문자열 */
  function calcDuration(inTime, outTime) {
    const toMin = t => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const diff = toMin(outTime) - toMin(inTime);
    if (diff <= 0) return null;
    return `${Math.floor(diff / 60)}시간 ${diff % 60}분`;
  }

  return {
    /**
     * 카드 태그 처리
     * @returns {{ success, type, employee?, log?, message }}
     */
    processTag(cardId) {
      const employee = Employees.findByCardId(cardId);

      // 미등록 카드
      if (!employee) {
        return {
          success: false,
          type:    'unknown',
          cardId,
          message: `미등록 카드입니다: ${cardId}`,
        };
      }

      const today    = todayStr();
      const empLogs  = Storage.getLogsByDate(today).filter(l => l.emp_id === employee.id);
      const checkin  = empLogs.find(l => l.type === '출근');
      const checkout = empLogs.find(l => l.type === '퇴근');

      // 이미 퇴근 완료
      if (checkin && checkout) {
        return {
          success:  false,
          type:     'already_done',
          employee,
          message:  `${employee.name}님은 오늘 이미 퇴근 완료하였습니다.`,
        };
      }

      const type = checkin ? '퇴근' : '출근';
      const now  = new Date();
      const log  = {
        log_id:    generateLogId(),
        card_id:   cardId,
        emp_id:    employee.id,
        name:      employee.name,
        type,
        timestamp: now.toISOString(),
        synced:    false,
      };

      Storage.addAttendanceLog(log);

      return {
        success:  true,
        type,
        employee,
        log,
        timeStr:  timeStr(log.timestamp),
        message:  `${employee.name} ${type} (${timeStr(log.timestamp)})`,
      };
    },

    /**
     * 오늘 전체 직원 출퇴근 현황 반환
     */
    getTodayStatus() {
      const today    = todayStr();
      const todayLogs = Storage.getLogsByDate(today);

      return Employees.getAll().map(emp => {
        const empLogs  = todayLogs.filter(l => l.emp_id === emp.id);
        const checkin  = empLogs.find(l => l.type === '출근');
        const checkout = empLogs.find(l => l.type === '퇴근');

        let status = 'absent';
        if (checkin && checkout) status = 'left';
        else if (checkin)        status = 'present';

        const checkInTime  = checkin  ? timeStr(checkin.timestamp)  : null;
        const checkOutTime = checkout ? timeStr(checkout.timestamp) : null;
        const duration     = (checkInTime && checkOutTime)
          ? calcDuration(checkInTime, checkOutTime)
          : null;

        return { employee: emp, status, checkInTime, checkOutTime, duration };
      });
    },

    /** 오늘 요약 통계 */
    getTodaySummary() {
      const statuses = this.getTodayStatus();
      return {
        total:   statuses.length,
        present: statuses.filter(s => s.status === 'present').length,
        left:    statuses.filter(s => s.status === 'left').length,
        absent:  statuses.filter(s => s.status === 'absent').length,
      };
    },

    /**
     * 출퇴근 기록 조회 (기간 + 직원 필터)
     * @param {string} startDate  'YYYY-MM-DD'
     * @param {string} endDate    'YYYY-MM-DD'
     * @param {string|null} empId  null이면 전체
     */
    queryLogs(startDate, endDate, empId = null) {
      let logs = Storage.getLogsByDateRange(startDate, endDate);
      if (empId) logs = logs.filter(l => l.emp_id === empId);

      // 날짜별·직원별로 출근/퇴근 쌍 구성
      const byKey = {};
      logs.forEach(log => {
        const key = `${log.timestamp.slice(0, 10)}_${log.emp_id}`;
        if (!byKey[key]) {
          byKey[key] = {
            date:       log.timestamp.slice(0, 10),
            emp_id:     log.emp_id,
            name:       log.name,
            dept:       Employees.findById(log.emp_id)?.dept || '',
            checkIn:    null,
            checkOut:   null,
            duration:   null,
            synced:     true,
          };
        }
        if (log.type === '출근') byKey[key].checkIn  = timeStr(log.timestamp);
        if (log.type === '퇴근') byKey[key].checkOut = timeStr(log.timestamp);
        if (!log.synced) byKey[key].synced = false;
      });

      const rows = Object.values(byKey);
      rows.forEach(r => {
        if (r.checkIn && r.checkOut)
          r.duration = calcDuration(r.checkIn, r.checkOut);
      });

      // 날짜 내림차순 정렬
      return rows.sort((a, b) => b.date.localeCompare(a.date));
    },

    /** CSV 내보내기 문자열 생성 */
    exportCSV(rows) {
      const header = '날짜,이름,부서,출근,퇴근,근무시간';
      const lines  = rows.map(r =>
        `${r.date},${r.name},${r.dept},${r.checkIn || ''},${r.checkOut || ''},${r.duration || ''}`
      );
      return [header, ...lines].join('\n');
    },
  };
})();
