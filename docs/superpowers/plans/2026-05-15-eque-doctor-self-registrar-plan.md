# Doctor Self-Registrar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить флаг `selfRegister` на врача, который даёт ему вкладку "Запись" — полный регистраторский экран, заблокированный только на себя.

**Architecture:** Аддитивное изменение: новое поле `selfRegister Boolean @default(false)` на User, новый source `DOCTOR_SELF` в enum, минимальные правки auth/users backend, новый компонент-обёртка с двумя вкладками на фронтенде. `RegistrarView` получает проп `lockedDoctorId` — когда он задан, показывает только CalendarTab, заблокированный на одного врача.

**Tech Stack:** Prisma + PostgreSQL, NestJS + tRPC, React + Tailwind, Docker

---

## File Map

| Файл | Действие |
|---|---|
| `apps/backend/prisma/schema.prisma` | Modify — `selfRegister` на User, `DOCTOR_SELF` в QueueSource |
| `apps/backend/src/trpc/trpc.service.ts` | Modify — `selfRegister` в AuthUser и verifyToken |
| `apps/backend/src/modules/auth/auth.router.ts` | Modify — `selfRegister` в JWT и login/me response |
| `apps/backend/src/modules/users/users.router.ts` | Modify — `selfRegister` в create/update input |
| `apps/backend/src/modules/queue/queue.router.ts` | Modify — `DOCTOR_SELF` в source enum |
| `apps/frontend/src/contexts/UserContext.tsx` | Modify — `selfRegister?` в AuthUser type |
| `apps/frontend/src/components/RegistrarView.tsx` | Modify — `lockedDoctorId` prop в CalendarTab и RegistrarView, `source` prop в TimePicker |
| `apps/frontend/src/components/admin/UserDialog.tsx` | Modify — чекбокс selfRegister |
| `apps/frontend/src/components/DoctorSelfRegistrarView.tsx` | Create — компонент с вкладками Приём/Запись |
| `apps/frontend/src/App.tsx` | Modify — роутинг DOCTOR с selfRegister |

---

### Task 1: Backend — schema + migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Добавить `selfRegister` в модель User**

В файле `apps/backend/prisma/schema.prisma` после строки `acceptedCategories PatientCategory[]` (строка 76) добавить:

```prisma
model User {
  id         String   @id @default(cuid())
  username   String   @unique
  password   String
  firstName  String
  lastName   String
  middleName String?
  role       UserRole @default(REGISTRAR)
  isActive   Boolean  @default(true)
  specialty  String?
  selfRegister Boolean @default(false)   // ← добавить эту строку

  departmentId String?
  department   Department? @relation(fields: [departmentId], references: [id])

  allowedCategories  PatientCategory[]
  acceptedCategories PatientCategory[]
  // ... остальное без изменений
```

Точечная правка — вставить одну строку `selfRegister Boolean @default(false)` в блок полей User, например после `specialty String?`.

- [ ] **Step 2: Добавить `DOCTOR_SELF` в enum QueueSource**

В том же файле, блок `enum QueueSource` (строки 49-53):

```prisma
enum QueueSource {
  REGISTRAR
  CALL_CENTER
  KIOSK
  DOCTOR_SELF
}
```

- [ ] **Step 3: Запустить миграцию**

```bash
docker exec eque-backend npx prisma migrate dev --name add-self-register
```

Ожидаемый вывод:
```
The following migration(s) have been created and applied from new schema changes:
migrations/
  └─ 20260515......_add_self_register/
    └─ migration.sql
```

- [ ] **Step 4: Проверить содержимое миграции**

```bash
cat apps/backend/prisma/migrations/$(ls apps/backend/prisma/migrations/ | grep add_self_register)/migration.sql
```

Ожидаемый вывод (только аддитивные операции, никаких DROP):
```sql
ALTER TABLE "users" ADD COLUMN "self_register" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "QueueSource" ADD VALUE 'DOCTOR_SELF';
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(schema): selfRegister на User + DOCTOR_SELF в QueueSource"
```

---

### Task 2: Backend — auth: selfRegister в JWT и ответах

