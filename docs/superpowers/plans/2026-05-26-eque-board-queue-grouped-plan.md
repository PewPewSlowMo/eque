# Board Queue: Grouped by Cabinet with Position Numbers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the waiting queue on the display board grouped by cabinet with ordinal position numbers, and filter out entries from previous days.

**Architecture:** Two independent changes — backend adds a KZ-timezone date filter (`createdAt >= today KZ midnight`) to the queue query in `getBySlug`; frontend replaces the flat list in `QueuePanel` with grouped sections per cabinet, each entry showing its 1-based position within that cabinet's queue.

**Tech Stack:** NestJS + Prisma (backend), React + TypeScript (frontend).

---

## File Map

| File | Change |
|---|---|
| `apps/backend/src/modules/display/display.router.ts` | Add `dayStart` date filter to `queueEntries` query |
| `apps/frontend/src/components/board/QueuePanel.tsx` | Replace flat list with grouped-by-cabinet rendering |

---

### Task 1: Backend — фильтр по дате в `display.router.ts`

**Files:**
- Modify: `apps/backend/src/modules/display/display.router.ts:89-93`

**Context:** `getBySlug` fetches waiting queue entries with no date filter — entries from previous days that were never cancelled stay visible on the board. The fix adds `createdAt: { gte: dayStart }` where `dayStart` is KZ UTC+5 midnight. This is the same pattern already used in `analytics.router.ts`.

- [ ] **Step 1: Replace the `queueEntries` query**

In `apps/backend/src/modules/display/display.router.ts`, find this block (around line 89):

```typescript
        const queueEntries = await prisma.queueEntry.findMany({
          where: { doctorId: { in: doctorIds }, status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] } },
          include: { patient: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        });
```

Replace with:

```typescript
        const KZ_OFFSET_MS = 5 * 60 * 60 * 1000;
        const kzNow = new Date(new Date().getTime() + KZ_OFFSET_MS);
        const todayStr = kzNow.toISOString().slice(0, 10);
        const dayStart = new Date(todayStr + 'T00:00:00+05:00');

        const queueEntries = await prisma.queueEntry.findMany({
          where: {
            doctorId: { in: doctorIds },
            status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] },
            createdAt: { gte: dayStart },
          },
          include: { patient: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        });
```

- [ ] **Step 2: Verify the backend builds**

Run from the repo root:
```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no output (zero errors).

- [ ] **Step 3: Verify at runtime**

The backend runs inside Docker. Check the logs after saving — NestJS watch mode recompiles automatically:
```bash
docker logs eque-backend --tail 20
```
Expected: no errors, recompile line like `Compilation complete`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/display/display.router.ts
git commit -m "fix(board): фильтр очереди только за сегодня (UTC+5)"
```

---

### Task 2: Frontend — группировка в `QueuePanel.tsx`

**Files:**
- Modify: `apps/frontend/src/components/board/QueuePanel.tsx` (full rewrite of component logic, interface unchanged)

**Context:** Current component maps a flat `QueueEntry[]` to rows, each with a green cabinet tag on the left. New version groups the same array by `cabinetNumber`, renders a section header per cabinet (green pill + separator + count), and replaces the cabinet tag with a dark ordinal-position badge (1, 2, 3…). Infinite scroll works the same way — groups are rendered twice when `queue.length > SCROLL_THRESHOLD`.

- [ ] **Step 1: Replace `QueuePanel.tsx` with the grouped implementation**

Overwrite `apps/frontend/src/components/board/QueuePanel.tsx` entirely:

```tsx
import { useMemo } from 'react';

interface QueueEntry {
  queueNumber: number;
  priority: string;
  patientLastName: string;
  patientFirstName: string;
  cabinetNumber: string;
  scheduledAt: string | Date | null;
}

interface Props {
  queue: QueueEntry[];
}

const SCROLL_THRESHOLD = 8;

const SCROLL_STYLES = `
  @keyframes scroll-up {
    0%   { transform: translateY(0); }
    100% { transform: translateY(-50%); }
  }
