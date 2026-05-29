# DEPT_REGISTRAR Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `DEPT_REGISTRAR` role that sees only its department's doctors and queue, enforced on both backend and frontend.

**Architecture:** Single new enum value in Prisma → backend enforcement in `queue.add` and `queue.getForRegistrar` → frontend locked-sidebar mode in `RegistrarView` → `UserDialog` role option with department required validation.

**Tech Stack:** Prisma (PostgreSQL), NestJS/tRPC, React/Vite, TypeScript

---

## File Map

| File | Change |
|---|---|
| `apps/backend/prisma/schema.prisma` | Add `DEPT_REGISTRAR` to `UserRole` enum |
| `apps/backend/src/modules/queue/queue.router.ts` | Enforce dept in `queue.add`; force dept filter in `queue.getForRegistrar` |
| `apps/backend/src/modules/users/users.router.ts` | Validate `departmentId` required for `DEPT_REGISTRAR` on create/update |
| `apps/frontend/src/contexts/UserContext.tsx` | Add `'DEPT_REGISTRAR'` to role union type |
| `apps/frontend/src/components/RegistrarView.tsx` | Locked dept sidebar + locked `deptFilter` init |
| `apps/frontend/src/components/admin/UserDialog.tsx` | Add role to list; make dept required for `DEPT_REGISTRAR` |

---

## Task 1: Add DEPT_REGISTRAR to Prisma schema and push to DB

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Add enum value**

Open `apps/backend/prisma/schema.prisma`. Find the `UserRole` enum and add `DEPT_REGISTRAR`:

```prisma
enum UserRole {
  ADMIN
  DIRECTOR
  REGISTRAR
  DEPT_REGISTRAR
  CALL_CENTER
  DOCTOR
  DEPARTMENT_HEAD
}
```

- [ ] **Step 2: Push schema to DB**

```bash
cd /home/administrator/projects_danik
docker exec eque-backend sh -c "cd /app/apps/backend && npx prisma db push"
```

Expected output: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Regenerate Prisma client inside container**

```bash
docker exec eque-backend sh -c "cd /app/apps/backend && npx prisma generate"
docker restart eque-backend
```

Wait ~10 seconds then verify:
```bash
docker logs eque-backend --tail 5
```
Expected: WebSocket client connected lines (Nest started).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/prisma/schema.prisma
git commit -m "feat(db): добавлена роль DEPT_REGISTRAR в enum UserRole"
```

---

## Task 2: Backend — enforce department in queue.add

**Files:**
- Modify: `apps/backend/src/modules/queue/queue.router.ts` lines ~102–175

- [ ] **Step 1: Add dept check after doctorService lookup in `queue.add`**

In `queue.router.ts`, find the `add` mutation. After the `doctorService` check (around line 120), add:

```typescript
// Dept-registrar can only book to doctors in their own department
if (ctx.user?.role === 'DEPT_REGISTRAR') {
  const doctor = await prisma.user.findUnique({
    where: { id: input.doctorId },
    select: { departmentId: true },
  });
  if (!doctor || doctor.departmentId !== ctx.user.departmentId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Нет доступа к этому врачу',
    });
  }
}
```

The full block context — place it right after the existing `if (!doctorService)` throw:

```typescript
        if (!doctorService) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Выбранная услуга не назначена этому врачу',
          });
        }

        // Dept-registrar can only book to doctors in their own department
        if (ctx.user?.role === 'DEPT_REGISTRAR') {
          const doctor = await prisma.user.findUnique({
            where: { id: input.doctorId },
            select: { departmentId: true },
          });
          if (!doctor || doctor.departmentId !== ctx.user.departmentId) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Нет доступа к этому врачу',
            });
          }
        }

        // Atomic: compute queue number ...
```

- [ ] **Step 2: Restart backend and verify it compiles**

```bash
docker restart eque-backend && sleep 8 && docker logs eque-backend --tail 5
```

Expected: Nest started, WebSocket lines.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/modules/queue/queue.router.ts
git commit -m "feat(queue): DEPT_REGISTRAR не может записать к врачу чужого отделения"
```

---

## Task 3: Backend — force department filter in queue.getForRegistrar

**Files:**
- Modify: `apps/backend/src/modules/queue/queue.router.ts` — `getForRegistrar` query (~line 541)

- [ ] **Step 1: Override departmentId for DEPT_REGISTRAR**

Find the `getForRegistrar` query. Replace the `if (input.departmentId)` block with:

```typescript
      .query(async ({ ctx, input }) => {
        const where: any = { status: { notIn: TERMINAL_STATUSES as any } };

        if (input.date) {
          const d = new Date(input.date);
          d.setHours(0, 0, 0, 0);
          const next = new Date(d);
          next.setDate(next.getDate() + 1);
          where.OR = [
            { scheduledAt: { gte: d, lt: next } },
            { scheduledAt: null, createdAt: { gte: d, lt: next } },
          ];
        }

        // DEPT_REGISTRAR always sees only their department — ignore client value
        const effectiveDeptId =
          (ctx.user as any)?.role === 'DEPT_REGISTRAR'
            ? (ctx.user as any)?.departmentId
            : input.departmentId ?? undefined;

        if (effectiveDeptId) {
          where.doctor = { departmentId: effectiveDeptId };
        }

        return prisma.queueEntry.findMany({
```