**Files:**
- Modify: `apps/backend/src/trpc/trpc.service.ts`
- Modify: `apps/backend/src/modules/auth/auth.router.ts`

- [ ] **Step 1: Добавить `selfRegister` в интерфейс AuthUser**

В `apps/backend/src/trpc/trpc.service.ts`, интерфейс `AuthUser` (строки 9-14):

```typescript
export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  departmentId?: string | null;
  selfRegister?: boolean;
}
```

- [ ] **Step 2: Добавить `selfRegister` в verifyToken**

В том же файле, метод `verifyToken` (строки 36-48):

```typescript
static verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return {
      id: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      departmentId: decoded.departmentId,
      selfRegister: decoded.selfRegister ?? false,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Добавить `selfRegister` в JWT payload и ответы login/me**

В `apps/backend/src/modules/auth/auth.router.ts`:

**Строка 19** — добавить `selfRegister: true` в select при findUnique:
```typescript
const user = await prisma.user.findUnique({
  where: { username: input.username },
  include: { department: { select: { id: true, name: true } } },
});
```
*(findUnique уже возвращает все поля модели, включая новое `selfRegister` — дополнительный select не нужен)*

**Строка 31** — JWT sign, добавить `selfRegister`:
```typescript
const token = jwt.sign(
  { userId: user.id, username: user.username, role: user.role, departmentId: user.departmentId, selfRegister: user.selfRegister },
  JWT_SECRET,
  { expiresIn: JWT_EXPIRES_IN },
);
```

**Строки 37-50** — ответ login, добавить `selfRegister`:
```typescript
return {
  token,
  user: {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    middleName: user.middleName,
    role: user.role,
    departmentId: user.departmentId,
    department: user.department,
    allowedCategories: user.allowedCategories,
    selfRegister: user.selfRegister,
  },
};
```

**Строки 59-69** — ответ me, добавить `selfRegister`:
```typescript
return {
  id: user.id,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  middleName: user.middleName,
  role: user.role,
  departmentId: user.departmentId,
  department: user.department,
  allowedCategories: user.allowedCategories,
  selfRegister: user.selfRegister,
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/trpc/trpc.service.ts apps/backend/src/modules/auth/auth.router.ts
git commit -m "feat(auth): selfRegister в JWT и login/me ответах"
```

---

### Task 3: Backend — users: selfRegister в create/update

**Files:**
- Modify: `apps/backend/src/modules/users/users.router.ts`

- [ ] **Step 1: Добавить selfRegister в input схему create**

В файле `apps/backend/src/modules/users/users.router.ts`, мутация `create` (около строки 26-30):

```typescript
create: trpc.protectedProcedure
  .input(z.object({
    username:           z.string().min(1),
    password:           z.string().min(6),
    firstName:          z.string().min(1),
    lastName:           z.string().min(1),
    middleName:         z.string().optional(),
    role:               z.nativeEnum(UserRole),
    specialty:          z.string().optional(),
    departmentId:       z.string().optional(),
    allowedCategories:  z.array(z.nativeEnum(PatientCategory)).optional(),
    acceptedCategories: z.array(z.nativeEnum(PatientCategory)).optional(),
    selfRegister:       z.boolean().optional(),   // ← добавить
  }))
```

- [ ] **Step 2: Добавить selfRegister в input схему update**

В той же мутации `update` (около строки 48-60):

```typescript
update: trpc.protectedProcedure
  .input(z.object({
    id:                 z.string(),
    firstName:          z.string().min(1).optional(),
    lastName:           z.string().min(1).optional(),
    middleName:         z.string().optional(),
    password:           z.string().min(6).optional(),
    specialty:          z.string().optional(),
    departmentId:       z.string().optional(),
    isActive:           z.boolean().optional(),
    allowedCategories:  z.array(z.nativeEnum(PatientCategory)).optional(),
    acceptedCategories: z.array(z.nativeEnum(PatientCategory)).optional(),
    selfRegister:       z.boolean().optional(),   // ← добавить
  }))
```

Тело мутации `create` уже использует `{ ...input, password: hashed, ... }` — `selfRegister` автоматически попадёт в данные. Для `update` — аналогично, если там spread или явное перечисление полей, добавить `selfRegister: input.selfRegister`.

- [ ] **Step 3: Убедиться что update передаёт selfRegister в prisma.user.update**

Найти `prisma.user.update` в мутации update и проверить, что поле передаётся. Если там явный объект `data: { firstName: ..., ... }`, добавить `...(input.selfRegister !== undefined ? { selfRegister: input.selfRegister } : {})`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/users/users.router.ts
git commit -m "feat(users): selfRegister в create/update"
```

---

### Task 4: Backend — queue: добавить DOCTOR_SELF в source enum

**Files:**
- Modify: `apps/backend/src/modules/queue/queue.router.ts:111`

- [ ] **Step 1: Расширить enum source в мутации add**

Строка 111:
```typescript
// было
source: z.enum(['REGISTRAR', 'CALL_CENTER']),

// стало
source: z.enum(['REGISTRAR', 'CALL_CENTER', 'DOCTOR_SELF']),
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/modules/queue/queue.router.ts
git commit -m "feat(queue): DOCTOR_SELF в допустимых источниках записи"
```

---

### Task 5: Frontend — UserContext type

**Files:**
- Modify: `apps/frontend/src/contexts/UserContext.tsx`

- [ ] **Step 1: Добавить `selfRegister` в интерфейс AuthUser**

В `apps/frontend/src/contexts/UserContext.tsx`, интерфейс `AuthUser` (строки 3-13):

```typescript
export interface AuthUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  role: 'ADMIN' | 'REGISTRAR' | 'DEPT_REGISTRAR' | 'CALL_CENTER' | 'DOCTOR' | 'DEPARTMENT_HEAD' | 'DIRECTOR';
  departmentId?: string;
  department?: { id: string; name: string } | null;
  allowedCategories: string[];
  selfRegister?: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/contexts/UserContext.tsx
git commit -m "feat(frontend): selfRegister в типе AuthUser"
```

---

### Task 6: Frontend — UserDialog: чекбокс selfRegister

**Files:**
- Modify: `apps/frontend/src/components/admin/UserDialog.tsx`

- [ ] **Step 1: Добавить `selfRegister` в Props user**

В интерфейс `Props` (строки 48-63), поле `user`:

```typescript
user?: {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  role: string;
  specialty?: string | null;
  departmentId?: string | null;
  allowedCategories: string[];
  isActive?: boolean;
  selfRegister?: boolean;   // ← добавить
};
```

- [ ] **Step 2: Добавить state `selfRegister`**

После строки `const [acceptedCategories, setAcceptedCategories] = useState<string[]>([]);` (строка 78) добавить:

```typescript
const [selfRegister, setSelfRegister] = useState(false);
```

- [ ] **Step 3: Инициализировать в useEffect**

В `useEffect` (строки 80-93), после `setAcceptedCategories(...)` добавить:

```typescript
setSelfRegister((editUser as any)?.selfRegister ?? false);
```

- [ ] **Step 4: Передать в мутации**

В `update.mutate` (строки 152-163) добавить в объект:
```typescript
selfRegister,
```

В `create.mutate` (строки 165-176) добавить в объект:
```typescript
selfRegister,
```

- [ ] **Step 5: Добавить чекбокс в UI**

В блоке `showDoctorCategories` (после строки 306, конец блока категорий врача), добавить чекбокс:

```tsx
{showDoctorCategories && (
  <div className="pt-1 border-t border-border">
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={selfRegister}
        onChange={e => setSelfRegister(e.target.checked)}
        className="h-3.5 w-3.5 accent-primary"
      />
      <span className="text-xs text-muted-foreground">Режим самозаписи пациентов</span>
    </label>
  </div>
)}
```

Вставить сразу после закрывающего тега блока категорий врача (`</div>` после `</div>` внутри `showDoctorCategories`).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/admin/UserDialog.tsx
git commit -m "feat(admin): чекбокс selfRegister в форме редактирования врача"
```

---

### Task 7: Frontend — RegistrarView: lockedDoctorId prop

**Files:**
- Modify: `apps/frontend/src/components/RegistrarView.tsx`

Этот файл содержит три изменения: `TimePicker` (проп `source`), `CalendarTab` (проп `lockedDoctorId`), `RegistrarView` (проп `lockedDoctorId`).

- [ ] **Step 1: Добавить проп `source` в TimePicker**

В `function TimePicker(...)` (строка 110), расширить пропы:

```typescript
function TimePicker({ doctor, date, takenTimes, availableSlots, patient, category, priority, source: sourceProp, onClose, onBooked }: {
  doctor: any; date: Date; takenTimes: string[]; availableSlots: string[];
  patient: Patient; category: string; priority: string;
  source?: string;
  onClose: () => void; onBooked: () => void;
}) {
```

Строку 127 изменить:
```typescript
// было
const source = (user as any)?.role === 'CALL_CENTER' ? 'CALL_CENTER' : 'REGISTRAR';

// стало
const source = sourceProp ?? ((user as any)?.role === 'CALL_CENTER' ? 'CALL_CENTER' : 'REGISTRAR');
```

- [ ] **Step 2: Добавить проп `lockedDoctorId` в CalendarTab**

Строку 955 изменить:
```typescript
// было
function CalendarTab() {

// стало
function CalendarTab({ lockedDoctorId }: { lockedDoctorId?: string }) {
```

- [ ] **Step 3: Фильтровать doctors по lockedDoctorId**

В `useMemo` для doctors (строки 987-1001), добавить фильтр в начало:

```typescript
const doctors = useMemo(() => {
  let list = allDoctors as any[];
  if (lockedDoctorId) list = list.filter((d: any) => d.id === lockedDoctorId);  // ← добавить
  if (deptFilter) list = list.filter((d: any) => d.departmentId === deptFilter);
  if (doctorFilter.trim()) {
    const q = doctorFilter.trim().toLowerCase();
    list = list.filter((d: any) =>
      `${d.lastName} ${d.firstName} ${d.middleName ?? ''}`.toLowerCase().includes(q)
    );
  }
  list = list.filter((d: any) => {
    const cats: string[] = d.acceptedCategories ?? [];
    return cats.length === 0 || cats.includes(category);
  });
  return list;
}, [allDoctors, lockedDoctorId, deptFilter, doctorFilter, category]);
```

- [ ] **Step 4: Определить source для CalendarTab**

После строки `const [picker, setPicker] = ...` (строка 966) добавить:

```typescript
const calSource = lockedDoctorId ? 'DOCTOR_SELF' : undefined;
```

- [ ] **Step 5: Скрыть колонку отделений и поиск врача когда lockedDoctorId задан**

Строка 1005 — условие показа dept sidebar:
```tsx
// было
{!isDeptRegistrar && (

// стало
{!isDeptRegistrar && !lockedDoctorId && (
```

Строка с `<input ... placeholder="Поиск врача...">` в шапке таблицы — заменить:
```tsx
<th className="text-left border-b border-r border-border bg-slate-50 px-2 py-1"
  style={{ width: 'var(--cal-doc-w, 152px)', minWidth: 'var(--cal-doc-w, 152px)' }}>
  {!lockedDoctorId && (
    <input
      type="text"
      value={doctorFilter}
      onChange={e => setDoctorFilter(e.target.value)}
      placeholder="Поиск врача..."
      className="w-full text-[9px] bg-white border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary/50 placeholder:text-muted-foreground/60"
    />
  )}
</th>
```

- [ ] **Step 6: Передать source в TimePicker**

В вызове `<TimePicker ...>` (строка 1215) добавить проп:
```tsx
<TimePicker
  doctor={picker.doctor} date={picker.date}
  takenTimes={takenTimes as string[]}
  availableSlots={picker.slots}
  patient={patient} category={category} priority={priority}
  source={calSource}
  onClose={() => setPicker(null)}
  onBooked={() => { setPicker(null); setPatient(null); }}
/>
```

- [ ] **Step 7: Добавить проп `lockedDoctorId` в RegistrarView и передать в CalendarTab**

Строка 1229:
```typescript
// было
export function RegistrarView() {

// стало
export function RegistrarView({ lockedDoctorId }: { lockedDoctorId?: string } = {}) {
  // lockedDoctorId: когда задан — показывает только CalendarTab, заблокированный на одного врача
```

Строка 1257 — передать проп и скрыть QueueTab когда lockedDoctorId задан:
```tsx
{/* Tab content */}
<div className="flex-1 overflow-hidden">
  {tab === 'calendar' || lockedDoctorId
    ? <CalendarTab lockedDoctorId={lockedDoctorId} />
    : <QueueTab />}
</div>
```

Также скрыть таб-бар когда `lockedDoctorId` задан (строки 1236-1253):
```tsx
{/* Tab bar — скрыть если lockedDoctorId задан */}
{!lockedDoctorId && (
  <div className="flex items-center border-b border-border bg-white px-4 shrink-0">
    {[
      { key: 'calendar', label: 'Запись пациентов' },
      { key: 'queue',    label: 'Очередь' },
    ].map(t => (
      <button
        key={t.key}
        onClick={() => setTab(t.key as any)}
        className={`text-[10px] font-semibold px-4 py-2.5 border-b-2 transition-colors ${
          tab === t.key
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        {t.label}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/components/RegistrarView.tsx
git commit -m "feat(registrar): lockedDoctorId проп — режим самозаписи врача"
```

---

### Task 8: Frontend — DoctorSelfRegistrarView новый компонент

**Files:**
- Create: `apps/frontend/src/components/DoctorSelfRegistrarView.tsx`

- [ ] **Step 1: Создать файл**

```typescript
import { useState } from 'react';
import { useUser } from '@/contexts/UserContext';
import { DoctorView } from './DoctorView';
import { RegistrarView } from './RegistrarView';

export function DoctorSelfRegistrarView() {
  const { user } = useUser();
  const [tab, setTab] = useState<'reception' | 'register'>('reception');

  if (!user) return null;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-white px-4 shrink-0">
        {[
          { key: 'reception', label: 'Приём' },
          { key: 'register',  label: 'Запись' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`text-[10px] font-semibold px-4 py-2.5 border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'reception'
          ? <DoctorView />
          : <RegistrarView lockedDoctorId={user.id} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/DoctorSelfRegistrarView.tsx
git commit -m "feat(doctor): DoctorSelfRegistrarView — вкладки Приём/Запись"
```

---

### Task 9: Frontend — App.tsx роутинг

**Files:**
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Импортировать DoctorSelfRegistrarView**

В блок импортов (строка 8):
```typescript
import { DoctorView } from '@/components/DoctorView';
import { DoctorSelfRegistrarView } from '@/components/DoctorSelfRegistrarView';  // ← добавить
```

- [ ] **Step 2: Обновить роутинг DOCTOR**

Строка 107:
```typescript
// было
case 'DOCTOR':        return <DoctorView />;

// стало
case 'DOCTOR':        return user.selfRegister ? <DoctorSelfRegistrarView /> : <DoctorView />;
```

- [ ] **Step 3: Commit + push**

```bash
git add apps/frontend/src/App.tsx
git commit -m "feat(app): роутинг DOCTOR → DoctorSelfRegistrarView если selfRegister"
git push
```

---

### Task 10: Smoke test

- [ ] **Step 1: Проверить что контейнер бэкенда работает**

```bash
docker logs eque-backend --tail 20
```

Ожидаемый вывод: нет ошибок, сервер запущен на порту 3000.

- [ ] **Step 2: Проверить что фронтенд компилируется**

```bash
docker logs eque-frontend --tail 20
```

Ожидаемый вывод: нет TypeScript ошибок, Vite успешно собрал.

- [ ] **Step 3: Проверить в браузере**

1. Войти как ADMIN
2. Открыть AdminPanel → Пользователи → выбрать врача → Edit
3. Убедиться что чекбокс "Режим самозаписи пациентов" появился
4. Включить чекбокс → Сохранить
5. Выйти, войти как тот врач
6. Убедиться что в шапке есть вкладки "Приём" и "Запись"
7. Вкладка "Запись" — только этот врач в таблице
8. Вкладка "Приём" — стандартный DoctorView
