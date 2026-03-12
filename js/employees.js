/**
 * employees.js - 직원 데이터 관리 모듈
 * 직원 ID 형식: EMP001, EMP002, ...
 */
const Employees = (() => {
  /** 다음 직원 ID 생성 (EMP001 형식) */
  function generateId() {
    const list = Storage.getEmployees();
    if (list.length === 0) return 'EMP001';
    const nums = list
      .map(e => parseInt(e.id.replace('EMP', ''), 10))
      .filter(n => !isNaN(n));
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `EMP${String(max + 1).padStart(3, '0')}`;
  }

  return {
    getAll() {
      return Storage.getEmployees();
    },

    findByCardId(cardId) {
      return Storage.findEmployeeByCardId(cardId);
    },

    findById(id) {
      return Storage.findEmployeeById(id);
    },

    /**
     * 직원 추가
     * @param {string} name
     * @param {string} cardId
     * @param {string} dept
     * @param {string} hireDate   'YYYY-MM-DD' 또는 ''
     * @param {string} leaveDate  'YYYY-MM-DD' 또는 ''
     */
    add(name, cardId, dept = '', hireDate = '', leaveDate = '') {
      if (!name || !cardId) throw new Error('이름과 카드 ID는 필수입니다.');

      const dup = this.findByCardId(cardId);
      if (dup) throw new Error(`이미 등록된 카드입니다. (${dup.name})`);

      const emp = {
        id:         generateId(),
        card_id:    cardId.trim(),
        name:       name.trim(),
        dept:       dept.trim(),
        hire_date:  hireDate  || null,
        leave_date: leaveDate || null,
        created_at: new Date().toISOString(),
      };
      const list = Storage.getEmployees();
      list.push(emp);
      Storage.saveEmployees(list);
      return emp;
    },

    /**
     * 직원 정보 수정
     * @param {string} id
     * @param {object} updates  변경할 필드 (hire_date, leave_date 포함 가능)
     */
    update(id, updates) {
      const list = Storage.getEmployees();
      const idx = list.findIndex(e => e.id === id);
      if (idx === -1) throw new Error('직원을 찾을 수 없습니다.');

      if (updates.card_id && updates.card_id !== list[idx].card_id) {
        const dup = this.findByCardId(updates.card_id);
        if (dup) throw new Error(`이미 등록된 카드입니다. (${dup.name})`);
      }

      list[idx] = { ...list[idx], ...updates };
      Storage.saveEmployees(list);
      return list[idx];
    },

    /** 직원 삭제 */
    delete(id) {
      Storage.saveEmployees(Storage.getEmployees().filter(e => e.id !== id));
    },

    isRegistered(cardId) {
      return !!this.findByCardId(cardId);
    },
  };
})();
