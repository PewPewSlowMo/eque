# Self-Service Kiosk Design

## Overview

A tablet-facing self-service kiosk that allows patients to join a walk-in queue without a registrar. Designed initially for the blood draw room; configurable for any doctor/service via the admin panel.

**Core flow:** Patient approaches tablet → taps "Встать в очередь" → enters last name, first name, patronymic via on-screen keyboard → receives queue number → screen auto-resets.

---

## Architecture

### Approach

Slug-based public module following the existing `display` pattern (`display.getBoard` is already a public tRPC procedure). A new `Kiosk` DB model stores configuration. Two public (unauthenticated) tRPC procedures handle config lookup and queue entry creation. The frontend serves `/kiosk/:slug` as a public route requiring no login.

### Tech Stack

- **Backend:** NestJS + tRPC (new `kiosk` module), Prisma
- **Frontend:** React + Vite + Tailwind, new `KioskPage` component
- **Realtime:** Existing WebSocket `queue:updated` event — doctor's queue updates instantly when kiosk entry is created

---

## Data Model

### New: `Kiosk` table

```prisma
model Kiosk {
  id              String          @id @default(cuid())
  slug            String          @unique
  name            String
  doctorId        String
  serviceId       String
  defaultCategory PatientCategory @default(OSMS)
  active          Boolean         @default(true)
  createdAt       DateTime        @default(now())

  doctor       User         @relation("KioskDoctor", fields: [doctorId], references: [id])
  service      Service      @relation(fields: [serviceId], references: [id])
  queueEntries QueueEntry[]
}
```

### Changes to `QueueEntry`

- `createdById` → `String?` (nullable; null for kiosk-created entries)
- Add `kioskId String?` → FK → `Kiosk` (traces which kiosk created the entry)

### Changes to `QueueSource` enum

```prisma
enum QueueSource {
  REGISTRAR
  CALL_CENTER
  KIOSK       // new
}
```

---

## Backend

**Module:** `apps/backend/src/modules/kiosk/kiosk.router.ts`  
**Registration:** added to `apps/backend/src/trpc/trpc.router.ts` (same pattern as `display: createDisplayRouter(...)`)

### `kiosk.getConfig(slug: string)`

Public procedure (no auth). Returns:

```ts
{ name: string, doctorName: string, serviceName: string, active: boolean }
```

Throws `NOT_FOUND` if slug does not exist. Returns full record including `active: false` — the frontend renders the "temporarily unavailable" screen itself.

### `kiosk.addToQueue(slug, lastName, firstName, middleName?)`

Public procedure. Steps:

1. Load kiosk config by slug → get `doctorId`, `serviceId`, `defaultCategory`; throw `NOT_FOUND` if missing or `active = false`
2. Search `Patient` by exact `lastName + firstName` match (case-insensitive). Take first match. If not found, create new `Patient` with `{ lastName, firstName, middleName, categories: [defaultCategory] }`
3. Atomic transaction: compute today's next `queueNumber`, create `QueueEntry`:
   ```ts
   {
     doctorId, serviceId,
     patientId,
     priority: 'WALK_IN',
     source:   'KIOSK',
     category: kiosk.defaultCategory,
     status:   'ARRIVED',
     arrivedAt: new Date(),
     requiresArrivalConfirmation: false,
     scheduledAt: new Date(Date.UTC(y, m, d, 0, 0, 0)),  // UTC midnight, no TZ shift
     createdById: null,
     kioskId: kiosk.id,
     queueNumber,
   }
   ```
4. Emit `queue:updated` WebSocket event with `{ doctorId }`
5. Return `{ queueNumber: number }`

---

## Frontend

### Public route

`/kiosk/:slug` added to `App.tsx` **before** the auth/role switch — rendered without login check, same pattern as `/display/:slug`.

### `KioskPage` component

**File:** `apps/frontend/src/components/kiosk/KioskPage.tsx`

Three internal screens (no page navigation — pure `useState`):