`;

function formatTime(value: string | Date | null): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatName(firstName: string, lastName: string): { first: string; last: string } {
  const last = lastName.length > 0 ? lastName.slice(0, 2) + '.' : '';
  return { first: firstName, last };
}

export function QueuePanel({ queue }: Props) {
  const shouldScroll = queue.length > SCROLL_THRESHOLD;
  const scrollDuration = queue.length * 3;

  const groups = useMemo(() => {
    const map = new Map<string, QueueEntry[]>();
    for (const e of queue) {
      if (!map.has(e.cabinetNumber)) map.set(e.cabinetNumber, []);
      map.get(e.cabinetNumber)!.push(e);
    }
    return Array.from(map.entries());
  }, [queue]);

  function renderGroups(keyPrefix: string) {
    return groups.map(([cab, entries]) => (
      <div key={`${keyPrefix}-${cab}`}>
        {/* Cabinet section header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 4px 4px 4px',
        }}>
          <span style={{
            background: '#00685B', color: '#fff',
            fontSize: 14, fontWeight: 900,
            padding: '3px 10px', borderRadius: 4,
            letterSpacing: '0.04em', flexShrink: 0,
          }}>
            Каб. {cab}
          </span>
          <div style={{ flex: 1, height: 1, background: '#1e2530' }} />
          <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0 }}>
            {entries.length} чел.
          </span>
        </div>

        {/* Patient rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {entries.map((entry, idx) => {
            const { first, last } = formatName(entry.patientFirstName, entry.patientLastName);
            const time = entry.priority === 'WALK_IN' ? '' : formatTime(entry.scheduledAt);
            return (
              <div
                key={`${keyPrefix}-${cab}-${entry.queueNumber}`}
                style={{
                  display: 'flex', alignItems: 'stretch',
                  background: '#161b22', border: '1px solid #1e2530',
                  borderRadius: 5, overflow: 'hidden', flexShrink: 0,
                }}
              >
                {/* Position badge */}
                <div style={{
                  width: 36, flexShrink: 0, background: '#1a2535',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 19, fontWeight: 900, color: '#94a3b8', lineHeight: 1 }}>
                    {idx + 1}
                  </span>
                </div>

                {/* Patient info */}
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center',
                  padding: '6px 8px', overflow: 'hidden', minWidth: 0,
                }}>
                  <span style={{
                    fontSize: 36, fontWeight: 700, color: '#e2e8f0',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    flex: 1, minWidth: 0,
                  }}>
                    {first}{' '}
                    <span style={{ color: '#94a3b8', fontWeight: 500 }}>{last}</span>
                  </span>
                  {time && (
                    <>
                      <span style={{ fontSize: 36, color: '#2d3748', margin: '0 5px', flexShrink: 0 }}>—</span>
                      <span style={{ fontSize: 36, color: '#475569', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                        {time}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ));
  }

  return (
    <div style={{
      flex: '0 0 38%', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', padding: '24px 20px', gap: 12,
    }}>
      <div style={{
        color: 'rgba(255,255,255,.4)', fontSize: 22, fontWeight: 600,
        letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8, flexShrink: 0,
      }}>
        Очередь
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {shouldScroll && <style>{SCROLL_STYLES}</style>}

        <div style={{
          display: 'flex', flexDirection: 'column', gap: 0,
          ...(shouldScroll ? { animation: `scroll-up ${scrollDuration}s linear infinite` } : {}),
        }}>
          {renderGroups('a')}
          {shouldScroll && renderGroups('b')}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 3: Check visual result in the browser**

Open the display board URL (e.g. `http://localhost:5173/board/<slug>`). Verify:
- Queue panel shows cabinet section headers (green "Каб. X" pill)
- Each patient row has a dark position badge on the left (1, 2, 3…)
- No green cabinet tag on individual rows
- Walk-in entries have no time shown; scheduled entries show time on the right
- If >8 entries total: infinite scroll animation runs correctly

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/board/QueuePanel.tsx
git commit -m "feat(board): группировка очереди по кабинету с порядковыми номерами"
git push
```
