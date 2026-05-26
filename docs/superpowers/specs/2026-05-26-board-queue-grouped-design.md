# Board Queue: Grouped by Cabinet with Position Numbers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the waiting queue on the display board grouped by cabinet, with ordinal position numbers, and filter out entries from previous days.

**Architecture:** Two independent changes — backend adds a KZ-timezone date filter to the queue query, frontend regroups the flat queue array into cabinet sections with position numbers. No schema changes needed.

**Tech Stack:** NestJS + Prisma (backend), React + TypeScript (frontend), existing `display.router.ts` and `QueuePanel.tsx`.

---

## Change 1: Backend — date filter (`display.router.ts`)

File: `apps/backend/src/modules/display/display.router.ts`

In `getBySlug`, the `queueEntries` query currently filters only by status (`WAITING_ARRIVAL`, `ARRIVED`), with no date constraint. Entries from previous days that were never cancelled remain visible on the board.

**Fix:** add `createdAt: { gte: dayStart }` to the where clause, where `dayStart` is KZ UTC+5 midnight — the same pattern used in the analytics router:

```typescript
const KZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const kzNow = new Date(new Date().getTime() + KZ_OFFSET_MS);
const todayStr = kzNow.toISOString().slice(0, 10); // "YYYY-MM-DD" in KZ time
const dayStart = new Date(todayStr + 'T00:00:00+05:00'); // KZ midnight as UTC

const queueEntries = await prisma.queueEntry.findMany({
  where: {
    doctorId: { in: doctorIds },
    status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] },
    createdAt: { gte: dayStart },   // ← added
  },
  include: { patient: { select: { firstName: true, lastName: true } } },
  orderBy: { createdAt: 'asc' },
});
```

No other backend changes needed.

---

## Change 2: Frontend — grouped QueuePanel (`QueuePanel.tsx`)

File: `apps/frontend/src/components/board/QueuePanel.tsx`

### Current behaviour
Flat list. Each row has a green cabinet tag on the left (showing cabinet number + "Каб."), patient name in the centre, and scheduled time on the right for non-walk-in entries. Cabinet tag repeats on every row.

### New behaviour
**Grouped by cabinet.** For each cabinet:
1. A section header row: green "Каб. X" pill + thin separator line + entry count ("N чел.")
2. Patient rows without the cabinet tag, replaced by a dark ordinal-position badge on the left (1, 2, 3…)

Position number = 1-based index within the cabinet's sorted list (same sort order as today: `createdAt asc`). Position is NOT the global `queueNumber` field.

### Component changes

**`QueueEntry` interface** — no changes required. All needed fields (`queueNumber`, `priority`, `patientLastName`, `patientFirstName`, `cabinetNumber`, `scheduledAt`) are already present.

**Grouping logic (new `useMemo`):**

```typescript
const groups = useMemo(() => {
  const map = new Map<string, QueueEntry[]>();
  for (const e of queue) {
    if (!map.has(e.cabinetNumber)) map.set(e.cabinetNumber, []);
    map.get(e.cabinetNumber)!.push(e);
  }
  return Array.from(map.entries()); // [[cabinetNumber, entries[]], ...]
}, [queue]);
```

Cabinet order = first-appearance order in the incoming `queue` array (already sorted by `createdAt asc` from the backend).

**Scroll animation** — the existing `SCROLL_THRESHOLD = 8` and `translateY(-50%)` infinite-scroll trick is preserved. Instead of duplicating the flat array, the groups array is rendered twice:

```typescript
function renderGroups(keyPrefix: string) {
  return groups.map(([cab, entries]) => (
    <React.Fragment key={`${keyPrefix}-${cab}`}>
      {/* section header */}
      {entries.map((entry, idx) => (
        /* patient row with position = idx + 1 */
      ))}
    </React.Fragment>
  ));
}

// In JSX:
<div style={shouldScroll ? { animation: `scroll-up ${scrollDuration}s linear infinite` } : {}}>
  {renderGroups('a')}
  {shouldScroll && renderGroups('b')}
</div>
```

**Section header visual spec** (dark board theme):
- Green pill: `background #00685B`, white text, `font-size ~14px`, `font-weight 900`, `padding 3px 10px`, `border-radius 4px`
- Separator: `flex: 1`, `height 1px`, `background #1e2530`
- Count: `font-size 10px`, `color #64748b`

**Position badge visual spec:**
- Width `36px`, `background #1a2535`
- Number: `font-size ~19px`, `font-weight 900`, `color #94a3b8`

**Patient row** (after removing cabinet tag):
- Name + time layout unchanged from current implementation
- `border-radius 5px`, `background #161b22`, `border 1px solid #1e2530`

### Edge cases
- **Single cabinet on board:** section header still renders (consistent UX, patientsknow which cabinet they're waiting for).
- **Empty queue:** existing "Очередь" header shown, no groups rendered (no change).
- **Single-entry cabinet:** group header + one row with position "1".
