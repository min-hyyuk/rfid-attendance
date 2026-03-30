/**
 * storage.js - Supabase CRUD 모듈 (LocalStorage 완전 대체)
 *
 * 의존: Supabase JS SDK v2 CDN (window.supabase)
 *       config.js (SupabaseConfig 전역 객체)
 *
 * 모든 public 메서드 async / Promise 반환
 */
const Storage = (() => {
  const _db = window.supabase.createClient(SupabaseConfig.url, SupabaseConfig.anonKey);

  const DEFAULT_WS = {
    start:     '09:00',
    end:       '18:00',
    late_min:  0,
    early_min: 0,
    work_days: [1, 2, 3, 4, 5],
    lunch:     { start: '12:00', end: '13:00' },
    breaks:    [],
  };

  /** Supabase 응답에서 data를 추출, error 시 throw */
  function _unwrap({ data, error }, fallback = null) {
    if (error) throw new Error(error.message);
    return data ?? fallback;
  }

  return {

    // ── 직원 ──────────────────────────────────────────

    async getEmployees() {
      return _unwrap(
        await _db.from('employees').select('*').order('id'),
        []
      );
    },

    /** list 배열을 upsert (id 기준) */
    async saveEmployees(list) {
      if (!list || list.length === 0) return;
      return _unwrap(
        await _db.from('employees').upsert(list, { onConflict: 'id' })
      );
    },

    async findEmployeeByCardId(cardId) {
      const { data, error } = await _db
        .from('employees').select('*').eq('card_id', cardId).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    async findEmployeeById(id) {
      const { data, error } = await _db
        .from('employees').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    // ── 출퇴근 기록 ───────────────────────────────────

    async getAttendanceLogs() {
      return _unwrap(
        await _db.from('attendance_logs').select('*').order('timestamp'),
        []
      );
    },

    /** 단건 INSERT — 중복 log_id 충돌 시 자동 재시도 (최대 5회) */
    async addAttendanceLog(log) {
      const MAX_RETRY = 5;
      for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
        const { data, error } = await _db
          .from('attendance_logs')
          .insert({ ...log, synced: true })
          .select()
          .single();
        if (!error) return data;
        // 중복 키 오류(23505)가 아니면 즉시 throw
        if (!error.code || error.code !== '23505') throw new Error(error.message);
        // log_id 재생성 후 재시도
        const prefix = log.log_id.replace(/\d{3}$/, '');
        const curNum = parseInt(log.log_id.slice(-3), 10);
        log.log_id = `${prefix}${String(curNum + attempt + 1).padStart(3, '0')}`;
      }
      throw new Error('출퇴근 기록 저장 실패: 중복 ID 재시도 초과');
    },

    /** dateStr: 'YYYY-MM-DD' — 로컬 시간 기준 해당 날짜 전체 */
    async getLogsByDate(dateStr) {
      const start = dateStr + 'T00:00:00';
      const end   = dateStr + 'T23:59:59';
      return _unwrap(
        await _db.from('attendance_logs').select('*')
          .gte('timestamp', start).lte('timestamp', end).order('timestamp'),
        []
      );
    },

    async getLogsByDateRange(startDate, endDate) {
      const start = startDate + 'T00:00:00';
      const end   = endDate   + 'T23:59:59';
      return _unwrap(
        await _db.from('attendance_logs').select('*')
          .gte('timestamp', start).lte('timestamp', end).order('timestamp'),
        []
      );
    },

    async getUnsyncedLogs() {
      return _unwrap(
        await _db.from('attendance_logs').select('*').eq('synced', false),
        []
      );
    },

    // ── 일반 설정 ──────────────────────────────────────

    async getSettings() {
      const rows = _unwrap(await _db.from('settings').select('*'), []);
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    },

    async getSetting(key, defaultVal = null) {
      const { data, error } = await _db
        .from('settings').select('value').eq('key', key).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? data.value : defaultVal;
    },

    async setSetting(key, value) {
      return _unwrap(
        await _db.from('settings')
          .upsert({ key, value: String(value) }, { onConflict: 'key' })
      );
    },

    // ── 부서 관리 ──────────────────────────────────────

    async getDepartments() {
      return _unwrap(
        await _db.from('departments').select('*').order('id'),
        []
      );
    },

    async findDepartmentById(id) {
      const { data, error } = await _db
        .from('departments').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    async findDepartmentByName(name) {
      const { data, error } = await _db
        .from('departments').select('*').eq('name', name).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    async addDepartment(name) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('부서명을 입력하세요.');
      const dup = await this.findDepartmentByName(trimmed);
      if (dup) throw new Error('이미 존재하는 부서입니다.');

      const list = await this.getDepartments();
      const nums = list
        .map(d => parseInt(d.id.replace('DEPT', ''), 10))
        .filter(n => !isNaN(n));
      const max  = nums.length > 0 ? Math.max(...nums) : 0;

      const dept = {
        id:            `DEPT${String(max + 1).padStart(3, '0')}`,
        name:          trimmed,
        work_settings: { ...DEFAULT_WS },
        created_at:    new Date().toISOString(),
      };
      _unwrap(await _db.from('departments').insert(dept));
      return dept;
    },

    async removeDepartment(id) {
      return _unwrap(await _db.from('departments').delete().eq('id', id));
    },

    // ── 부서별 근무 설정 ────────────────────────────────

    async getDeptWorkSettings(deptId) {
      const dept = await this.findDepartmentById(deptId);
      return dept?.work_settings
        ? { ...DEFAULT_WS, ...dept.work_settings }
        : { ...DEFAULT_WS };
    },

    async saveDeptWorkSettings(deptId, settings) {
      return _unwrap(
        await _db.from('departments')
          .update({ work_settings: settings }).eq('id', deptId)
      );
    },

    // ── 연휴 / 휴무일 ────────────────────────────────────

    async getHolidays() {
      return _unwrap(
        await _db.from('holidays').select('*').order('date'),
        []
      );
    },

    async addHoliday(date, name = '') {
      const { data: existing } = await _db
        .from('holidays').select('date').eq('date', date).maybeSingle();
      if (existing) return;
      return _unwrap(await _db.from('holidays').insert({ date, name }));
    },

    async removeHoliday(date) {
      return _unwrap(await _db.from('holidays').delete().eq('date', date));
    },

    async isHoliday(dateStr) {
      const { data } = await _db
        .from('holidays').select('date').eq('date', dateStr).maybeSingle();
      return !!data;
    },

    // ── 개발 / 관리 ───────────────────────────────────────

    async clearAll() {
      await Promise.all([
        _db.from('attendance_logs').delete().neq('log_id', ''),
        _db.from('employees').delete().neq('id', ''),
        _db.from('departments').delete().neq('id', ''),
        _db.from('holidays').delete().neq('date', ''),
        _db.from('settings').delete().neq('key', ''),
      ]);
    },

    /** Supabase 연결 확인 (ping) */
    async checkConnection() {
      try {
        const { error } = await _db.from('settings').select('key').limit(1);
        return !error;
      } catch { return false; }
    },

    /**
     * UTC → KST 마이그레이션 (1회성)
     * 기존 UTC ISO 문자열(Z 접미사)을 KST 로컬 문자열로 변환
     */
    async migrateUtcToKst() {
      try {
        const migrated = await this.getSetting('utc_to_kst_migrated');
        if (migrated === 'true') return;

        const allLogs = _unwrap(
          await _db.from('attendance_logs').select('*'),
          []
        );
        const utcLogs = allLogs.filter(l =>
          typeof l.timestamp === 'string' && (l.timestamp.endsWith('Z') || l.timestamp.includes('+'))
        );
        if (utcLogs.length > 0) {
          for (const log of utcLogs) {
            const utcDate = new Date(log.timestamp);
            const kst = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
            const y = kst.getFullYear();
            const M = String(kst.getMonth() + 1).padStart(2, '0');
            const d = String(kst.getDate()).padStart(2, '0');
            const h = String(kst.getHours()).padStart(2, '0');
            const m = String(kst.getMinutes()).padStart(2, '0');
            const s = String(kst.getSeconds()).padStart(2, '0');
            const kstStr = `${y}-${M}-${d}T${h}:${m}:${s}`;
            await _db.from('attendance_logs')
              .update({ timestamp: kstStr })
              .eq('log_id', log.log_id);
          }
          console.log(`UTC→KST 마이그레이션 완료: ${utcLogs.length}건`);
        }
        await this.setSetting('utc_to_kst_migrated', 'true');
      } catch (e) {
        console.warn('UTC→KST 마이그레이션 스킵:', e.message);
      }
    },

    /**
     * 카드 ID 해싱 마이그레이션 (1회성)
     * 평문 card_id → SHA-256 해시로 변환
     */
    async migrateCardIdHash() {
      try {
        const migrated = await this.getSetting('card_id_hashed');
        if (migrated === 'true') return;

        // employees 테이블 마이그레이션
        const emps = _unwrap(await _db.from('employees').select('*'), []);
        for (const emp of emps) {
          // 이미 해시된 값(64자 hex)은 건너뜀
          if (emp.card_id && emp.card_id.length !== 64) {
            const hashed = await hashCardId(emp.card_id);
            await _db.from('employees').update({ card_id: hashed }).eq('id', emp.id);
          }
        }

        // attendance_logs 테이블 마이그레이션
        const logs = _unwrap(await _db.from('attendance_logs').select('*'), []);
        for (const log of logs) {
          if (log.card_id && log.card_id.length !== 64) {
            const hashed = await hashCardId(log.card_id);
            await _db.from('attendance_logs').update({ card_id: hashed }).eq('log_id', log.log_id);
          }
        }

        await this.setSetting('card_id_hashed', 'true');
        console.log('카드 ID 해싱 마이그레이션 완료');
      } catch (e) {
        console.warn('카드 ID 해싱 마이그레이션 스킵:', e.message);
      }
    },

    /** Supabase 클라이언트 직접 접근 */
    get client() { return _db; },
  };
})();
