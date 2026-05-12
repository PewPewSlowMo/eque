/**
 * Нормализует телефон к формату +7XXXXXXXXXX.
 * Принимает: "+7 (700) 123-45-67", "77001234567", "7001234567", "+77001234567".
 * Возвращает "" если цифр нет.
 *
 * Срезает код страны (7/8) только когда:
 *  - ввод явно начинается с "+" (международный формат)
 *  - или ровно 11 цифр без "+" (код страны + 10-значный номер)
 * Иначе все цифры считаются локальным номером (KZ: 7XX-XXXXXXX).
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '';

  let core: string;
  if (raw.trimStart().startsWith('+')) {
    // Явный "+" — первая цифра это код страны, срезаем
    core = digits.slice(1);
  } else if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    // 11 цифр без "+": код страны + 10-значный номер
    core = digits.slice(1);
  } else {
    // Локальный номер или частичный ввод — цифры оставляем как есть
    core = digits;
  }

  const ten = core.slice(0, 10);
  return ten.length === 0 ? '' : `+7${ten}`;
}

/**
 * Нормализует ФИО: только кириллица/пробел/дефис/апостроф,
 * каждое кириллическое слово — с заглавной буквы.
 * Вызывать onChange. На blur дополнительно вызвать finalizeFio.
 */
export function normalizeFio(raw: string): string {
  const filtered = raw.replace(/[^А-ЯЁа-яё \-']/g, '');
  return filtered.replace(/[А-ЯЁа-яё]+/g, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
}

/**
 * Финализация ФИО при потере фокуса: trim + схлопывание пробелов.
 */
export function finalizeFio(raw: string): string {
  return normalizeFio(raw.trim().replace(/\s+/g, ' '));
}

/**
 * Только цифры, максимум 12 символов (оставлен для совместимости).
 */
export function normalizeIin(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 12);
}