#### Screen 1 — Welcome
- Hospital label
- Kiosk `name` (large, bold)
- Current queue count: "Сейчас ожидают N человек / Қазір N адам күтуде"
- Large button: **"Встать в очередь / Кезекке тұру"**
- Styling: gradient `#00685B → #004d44`, gold accent `#B39168`

#### Screen 2 — Name Entry
- Bilingual labels throughout (Kazakh primary, Russian secondary)
- Three fields: Тегі/Фамилия · Аты/Имя · Әкесінің аты/Отчество (last optional)
- Active field highlighted with gold border
- On-screen Cyrillic keyboard:
  - **Row 0 (Kazakh):** `Ә Ғ Қ Ң Ө Ұ Ү Һ І` — gold-tinted keys, labeled "Қазақ әріптері"
  - **Row 1:** `Й Ц У К Е Н Г Ш Щ З Х Ъ`
  - **Row 2:** `Ф Ы В А П Р О Л Д Ж Э`
  - **Row 3:** `Я Ч С М И Т Ь Б Ю – ⌫`
  - **Row 4:** `Тазалау/Очистить` · `БОС ОРЫН/ПРОБЕЛ` · `✓ Келесі/Далее`
- Tapping a field activates it; keyboard input goes to the active field
- "Далее/Келесі" advances focus to next field; on last field — submits
- Тегі and Аты required; empty fields show red border and block submit
- Submit button shows loading spinner and is disabled until response returns
- Sizing: all values use `clamp(min, vmin/vh, max)` — fills 100vw × 100vh without scroll on any screen size

#### Screen 3 — Confirmation
- Large queue number: **№ N**
- "Вы в очереди! / Кезекке тұрдыңыз!"
- "Ожидайте вызова / Шақыруды күтіңіз"
- Auto-reset to Screen 1 after **8 seconds** (countdown shown)

### Error screens

| Condition | Screen |
|-----------|--------|
| Slug not found | "Киоск не настроен / Киоск баптанбаған" |
| `active = false` | "Киоск временно недоступен / Уақытша жұмыс істемейді" |
| Network error on submit | Toast/inline error message, button re-enables |

---

## Admin Panel

**File:** `apps/frontend/src/components/admin/KioskManager.tsx`  
**Access:** ADMIN role only. New tab "Киоски" in `AdminViewSwitcher`.

### Kiosk list

Table columns: Название · Врач · Услуга · Slug · Статус (active chip) · Actions (Edit / Copy link / Toggle active)

"Copy link" copies `${window.location.origin}/kiosk/${slug}` to clipboard.

### Create/Edit dialog

| Field | Type | Notes |
|-------|------|-------|
| Название | text | Shown on kiosk screen |
| Slug | text | Auto-generated from name (lowercase, transliterated, hyphens); editable; validated unique |
| Врач | select | Active users with role DOCTOR |
| Услуга | select | Filtered by selected doctor |
| Категория по умолч. | select | PatientCategory enum; default OSMS |
| Активен | toggle | |

New tRPC procedures (admin-protected) required:
- `kiosk.list()` — all kiosk points
- `kiosk.create(input)` — create
- `kiosk.update(input)` — update
- `kiosk.delete(id)` — delete

---

## Edge Cases

| Situation | Behavior |
|-----------|----------|
| Empty Тегі or Аты | Red border on field; submit blocked |
| Double-tap "Далее" | Button disabled immediately on first tap |
| Patient already in queue today | New entry created (multiple visits allowed) |
| New patient (not in DB) | Created with `defaultCategory` from kiosk config |
| Kiosk deactivated mid-session | `addToQueue` returns error; error screen shown |
| Slug does not exist | `getConfig` returns NOT_FOUND; error screen shown |

---

## Out of Scope

- Ticket printing (no printer integration)
- Patient photo or ID verification
- Payment confirmation
- Queue display on kiosk screen (patients use the main DisplayBoard)
