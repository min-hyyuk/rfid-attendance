/**
 * employees.js - 직원 데이터 관리 모듈 (async)
 * 직원 ID 형식: EMP001, EMP002, ...
 */
const Employees = (() => {
  /** 다음 직원 ID 생성 (EMP001 형식) */
  async function generateId() {
    const list = await Storage.getEmployees();
    if (list.length === 0) return 'EMP001';
    const nums = list
      .map(e => parseInt(e.id.replace('EMP', ''), 10))
      .filter(n => !isNaN(n));
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `EMP${String(max + 1).padStart(3, '0')}`;
  }

  return {
    async getAll() {
      return Storage.getEmployees();
    },

    async findByCardId(cardId) {
      const hashed = await hashCardId(cardId);
      return Storage.findEmployeeByCardId(hashed);
    },

    async findById(id) {
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
    async add(name, cardId, dept = '', hireDate = '', leaveDate = '') {
      if (!name || !cardId) throw new Error('이름과 카드 ID는 필수입니다.');

      const dup = await this.findByCardId(cardId);
      if (dup) throw new Error(`이미 등록된 카드입니다. (${dup.name})`);

      const emp = {
        id:         await generateId(),
        card_id:    await hashCardId(cardId.trim()),
        name:       name.trim(),
        dept:       dept.trim(),
        hire_date:  hireDate  || null,
        leave_date: leaveDate || null,
        created_at: new Date().toISOString(),
      };
      await Storage.saveEmployees([emp]);
      return emp;
    },

    /**
     * 직원 정보 수정
     * @param {string} id
     * @param {object} updates  변경할 필드
     */
    async update(id, updates) {
      const emp = await this.findById(id);
      if (!emp) throw new Error('직원을 찾을 수 없습니다.');

      if (updates.card_id) {
        const hashedNew = await hashCardId(updates.card_id);
        if (hashedNew !== emp.card_id) {
          const dup = await Storage.findEmployeeByCardId(hashedNew);
          if (dup) throw new Error(`이미 등록된 카드입니다. (${dup.name})`);
        }
        updates.card_id = hashedNew;
      }

      const updated = { ...emp, ...updates };
      await Storage.saveEmployees([updated]);
      return updated;
    },

    /** 직원 삭제 */
    async delete(id) {
      const { error } = await Storage.client.from('employees').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async isRegistered(cardId) {
      return !!(await this.findByCardId(cardId));
    },
  };
})();
