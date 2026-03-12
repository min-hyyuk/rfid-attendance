/**
 * storage.js - LocalStorage 저장/읽기 모듈
 * 키 prefix: rfid_
 */
const Storage = (() => {
  const KEYS = {
    employees:      'rfid_employees',
    attendanceLogs: 'rfid_attendance_logs',
    settings:       'rfid_settings',
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
    /** dateStr: 'YYYY-MM-DD' */
    getLogsByDate(dateStr) {
      return this.getAttendanceLogs().filter(l => l.timestamp.startsWith(dateStr));
    },
    /** startDate, endDate: 'YYYY-MM-DD' */
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

    // ── 설정 ──────────────────────────────────────────
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

    // ── 개발/관리 ─────────────────────────────────────
    clearAll() {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    },
  };
})();
