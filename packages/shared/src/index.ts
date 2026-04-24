// Общие типы и константы для frontend и backend
export const QUEUE_PRIORITY_LABELS: Record<string, string> = {
  EMERGENCY: 'Экстренный',
  INPATIENT: 'Стационарный',
  SCHEDULED: 'Записанный',
  WALK_IN: 'Живая очередь',
};

export const PATIENT_CATEGORY_LABELS: Record<string, string> = {
  PAID_ONCE: 'Платный (разовый)',
  PAID_CONTRACT: 'Платный (договор)',
  OSMS: 'ОСМС',
  CONTINGENT: 'Контингент',
  EMPLOYEE: 'Сотрудник',
};

export const USER_ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  REGISTRAR: 'Регистратор',
  CALL_CENTER: 'Колл-центр',
  DOCTOR: 'Врач',
  DEPARTMENT_HEAD: 'Заведующий отделением',
  DIRECTOR: 'Руководитель',
};
