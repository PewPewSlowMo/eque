# Doctor Self-Registrar Design

## Goal

Врач с флагом `selfRegister=true` получает в своём рабочем месте вкладку **"Запись"** — полный регистраторский экран, но заблокированный только на себя. Вкладка **"Приём"** — текущий DoctorView — остаётся без изменений.

---

## Архитектура

### Принцип

Добавляем один булев флаг `selfRegister` на модель `User`. Enum `UserRole` не меняется. Все существующие проверки `role === 'DOCTOR'` работают без изменений. Blast radius минимален.

Аналогия: как `DEPT_REGISTRAR` имеет `lockedDeptId` (видит только своё отделение), так врач с `selfRegister=true` получает `lockedDoctorId = user.id` (видит только себя).

---

## База данных

### Изменения в `schema.prisma`

**1. Поле на модели `User`:**
```prisma
selfRegister Boolean @default(false)
```
Миграция аддитивная: `ALTER TABLE "users" ADD COLUMN "self_register" BOOLEAN NOT NULL DEFAULT false`. Существующие данные не затрагиваются.

**2. Новое значение в `QueueSource`:**
```prisma
enum QueueSource {
  REGISTRAR
  CALL_CENTER
  KIOSK
  DOCTOR_SELF  // ← новое: запись врачом к себе
}
```
Позволяет в истории и аналитике различать, кто создал запись.

---

## Backend

### `auth.router.ts`

JWT payload и ответ `login`/`me` расширяются полем `selfRegister`:

```typescript
// JWT sign:
{ userId: user.id, username: user.username, role: user.role, departmentId: user.departmentId, selfRegister: user.selfRegister }

// login и me response:
{ ..., selfRegister: user.selfRegister }
```

Prisma select в `login` и `me` дополняется: `selfRegister: true`.

### `users.router.ts`

Мутации `create` и `update` принимают опциональный параметр `selfRegister: z.boolean().optional()`, сохраняют в БД. Только для роли `DOCTOR` — ограничение на уровне валидации или просто игнорируется для других ролей (флаг не влияет ни на что, кроме фронтенда).

### `trpc.service.ts`

Контекст запроса (`ctx.user`) добавляет `selfRegister: boolean` — берётся из JWT-payload.

---

## Frontend

### `App.tsx`

Роутинг DOCTOR расширяется:

```typescript
case 'DOCTOR':
  return user.selfRegister
    ? <DoctorSelfRegistrarView />
    : <DoctorView />;
```

### Новый компонент `DoctorSelfRegistrarView.tsx`

Оболочка с двумя вкладками. Хранит активную вкладку в локальном state.

```
┌─────────────────────────────────┐
│  [Приём]  [Запись]              │  ← вкладки в шапке Layout
├─────────────────────────────────┤
│  <DoctorView />                 │  ← вкладка "Приём" (без изменений)
│  или                            │
│  <CalendarTab lockedDoctorId=…/>│  ← вкладка "Запись"
└─────────────────────────────────┘
```

Файл: `apps/frontend/src/components/DoctorSelfRegistrarView.tsx`

### `RegistrarView.tsx` — компонент `CalendarTab`

`CalendarTab` принимает новый проп:
```typescript
lockedDoctorId?: string
```

Когда `lockedDoctorId` передан:
- Список врачей фильтруется: `doctors = allDoctors.filter(d => d.id === lockedDoctorId)`
- Левая колонка отделений скрыта (`!isDeptRegistrar && !lockedDoctorId`)
- Поиск врача в шапке таблицы скрыт (незачем, врач один)
- `source` для `addToQueue` = `'DOCTOR_SELF'`

Всё остальное идентично обычной регистратуре: слоты по расписанию, живая очередь, категории пациента, история пациента в правой панели.

### `admin/UserDialog.tsx`

В блоке настроек врача (уже есть `showDoctorCategories = role === 'DOCTOR'`) добавляется чекбокс:

```tsx
{(role === 'DOCTOR' || isDoctor) && (
  <label className="flex items-center gap-2 text-[10px]">
    <input
      type="checkbox"
      checked={selfRegister}
      onChange={e => setSelfRegister(e.target.checked)}
    />
    Режим самозаписи пациентов
  </label>
)}
```

Значение передаётся в мутацию `create`/`update`.

---

## Файлы — полная карта изменений

| Файл | Действие | Что меняется |
|---|---|---|
| `apps/backend/prisma/schema.prisma` | Modify | `selfRegister` на User, `DOCTOR_SELF` в QueueSource |
| `apps/backend/prisma/migrations/…` | Create | Аддитивная миграция |
| `apps/backend/src/modules/auth/auth.router.ts` | Modify | `selfRegister` в JWT и login/me response |
| `apps/backend/src/trpc/trpc.service.ts` | Modify | `selfRegister` в ctx.user |
| `apps/backend/src/modules/users/users.router.ts` | Modify | `selfRegister` в create/update input |
| `apps/frontend/src/App.tsx` | Modify | Роутинг DOCTOR → DoctorSelfRegistrarView если selfRegister |
| `apps/frontend/src/components/DoctorSelfRegistrarView.tsx` | Create | Новый компонент с двумя вкладками |
| `apps/frontend/src/components/RegistrarView.tsx` | Modify | `lockedDoctorId` проп в CalendarTab |
| `apps/frontend/src/components/admin/UserDialog.tsx` | Modify | Чекбокс selfRegister для роли DOCTOR |

---

## Что не меняется

- Enum `UserRole` — не трогаем
- Компонент `DoctorView` — без изменений
- `RegistrarView` для REGISTRAR и DEPT_REGISTRAR — без изменений
- Все бэкенд-проверки `role === 'DOCTOR'` — без изменений
- Существующие данные в БД — не затрагиваются

---

## Edge Cases

- Врач с `selfRegister=true` видит только себя в режиме "Запись" — невозможно записать пациента к другому врачу
- Если врач не имеет расписания — вкладка "Запись" покажет пустой календарь (стандартное поведение RegistrarView)
- Смена флага вступает в силу после следующего логина (JWT обновляется при входе)
