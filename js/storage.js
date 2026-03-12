/**
 * storage.js - LocalStorage 저장/읽기 모듈
 * 키 prefix: rfid_
 */
const Storage = (() => {
  const KEYS = {
    employees:      'rfid_employees',
    attendanceLogs: 'rfid_attendance_logs',
    settings:       'rfid_settings',
    holidays:       'rfid_holidays',
    departments:    'rfid_departments',
  };

  const DEFAULT_WS = {
    start:     '09:00',
    end:       '18:00',
    late_min:  0,
    early_min: 0,
    work_days: [1, 2, 3, 4, 5],  // JS getDay() 기준: 0=일, 1=월 … 6=토
  };

  function get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  return {
    // ── 직원 ──────────────────────────────────────────
    getEmployees() {
      return get(KEYS.employees) || [];
    },
    saveEmployees(list) {
      set(KEYS.employees, list);
    },
    findEmployeeByCardId(cardId) {
      return this.getEmployees().find(e => e.card_id === cardId) || null;
    },
    findEmployeeById(id) {
      return this.getEmployees().find(e => e.id === id) || null;
    },

    // ── 출퇴근 기록 ───────────────────────────────────
    getAttendanceLogs() {
      return get(KEYS.attendanceLogs) || [];
    },
    saveAttendanceLogs(logs) {
      set(KEYS.attendanceLogs, logs);
    },
    addAttendanceLog(log) {
      const logs = this.getAttendanceLogs();
      logs.push(log);
      this.saveAttendanceLogs(logs);
      return log;
    },
    getLogsByDate(dateStr) {
      return this.getAttendanceLogs().filter(l => l.timestamp.startsWith(dateStr));
    },
    getLogsByDateRange(startDate, endDate) {
      return this.getAttendanceLogs().filter(l => {
        const d = l.timestamp.slice(0, 10);
        return d >= startDate && d <= endDate;
      });
    },
    getUnsyncedLogs() {
      return this.getAttendanceLogs().filter(l => !l.synced);
    },
    markAsSynced(logIds) {
      const logs = this.getAttendanceLogs();
      const idSet = new Set(logIds);
      logs.forEach(l => { if (idSet.has(l.log_id)) l.synced = true; });
      this.saveAttendanceLogs(logs);
    },

    // ── 일반 설정 ──────────────────────────────────────
    getSettings() {
      return get(KEYS.settings) || {};
    },
    getSetting(key, defaultVal = null) {
      return this.getSettings()[key] ?? defaultVal;
    },
    setSetting(key, value) {
      const s = this.getSettings();
      s[key] = value;
      set(KEYS.settings, s);
    },

    // ── 부서 관리 ──────────────────────────────────────
    /**
     * 부서 목록 반환
     * 부서 객체: { id, name, work_settings: {...}, created_at }
     */
    getDepartments() {
      return get(KEYS.departments) || [];
    },
    saveDepartments(list) {
      set(KEYS.departments, list);
    },
    findDepartmentById(id) {
      return this.getDepartments().find(d => d.id === id) || null;
    },
    findDepartmentByName(name) {
      return this.getDepartments().find(d => d.name === name) || null;
    },
    /** 부서 추가 — 기본 근무 설정 포함 */
    addDepartment(name) {
      const list = this.getDepartments();
      const trimmed = name.trim();
      if (!trimmed) throw new Error('부서명을 입력하세요.');
      if (list.some(d => d.name === trimmed)) throw new Error('이미 존재하는 부서입니다.');
      const nums = list.map(d => parseInt(d.id.replace('DEPT', ''), 10)).filter(n => !isNaN(n));
      const max  = nums.length > 0 ? Math.max(...nums) : 0;
      const dept = {
        id:            `DEPT${String(max + 1).padStart(3, '0')}`,
        name:          trimmed,
        work_settings: { ...DEFAULT_WS },
        created_at:    new Date().toISOString(),
      };
      list.push(dept);
      this.saveDepartments(list);
      return dept;
    },
    removeDepartment(id) {
      this.saveDepartments(this.getDepartments().filter(d => d.id !== id));
    },

    // ── 부서별 근무 설정 ────────────────────────────────
    /** 해당 부서의 근무 설정 반환 (없으면 기본값) */
    getDeptWorkSettings(deptId) {
      const dept = this.findDepartmentById(deptId);
      return dept?.work_settings ? { ...DEFAULT_WS, ...dept.work_settings } : { ...DEFAULT_WS };
    },
    /** 해당 부서의 근무 설정 저장 */
    saveDeptWorkSettings(deptId, settings) {
      const list = this.getDepartments();
      const idx  = list.findIndex(d => d.id === deptId);
      if (idx === -1) return;
      list[idx].work_settings = settings;
      this.saveDepartments(list);
    },

    // ── 연휴 / 휴무일 (공용) ────────────────────────────
    getHolidays() {
      return get(KEYS.holidays) || [];
    },
    saveHolidays(list) {
      set(KEYS.holidays, list);
    },
    addHoliday(date, name = '') {
      const list = this.getHolidays();
      if (list.some(h => h.date === date)) return;
      list.push({ date, name });
      list.sort((a, b) => a.date.localeCompare(b.date));
      this.saveHolidays(list);
    },
    removeHoliday(date) {
      this.saveHolidays(this.getHolidays().filter(h => h.date !== date));
    },
    isHoliday(dateStr) {
      return this.getHolidays().some(h => h.date === dateStr);
    },

    // ── 개발/관리 ─────────────────────────────────────
    clearAll() {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    },
  };
})();
