/**
 * Нормализует телефон к формату +7XXXXXXXXXX.
 * Принимает любой ввод: "+7 (901) 234-56-78", "89012345678", "9012345678".
 * Возвращает "" если цифр нет.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const core = digits.startsWith('7') || digits.startsWith('8')
    ? digits.slice(1)
    : digits;
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
