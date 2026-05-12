# Input Masks & Patient Normalisation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Унифицировать данные пациента: маска телефона `+7XXXXXXXXXX`, авто-капитализация ФИО (только кириллица), заменить поле ИИН на Адрес.

**Architecture:** Два независимых слоя — фронтенд нормализует данные при вводе, бэкенд валидирует через zod. Нормализация вынесена в `src/lib/inputNormalizers.ts` (три чистые функции). Schema-изменения через `prisma db push`.

**Tech Stack:** React 18, TypeScript, NestJS, Prisma, zod, pnpm, Docker

---

## Карта файлов

| Файл | Действие |
|------|----------|
| `apps/backend/prisma/schema.prisma` | удалить `iin @unique`, добавить `address String?` |
| `apps/backend/src/modules/patients/patients.router.ts` | zod-схемы + убрать `iin` из search |
| `apps/frontend/src/lib/inputNormalizers.ts` | **создать** |
| `apps/frontend/src/components/registrar/PatientSearch.tsx` | state + form + search results + Patient interface |
| `apps/frontend/src/components/RegistrarView.tsx` | заменить `iin` на `address` в Patient interface и карточке |

---

## Task 1: Схема БД — убрать iin, добавить address

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1.1: Открыть схему и найти модель Patient**

```bash
grep -n "iin\|address" apps/backend/prisma/schema.prisma
```

Ожидаемый вывод: строка вида `iin  String?  @unique`

- [ ] **Step 1.2: Заменить поле iin на address**

В `apps/backend/prisma/schema.prisma` найти в модели `Patient`:
```prisma
iin         String?  @unique
```
Заменить на:
```prisma
address     String?
```

- [ ] **Step 1.3: Применить изменения через prisma db push внутри контейнера**

```bash
docker exec eque-backend sh -c "cd /app/apps/backend && npx prisma db push --accept-data-loss"
```

Флаг `--accept-data-loss` нужен потому что удаляется уникальный индекс и колонка с данными.

Ожидаемый вывод:
```
Your database is now in sync with your Prisma schema.
```

- [ ] **Step 1.4: Регенерировать Prisma Client внутри контейнера**

```bash
docker exec eque-backend sh -c "cd /app/apps/backend && npx prisma generate"
```

Ожидаемый вывод: `Generated Prisma Client ...`

- [ ] **Step 1.5: Перезапустить бэкенд**

```bash
docker restart eque-backend
sleep 8 && docker logs eque-backend --tail 5
```

Ожидаемый вывод: `🚀 Backend: http://localhost:3001`

- [ ] **Step 1.6: Коммит**

```bash
git add apps/backend/prisma/schema.prisma
git commit -m "feat(db): заменить поле iin на address в модели Patient"
```

---

## Task 2: Бэкенд — обновить patients.router.ts

**Files:**
- Modify: `apps/backend/src/modules/patients/patients.router.ts`

- [ ] **Step 2.1: Обновить мутацию `search` — убрать поиск по iin**

В `apps/backend/src/modules/patients/patients.router.ts` найти:
```typescript
      where: {
        OR: [
          { lastName: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { iin: { contains: q } },
        ],
      },
```
Заменить на:
```typescript
      where: {
        OR: [
          { lastName: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
        ],
      },
```

- [ ] **Step 2.2: Обновить мутацию `create` — убрать iin, добавить address, добавить валидацию**

Найти input-схему `create`:
```typescript
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        middleName: z.string().optional(),
        dateOfBirth: z.string().datetime().optional(),
        phone: z.string().optional(),
        iin: z.string().optional(),
        categories: z.array(z.nativeEnum(PatientCategory)).default([]),
        contractNumber: z.string().optional(),
        employeeDepartmentId: z.string().optional(),
      }))
```
Заменить на:
```typescript
      .input(z.object({
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        middleName: z.string().trim().optional(),
        dateOfBirth: z.string().datetime().optional(),
        phone: z.string().regex(/^\+7\d{10}$/, 'Формат: +7XXXXXXXXXX').optional(),
        address: z.string().trim().optional(),
        categories: z.array(z.nativeEnum(PatientCategory)).default([]),
        contractNumber: z.string().optional(),
        employeeDepartmentId: z.string().optional(),
      }))
```

- [ ] **Step 2.3: Обновить мутацию `update` — убрать iin, добавить address, добавить валидацию**

Найти input-схему `update`:
```typescript
      .input(z.object({
        id: z.string(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        middleName: z.string().optional(),
        phone: z.string().optional(),
        iin: z.string().optional(),
        categories: z.array(z.nativeEnum(PatientCategory)).optional(),
        contractNumber: z.string().optional(),
        employeeDepartmentId: z.string().optional(),
      }))
```
Заменить на:
```typescript
      .input(z.object({
        id: z.string(),
        firstName: z.string().trim().min(1).optional(),
        lastName: z.string().trim().min(1).optional(),
        middleName: z.string().trim().optional(),
        phone: z.string().regex(/^\+7\d{10}$/, 'Формат: +7XXXXXXXXXX').optional(),
        address: z.string().trim().optional(),
        categories: z.array(z.nativeEnum(PatientCategory)).optional(),
        contractNumber: z.string().optional(),
        employeeDepartmentId: z.string().optional(),
      }))
```