- [ ] **Step 2: Restart backend and verify**

```bash
docker restart eque-backend && sleep 8 && docker logs eque-backend --tail 5
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/modules/queue/queue.router.ts
git commit -m "feat(queue): getForRegistrar принудительно фильтрует по отделению для DEPT_REGISTRAR"
```

---

## Task 4: Backend — validate departmentId required for DEPT_REGISTRAR in users.create/update

**Files:**
- Modify: `apps/backend/src/modules/users/users.router.ts`

- [ ] **Step 1: Add validation in `create` mutation**

In `users.router.ts`, find the `create` mutation handler. After the `ADMIN` role check, add:

```typescript
        if (input.role === 'DEPT_REGISTRAR' && !input.departmentId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Для роли DEPT_REGISTRAR необходимо указать отделение',
          });
        }
```

- [ ] **Step 2: Add validation in `update` mutation**

Find the `update` mutation handler. After the `ADMIN` role check, add the same guard (note: `update` doesn't receive `role` in its input schema — but it receives `departmentId`; we need to load the user's current role to check):

```typescript
        // If clearing departmentId from a DEPT_REGISTRAR — block it
        const existing = await prisma.user.findUnique({
          where: { id: input.id },
          select: { role: true },
        });
        if (
          existing?.role === 'DEPT_REGISTRAR' &&
          (input.departmentId === undefined || input.departmentId === null)
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'DEPT_REGISTRAR должен принадлежать отделению',
          });
        }
```

- [ ] **Step 3: Restart backend and verify**

```bash
docker restart eque-backend && sleep 8 && docker logs eque-backend --tail 5
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/users/users.router.ts
git commit -m "feat(users): валидация — DEPT_REGISTRAR обязан иметь departmentId"
```

---

## Task 5: Frontend — add DEPT_REGISTRAR to UserContext type

**Files:**
- Modify: `apps/frontend/src/contexts/UserContext.tsx`

- [ ] **Step 1: Extend role union**

Find the `role` field type definition (line ~9):

```typescript
  role: 'ADMIN' | 'REGISTRAR' | 'CALL_CENTER' | 'DOCTOR' | 'DEPARTMENT_HEAD' | 'DIRECTOR';
```

Change to:

```typescript
  role: 'ADMIN' | 'REGISTRAR' | 'DEPT_REGISTRAR' | 'CALL_CENTER' | 'DOCTOR' | 'DEPARTMENT_HEAD' | 'DIRECTOR';
```

- [ ] **Step 2: Verify Vite HMR picked it up**

```bash
docker logs eque-frontend --tail 4
```

Expected: HMR update for `UserContext.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/contexts/UserContext.tsx
git commit -m "feat(types): добавлена роль DEPT_REGISTRAR в тип пользователя"
```

---

## Task 6: Frontend — RegistrarView locked department sidebar

**Files:**
- Modify: `apps/frontend/src/components/RegistrarView.tsx`

This is the main component that renders the schedule grid (RegistrarView). It has `deptFilter` state at line ~951. There is also a separate queue-tab component inside the same file with its own `deptFilter` at line ~422.

- [ ] **Step 1: Add locked-mode detection and init in schedule grid section (line ~947)**

Find the main `RegistrarView` function (not `QueueTab`). It starts around line 940 with:
```typescript
  const [patient, setPatient]       = useState<Patient | null>(null);
```

Add two constants right after the `const { user } = useUser();` call (which will be near the top of that function):

```typescript
  const isDeptRegistrar = user?.role === 'DEPT_REGISTRAR';
  const lockedDeptId    = isDeptRegistrar ? (user as any).departmentId ?? '' : null;
```

Then change the `deptFilter` state init (currently line ~951):
```typescript
  const [deptFilter, setDeptFilter] = useState('');
```
to:
```typescript
  const [deptFilter, setDeptFilter] = useState(lockedDeptId ?? '');
```

- [ ] **Step 2: Hide department sidebar for DEPT_REGISTRAR**

Find the department sidebar `<div>` that starts around line 990:
```tsx
      {/* Department sidebar */}
      <div className="shrink-0 border-r border-border flex flex-col bg-slate-50 overflow-y-auto" style={{ width: '150px' }}>
```

Wrap the entire sidebar div with a conditional:
```tsx
      {/* Department sidebar — hidden for dept registrar */}
      {!isDeptRegistrar && (
        <div className="shrink-0 border-r border-border flex flex-col bg-slate-50 overflow-y-auto" style={{ width: '150px' }}>
          {/* ... existing content ... */}
        </div>
      )}
```

