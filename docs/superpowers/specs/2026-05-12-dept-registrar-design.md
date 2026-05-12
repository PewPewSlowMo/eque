# DEPT_REGISTRAR Role Design

**Date:** 2026-05-12  
**Status:** Approved  

## Problem

Some departments have their own registration desk that must operate in isolation: they see only their department's doctors and queue, cannot record patients to doctors from other departments, but share the common patient database.

## Solution

Add a new `DEPT_REGISTRAR` role alongside the existing `REGISTRAR`. The role uses the existing `departmentId` field on the User model — no new DB columns required beyond the enum value.

---

## Behaviour Matrix

| Capability | REGISTRAR | DEPT_REGISTRAR |
|---|---|---|
| See doctors | All (switchable filter) | Own department only (locked) |
| Queue tab | All departments | Own department only |
| Record patient | To any doctor | Only to own department's doctors |
| Create / search patients | Yes | Yes (patients are shared) |
| Department switcher | Visible | Hidden |
| allowedCategories config | Yes | Yes (same as REGISTRAR) |

---

## Schema Change

**File:** `apps/backend/prisma/schema.prisma`

Add `DEPT_REGISTRAR` to the `UserRole` enum:

```prisma
enum UserRole {
  ADMIN
  DIRECTOR
  REGISTRAR
  DEPT_REGISTRAR   // ← new
  CALL_CENTER
  DOCTOR
  DEPARTMENT_HEAD
}
```

**Constraint:** A user with role `DEPT_REGISTRAR` must have a non-null `departmentId`. Enforced at the API level (not DB-level).

---

## Backend Changes

### 1. `queue.add` mutation

Before creating a queue entry, validate department access for `DEPT_REGISTRAR`:

```typescript
if (ctx.user.role === 'DEPT_REGISTRAR') {
  const doctor = await prisma.user.findUnique({
    where: { id: input.doctorId },
    select: { departmentId: true },
  });
  if (!doctor || doctor.departmentId !== ctx.user.departmentId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа к этому врачу' });
  }
}
```

### 2. `queue.getAll` query

`getAll` already accepts optional `departmentId`. For `DEPT_REGISTRAR`, override it from the user's token:

```typescript
const effectiveDeptId =
  ctx.user.role === 'DEPT_REGISTRAR'
    ? ctx.user.departmentId          // forced — ignore client-supplied value
    : input.departmentId ?? undefined;
```

Apply `effectiveDeptId` to the existing department filter in the query.

### 3. `users.createUser` / `users.updateUser`

Validate that `departmentId` is provided when role is `DEPT_REGISTRAR`:

```typescript
if (input.role === 'DEPT_REGISTRAR' && !input.departmentId) {
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Для роли DEPT_REGISTRAR необходимо указать отделение',
  });
}
```

### 4. No changes needed

- `queue.getScheduledSlots` / `getScheduledTimes` — per-doctor queries, access restricted by frontend
- `queue.confirmArrival`, `callNext`, `complete`, etc. — operated by doctors from DoctorView
- `schedules.*` — per-doctor, already scoped

---

## Frontend Changes

### `RegistrarView.tsx`

Single detection point at component top:

```typescript
const isDeptRegistrar = user?.role === 'DEPT_REGISTRAR';
const lockedDeptId    = isDeptRegistrar ? (user as any).departmentId : null;
```

**Department filter init:**
```typescript
const [deptFilter, setDeptFilter] = useState(lockedDeptId ?? '');
```

**Department switcher:** hidden when `isDeptRegistrar`:
```tsx
{!isDeptRegistrar && <DepartmentSelect ... />}
```

**Doctor grid:** existing `filteredDoctors` already filters by `deptFilter` — no changes.

**Queue tab query:** pass `departmentId: lockedDeptId ?? deptFilter` — backend will enforce for DEPT_REGISTRAR anyway, but frontend pre-scopes the view.

### `UserDialog.tsx` (AdminPanel)

**Role list:** add entry:
```typescript
{ value: 'DEPT_REGISTRAR', label: 'Регистратор отделения' }
```

**Department field validation:** when selected role is `DEPT_REGISTRAR`, mark department selector as required and show inline error if not selected:
```tsx
{(role === 'DEPT_REGISTRAR' || role === 'DOCTOR' || role === 'DEPARTMENT_HEAD') && (
  <DepartmentSelect required={role === 'DEPT_REGISTRAR'} ... />
)}
```

---

## Migration Plan

1. Add `DEPT_REGISTRAR` to Prisma enum → `prisma migrate dev`
2. Backend enforcement in `queue.add` and `queue.getAll`
3. Backend validation in `createUser` / `updateUser`
4. Frontend: `RegistrarView` locked mode
5. Frontend: `UserDialog` role option + department required validation
6. Manual test: create DEPT_REGISTRAR user, verify isolation

---

## Out of Scope

- Cross-department referrals (patient goes through general registrar)
- DEPT_REGISTRAR seeing other departments' queue even read-only
- Separate UI/screen for DEPT_REGISTRAR (uses same RegistrarView)