- [ ] **Step 2.4: Проверить, что бэкенд перекомпилировался без ошибок**

```bash
sleep 5 && docker logs eque-backend --tail 8
```

Ожидаемый вывод: `Found 0 errors. Watching for file changes.`

- [ ] **Step 2.5: Коммит**

```bash
git add apps/backend/src/modules/patients/patients.router.ts
git commit -m "feat(patients): убрать iin, добавить address, валидация телефона +7XXXXXXXXXX"
```

---

## Task 3: Фронтенд — создать inputNormalizers.ts

**Files:**
- Create: `apps/frontend/src/lib/inputNormalizers.ts`

- [ ] **Step 3.1: Создать файл с тремя функциями**

Создать `apps/frontend/src/lib/inputNormalizers.ts`:

```typescript
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
```

- [ ] **Step 3.2: Проверить функции вручную в консоли браузера**

Открыть DevTools → Console на странице приложения. Вставить и выполнить:

```javascript
// Временная проверка (удалить после)
const digits = s => s.replace(/\D/g, '');
const phone = raw => { const d = digits(raw); const c = d.startsWith('7')||d.startsWith('8') ? d.slice(1) : d; const t = c.slice(0,10); return t.length===0?'':'+7'+t; };
console.assert(phone('89012345678') === '+79012345678', 'fail 1');
console.assert(phone('+7 (901) 234-56-78') === '+79012345678', 'fail 2');
console.assert(phone('') === '', 'fail 3');
console.assert(phone('9012345678') === '+79012345678', 'fail 4');
console.log('normalizePhone: OK');
```

Ожидаемый вывод: `normalizePhone: OK`

- [ ] **Step 3.3: Коммит**

```bash
git add apps/frontend/src/lib/inputNormalizers.ts
git commit -m "feat(frontend): добавить утилиты нормализации ФИО и телефона"
```

---

## Task 4: Фронтенд — обновить PatientSearch.tsx

**Files:**
- Modify: `apps/frontend/src/components/registrar/PatientSearch.tsx`

- [ ] **Step 4.1: Добавить импорт нормализаторов**

В начале файла после существующих импортов добавить:
```typescript
import { normalizePhone, normalizeFio, finalizeFio } from '@/lib/inputNormalizers';
```

- [ ] **Step 4.2: Обновить интерфейс Patient — заменить iin на address**

Найти:
```typescript
interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  phone?: string | null;
  iin?: string | null;
}
```
Заменить на:
```typescript
interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  phone?: string | null;
  address?: string | null;
}
```

- [ ] **Step 4.3: Обновить state newPatient — заменить iin на address**

Найти:
```typescript
  const [newPatient, setNewPatient] = useState({
    lastName: '', firstName: '', middleName: '', phone: '', iin: '',
  });
```
Заменить на:
```typescript
  const [newPatient, setNewPatient] = useState({
    lastName: '', firstName: '', middleName: '', phone: '', address: '',
  });
```

- [ ] **Step 4.4: Обновить сброс state в onSuccess и openCreate**

Найти (в onSuccess createMutation):
```typescript
      setNewPatient({ lastName: '', firstName: '', middleName: '', phone: '', iin: '' });
```
Заменить на:
```typescript
      setNewPatient({ lastName: '', firstName: '', middleName: '', phone: '', address: '' });
```

Найти (в функции openCreate):
```typescript
      phone: '', iin: '',
```
Заменить на:
```typescript
      phone: '', address: '',
```

- [ ] **Step 4.5: Обновить отображение результатов поиска — убрать iin**

Найти:
```typescript
              {(p.phone || p.iin) && (
                <div className="text-[8px] text-muted-foreground mt-0.5">
                  {p.iin && <span>{p.iin}</span>}
                  {p.iin && p.phone && <span className="mx-1">·</span>}
                  {p.phone && <span>{p.phone}</span>}
                </div>
              )}
```
Заменить на:
```typescript
              {p.phone && (
                <div className="text-[8px] text-muted-foreground mt-0.5">
                  <span>{p.phone}</span>
                </div>
              )}
```

- [ ] **Step 4.6: Обновить поля формы — добавить нормализаторы и заменить ИИН на Адрес**

Найти блок с полем Фамилия:
```typescript
              <div className="space-y-1">
                <Label>Фамилия *</Label>
                <Input value={newPatient.lastName}
                  onChange={e => setNewPatient(p => ({ ...p, lastName: e.target.value }))} />
              </div>
```
Заменить на:
```typescript
              <div className="space-y-1">
                <Label>Фамилия *</Label>
                <Input value={newPatient.lastName}
                  onChange={e => setNewPatient(p => ({ ...p, lastName: normalizeFio(e.target.value) }))}
                  onBlur={e => setNewPatient(p => ({ ...p, lastName: finalizeFio(e.target.value) }))} />
              </div>
```