- [ ] **Step 3: Lock deptFilter in QueueTab as well**

Find `QueueTab` component inside `RegistrarView.tsx` (around line 415). It has:
```typescript
  const [deptFilter, setDeptFilter] = useState('');
```

Add locked-mode above it:
```typescript
  const isDeptRegistrar = user?.role === 'DEPT_REGISTRAR';
  const lockedDeptId    = isDeptRegistrar ? (user as any).departmentId ?? '' : null;
  const [deptFilter, setDeptFilter] = useState(lockedDeptId ?? '');
```

Then find the department filter `<select>` in QueueTab (around line 468) and wrap it:
```tsx
{!isDeptRegistrar && (
  <select value={deptFilter} onChange={...} ...>
    {/* existing options */}
  </select>
)}
```

Also update the `getForRegistrar` query in QueueTab to pass the effective dept:
```typescript
  { date: dateFilter || undefined, departmentId: lockedDeptId ?? deptFilter || undefined },
```

- [ ] **Step 4: Verify HMR**

```bash
docker logs eque-frontend --tail 4
```

Expected: HMR update for `RegistrarView.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/RegistrarView.tsx
git commit -m "feat(registrar): DEPT_REGISTRAR видит только своё отделение, панель отделений скрыта"
```

---

## Task 7: Frontend — UserDialog add role and dept required validation

**Files:**
- Modify: `apps/frontend/src/components/admin/UserDialog.tsx`

- [ ] **Step 1: Add DEPT_REGISTRAR to ROLES list**

Find the `ROLES` constant (line ~11):
```typescript
const ROLES = [
  { value: 'ADMIN', label: 'Администратор' },
  { value: 'DIRECTOR', label: 'Директор' },
  { value: 'REGISTRAR', label: 'Регистратор' },
  { value: 'CALL_CENTER', label: 'Колл-центр' },
  { value: 'DOCTOR', label: 'Врач' },
  { value: 'DEPARTMENT_HEAD', label: 'Завотделением' },
];
```

Change to:
```typescript
const ROLES = [
  { value: 'ADMIN', label: 'Администратор' },
  { value: 'DIRECTOR', label: 'Директор' },
  { value: 'REGISTRAR', label: 'Регистратор' },
  { value: 'DEPT_REGISTRAR', label: 'Регистратор отделения' },
  { value: 'CALL_CENTER', label: 'Колл-центр' },
  { value: 'DOCTOR', label: 'Врач' },
  { value: 'DEPARTMENT_HEAD', label: 'Завотделением' },
];
```

- [ ] **Step 2: Add frontend validation in handleSubmit**

Find `handleSubmit` function. After the existing validations (around line 143–146), add:

```typescript
    if (role === 'DEPT_REGISTRAR' && (departmentId === NONE_DEPT || !departmentId)) {
      toast.error('Для регистратора отделения необходимо выбрать отделение');
      return;
    }
```

- [ ] **Step 3: Highlight department field when DEPT_REGISTRAR selected**

Find the department `<select>` element (around line 241). It currently looks like:
```tsx
                <select
                  value={departmentId}
                  onChange={e => setDepartmentId(e.target.value)}
                  className={selectClass}
                >
```

Change to show a red border when DEPT_REGISTRAR is selected and no dept is chosen:
```tsx
                <select
                  value={departmentId}
                  onChange={e => setDepartmentId(e.target.value)}
                  className={`${selectClass} ${
                    role === 'DEPT_REGISTRAR' && (departmentId === NONE_DEPT || !departmentId)
                      ? 'border-red-400'
                      : ''
                  }`}
                >
```

- [ ] **Step 4: Verify HMR**

```bash
docker logs eque-frontend --tail 4
```

Expected: HMR update for `UserDialog.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/UserDialog.tsx
git commit -m "feat(admin): роль DEPT_REGISTRAR в UserDialog, валидация отделения"
```

---

## Task 8: Push all commits and manual smoke test

- [ ] **Step 1: Push to remote**

```bash
git push
```

- [ ] **Step 2: Manual smoke test — create DEPT_REGISTRAR user**

1. Log in as ADMIN → AdminPanel → Пользователи → Добавить
2. Выбрать роль «Регистратор отделения»
3. Убедиться что поле «Отделение» подсвечивается красным, кнопка «Создать» не даёт сохранить без отделения
4. Выбрать отделение → сохранить

- [ ] **Step 3: Manual smoke test — verify isolation**

1. Войти под созданным DEPT_REGISTRAR пользователем
2. Убедиться что боковая панель отделений **не отображается**
3. Убедиться что в сетке врачей видны только врачи своего отделения
4. Перейти на вкладку «Очередь» — видны только записи к врачам своего отделения
5. Попробовать записать пациента к врачу своего отделения → должно работать

- [ ] **Step 4: Final commit if any fixes made during smoke test**

```bash
git add -A && git commit -m "fix(dept-registrar): исправления после smoke-теста"
git push
```
