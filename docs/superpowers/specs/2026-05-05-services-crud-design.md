# Services CRUD — Design Spec

**Date:** 2026-05-05
**Scope:** Subproject 1 — Service catalog + doctor assignment + service field on queue entry + timer in doctor view. Slot-based booking is explicitly out of scope.

---

## Goal

Allow admins and department heads to maintain a catalog of medical services, assign services to individual doctors, require service selection when registering a patient in the queue, and show elapsed-time timers in the doctor's view.

---

## Data Model

### New model: `Service`

```prisma
model Service {
  id              String          @id @default(cuid())
  name            String
  description     String?
  durationMinutes Int
  paymentCategory PatientCategory
  isActive        Boolean         @default(true)

  doctors      DoctorService[]
  queueEntries QueueEntry[]

  @@map("services")
}
```

### New join table: `DoctorService`

```prisma
model DoctorService {
  doctorId  String
  serviceId String
  doctor    User    @relation(fields: [doctorId], references: [id], onDelete: Cascade)
  service   Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@id([doctorId, serviceId])
  @@map("doctor_services")
}
```

### Modified model: `QueueEntry`

Add two new fields:

```prisma
serviceId  String?
service    Service?  @relation(fields: [serviceId], references: [id])
startedAt  DateTime?
```

- `serviceId` — nullable at DB level for backward compatibility with existing records; required at the tRPC layer when creating new entries.
- `startedAt` — set to `now()` when entry status transitions to `IN_PROGRESS`.

### Modified model: `User`

Add relation back-reference:

```prisma
doctorServices DoctorService[]
```

---

## Backend

### New file: `apps/backend/src/modules/services/services.router.ts`

Exported as `createServicesRouter(trpc, prisma)`. Registered in `trpc.router.ts` as `services`.

**Access control:** All mutating procedures require `ADMIN` or `DEPARTMENT_HEAD` role. Read procedures (`getAll`, `getForDoctor`) are available to all authenticated users.

**Procedures:**

| Procedure | Input | Description |
|-----------|-------|-------------|
| `getAll` | `{ includeInactive?: boolean }` | Returns all services; inactive excluded by default |
| `create` | `{ name, description?, durationMinutes, paymentCategory }` | Creates a service |
| `update` | `{ id, name?, description?, durationMinutes?, paymentCategory?, isActive? }` | Updates a service |
| `delete` | `{ id }` | Deletes a service; throws if linked to any QueueEntry |
| `assignToDoctor` | `{ doctorId, serviceId }` | Creates DoctorService row (idempotent — no error if already exists) |
| `removeFromDoctor` | `{ doctorId, serviceId }` | Deletes DoctorService row |
| `getForDoctor` | `{ doctorId, paymentCategory? }` | Returns doctor's services, optionally filtered by paymentCategory |

### Modified: `apps/backend/src/modules/queue/queue.router.ts`

- **`create` procedure** — add `serviceId: z.string()` as required input field. Persist to QueueEntry.
- **`callNext` / `callSpecific` / `arrive`** — when transitioning to `IN_PROGRESS`, set `startedAt: new Date()`.
- **`getByDoctor`** — include `service { id, name, durationMinutes }` in Prisma query.

### Migration

Single Prisma migration covering:
- Create `services` table
- Create `doctor_services` table
- Add `serviceId String?` to `queue_entries`
- Add `startedAt DateTime?` to `queue_entries`
- Add `DoctorService[]` relation to `User` model

---

## Frontend

### New files

**`apps/frontend/src/components/admin/ServicesTab.tsx`**
- Table: name, duration (min), payment category, status (active/inactive)
- Admin/DepartmentHead only: Create, Edit, Deactivate buttons
- Uses `ServiceDialog` for create/edit

**`apps/frontend/src/components/admin/ServiceDialog.tsx`**
- Fields: name (text), description (textarea, optional), durationMinutes (number), paymentCategory (select), isActive (checkbox, edit-only)
- On save: calls `services.create` or `services.update`

### Modified files

**`apps/frontend/src/components/AdminPanel.tsx`**
- Add `ServicesTab` as new tab `"services"` (label: "Услуги"), visible to ADMIN and DEPARTMENT_HEAD

**`apps/frontend/src/components/admin/UserDialog.tsx`**
- In doctor edit form, add "Услуги врача" section:
  - List of currently assigned services with × remove button (calls `services.removeFromDoctor`)
  - Dropdown to add a service from catalog (calls `services.assignToDoctor`)

**Registrar queue creation form** (wherever `queue.create` is called):
- After doctor and payment category are selected, load `services.getForDoctor({ doctorId, paymentCategory })`
- Show service select dropdown (required)
- Pass `serviceId` to `queue.create`

**`apps/frontend/src/components/doctor/CurrentPatientCard.tsx`**
- Add elapsed-time timer component (updates every second via `setInterval`)
- Displays `{elapsed} / {durationMinutes} мин`
- Color: green (< 80% elapsed), yellow (80–100%), red (> 100%)
- Timer start time: `entry.startedAt` (falls back to `entry.updatedAt` if null)

**`apps/frontend/src/components/doctor/DoctorQueueList.tsx`**
- For IN_PROGRESS entries: show compact timer `{elapsed}/{duration}м` next to status pill
- Same color logic as CurrentPatientCard

---

## Timer Logic

```
elapsed = Math.floor((now - startedAt) / 60_000)  // in minutes
pct = elapsed / service.durationMinutes
color = pct < 0.8 ? 'green' : pct <= 1.0 ? 'yellow' : 'red'
```

Timer component re-renders every 30 seconds (sufficient precision for minute-level display).

---

## Error Handling

- `services.delete` — throws `CONFLICT` if service has linked QueueEntry records. Frontend shows toast error.
- `services.assignToDoctor` — idempotent (uses `upsert` or checks existence first).
- `queue.create` — throws `BAD_REQUEST` if `serviceId` is not in doctor's service list.
- `services.getForDoctor` with `paymentCategory` filter — returns empty array (not error) if no matching services.

---

## Out of Scope

- Slot-based booking / availability calendar
- Service pricing
- Service-level reporting / statistics
