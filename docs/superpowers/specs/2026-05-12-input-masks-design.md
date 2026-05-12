# Дизайн: маски ввода и нормализация данных пациента

**Дата:** 2026-05-12  
**Статус:** Утверждён  

## Цель

Унифицировать данные при создании и редактировании пациента: телефон в формате `+7XXXXXXXXXX`, ФИО — кириллица с авто-капитализацией. Заменить поле ИИН на поле Адрес.

---

## Изменения схемы БД

**Модель `Patient` (`prisma/schema.prisma`):**

```diff
- iin     String?  @unique
+ address String?
```

Поле `iin` удаляется вместе с уникальным индексом. Поле `address` добавляется как опциональная строка без ограничений.

Применяется через `prisma db push` (проект использует push вместо migrate).

---

## Архитектура

Нормализация — два независимых слоя:

| Слой | Назначение |
|------|-----------|
| Фронтенд (`inputNormalizers.ts`) | UX: исправляет ввод в реальном времени |
| Бэкенд (zod-схемы) | Целостность: отклоняет невалидные данные |

---

## Фронтенд

### Новый файл `src/lib/inputNormalizers.ts`

Три чистые функции без побочных эффектов:

**`normalizePhone(raw: string): string`**
- Стрипает всё кроме цифр
- Убирает ведущую `7` или `8` если есть
- Берёт первые 10 цифр
- Возвращает `"+7" + digits` (итого 12 символов)
- Примеры:
  - `"89012345678"` → `"+79012345678"`
  - `"+7 (901) 234-56-78"` (paste) → `"+79012345678"`
  - `"9012345678"` → `"+79012345678"`
  - `""` → `""`

**`normalizeFio(raw: string): string`**
- Разрешённые символы: кириллица (А-ЯЁа-яё), пробел, дефис, апостроф
- Все остальные символы (латиница, цифры, спецсимволы) фильтруются при вводе
- Каждое слово: первая буква заглавная, остальные строчные
- `onBlur`: схлопывает множественные пробелы, вызывает `trim()`
- Примеры:
  - `"иВАНОВ"` → `"Иванов"`
  - `"иванов  иван"` (blur) → `"Иванов Иван"`
  - `"Smith"` → фильтруется, вводится пустая строка

**`normalizeIin(raw: string): string`**  
*(оставлен в файле для обратной совместимости, в форме не используется)*
- Только цифры, максимум 12 символов

### Изменения в `PatientSearch.tsx`

**Форма «Новый пациент»:**

| Поле | Тип | Нормализация |
|------|-----|-------------|
| Фамилия * | text | `normalizeFio` on change + trim on blur |
| Имя * | text | `normalizeFio` on change + trim on blur |
| Отчество | text | `normalizeFio` on change + trim on blur |
| Телефон | tel | `normalizePhone` on change |
| Адрес | text | plain, только `trim()` on blur |

Поле ИИН — **удаляется** из формы.

`newPatient` state меняется:
```diff
- { lastName, firstName, middleName, phone, iin }
+ { lastName, firstName, middleName, phone, address }
```

### Поиск пациентов

`patients.search` — убрать поиск по `iin` из OR-условий (поле удалено из БД).

---

## Бэкенд

### `patients.router.ts` — мутации `create` и `update`

```diff
  phone:      z.string()
-               .optional(),
+               .regex(/^\+7\d{10}$/, 'Формат: +7XXXXXXXXXX')
+               .optional(),
- iin:        z.string().optional(),
+ address:    z.string().trim().optional(),
```

`firstName`, `lastName`, `middleName` добавляется `.trim()` к существующим валидаторам.

### `patients.router.ts` — мутация `search`

```diff
  OR: [
    { lastName:  { contains: q, mode: 'insensitive' } },
    { firstName: { contains: q, mode: 'insensitive' } },
    { phone:     { contains: q } },
-   { iin:       { contains: q } },
  ],
```

---

## Что НЕ входит в scope

- Миграция существующих записей (старые данные остаются как есть)
- Маска в формате `+7 (XXX) XXX-XX-XX` (хранится без форматирования)
- Валидация контрольной суммы ИИН
- Редактирование адреса в других формах (AdminPanel, DoctorView и т.д.) — отдельная задача

---

## Затронутые файлы

| Файл | Изменение |
|------|-----------|
| `apps/backend/prisma/schema.prisma` | удалить `iin`, добавить `address` |
| `apps/backend/src/modules/patients/patients.router.ts` | zod-схемы + убрать `iin` из search |
| `apps/frontend/src/lib/inputNormalizers.ts` | **новый файл** |
| `apps/frontend/src/components/registrar/PatientSearch.tsx` | форма + отображение результатов поиска + state |
| `apps/frontend/src/components/RegistrarView.tsx` | заменить `patient.iin` на `patient.address` в карточке |