Найти блок с полем Имя:
```typescript
              <div className="space-y-1">
                <Label>Имя *</Label>
                <Input value={newPatient.firstName}
                  onChange={e => setNewPatient(p => ({ ...p, firstName: e.target.value }))} />
              </div>
```
Заменить на:
```typescript
              <div className="space-y-1">
                <Label>Имя *</Label>
                <Input value={newPatient.firstName}
                  onChange={e => setNewPatient(p => ({ ...p, firstName: normalizeFio(e.target.value) }))}
                  onBlur={e => setNewPatient(p => ({ ...p, firstName: finalizeFio(e.target.value) }))} />
              </div>
```

Найти блок с полем Отчество:
```typescript
            <div className="space-y-1">
              <Label>Отчество</Label>
              <Input value={newPatient.middleName}
                onChange={e => setNewPatient(p => ({ ...p, middleName: e.target.value }))} />
            </div>
```
Заменить на:
```typescript
            <div className="space-y-1">
              <Label>Отчество</Label>
              <Input value={newPatient.middleName}
                onChange={e => setNewPatient(p => ({ ...p, middleName: normalizeFio(e.target.value) }))}
                onBlur={e => setNewPatient(p => ({ ...p, middleName: finalizeFio(e.target.value) }))} />
            </div>
```

Найти блок с полем Телефон:
```typescript
              <div className="space-y-1">
                <Label>Телефон</Label>
                <Input value={newPatient.phone}
                  onChange={e => setNewPatient(p => ({ ...p, phone: e.target.value }))} />
              </div>
```
Заменить на:
```typescript
              <div className="space-y-1">
                <Label>Телефон</Label>
                <Input value={newPatient.phone}
                  placeholder="+7XXXXXXXXXX"
                  onChange={e => setNewPatient(p => ({ ...p, phone: normalizePhone(e.target.value) }))} />
              </div>
```

Найти блок с полем ИИН (и соседние элементы grid):
```typescript
              <div className="space-y-1">
                <Label>ИИН</Label>
                <Input value={newPatient.iin}
                  onChange={e => setNewPatient(p => ({ ...p, iin: e.target.value }))} />
              </div>
```
Заменить на:
```typescript
              <div className="space-y-1">
                <Label>Адрес</Label>
                <Input value={newPatient.address}
                  onChange={e => setNewPatient(p => ({ ...p, address: e.target.value }))}
                  onBlur={e => setNewPatient(p => ({ ...p, address: e.target.value.trim() }))} />
              </div>
```

- [ ] **Step 4.7: Обновить вызов createMutation.mutate — убрать iin, добавить address**

Найти:
```typescript
            onClick={() => createMutation.mutate({
                lastName: newPatient.lastName,
                firstName: newPatient.firstName,
                middleName: newPatient.middleName || undefined,
                phone: newPatient.phone || undefined,
                iin: newPatient.iin || undefined,
              })}
```
Заменить на:
```typescript
            onClick={() => createMutation.mutate({
                lastName: newPatient.lastName,
                firstName: newPatient.firstName,
                middleName: newPatient.middleName || undefined,
                phone: newPatient.phone || undefined,
                address: newPatient.address || undefined,
              })}
```

- [ ] **Step 4.8: Проверить в UI**

1. Открыть интерфейс регистратора
2. Набрать несуществующее имя в поиске → кликнуть «+ Создать пациента»
3. Убедиться что форма содержит поля Фамилия / Имя / Отчество / Телефон / Адрес (ИИН — отсутствует)
4. Ввести в Фамилию `иВАНОВ` → убедиться что поле показывает `Иванов`
5. Ввести в Телефон `89012345678` → убедиться что поле показывает `+79012345678`
6. Ввести латинскую букву `A` в поле Имя → убедиться что символ не вводится

- [ ] **Step 4.9: Коммит**

```bash
git add apps/frontend/src/components/registrar/PatientSearch.tsx
git commit -m "feat(patient-form): маски ввода ФИО и телефона, заменить ИИН на Адрес"
```

---

## Task 5: Фронтенд — обновить RegistrarView.tsx

**Files:**
- Modify: `apps/frontend/src/components/RegistrarView.tsx`

- [ ] **Step 5.1: Обновить интерфейс Patient в RegistrarView — заменить iin на address**

Найти (около строки 77):
```typescript
  middleName?: string | null; phone?: string | null; iin?: string | null;
```
Заменить на:
```typescript
  middleName?: string | null; phone?: string | null; address?: string | null;
```

- [ ] **Step 5.2: Заменить отображение iin на address в карточке пациента**

Найти (около строки 1031):
```typescript
                {patient.iin && <div className="text-[8px] text-muted-foreground">{patient.iin}</div>}
```
Заменить на:
```typescript
                {patient.address && <div className="text-[8px] text-muted-foreground">{patient.address}</div>}
```

- [ ] **Step 5.3: Проверить в UI**

1. Найти существующего пациента в списке регистратора
2. Убедиться что в карточке не выводится TypeScript-ошибка в консоли
3. Если у пациента заполнен адрес — он отображается; если нет — поле просто скрыто

- [ ] **Step 5.4: Коммит и push**

```bash
git add apps/frontend/src/components/RegistrarView.tsx
git commit -m "fix(registrar): заменить iin на address в карточке пациента"
git push
```
