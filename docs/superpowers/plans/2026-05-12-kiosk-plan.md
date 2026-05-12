# Self-Service Kiosk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public tablet kiosk at `/kiosk/:slug` where patients join a walk-in queue by entering their name on an on-screen keyboard, with admin-configurable kiosk points.

**Architecture:** New `Kiosk` DB model stores slug + doctor + service config. Two public (unauthenticated) tRPC procedures (`getConfig`, `addToQueue`) follow the existing `display` module pattern. Frontend KioskPage renders 3 screens (welcome → name entry → confirmation) with a full Cyrillic + Kazakh on-screen keyboard. Admin creates kiosk points in AdminPanel.

**Tech Stack:** NestJS + tRPC + Prisma (backend), React + Tailwind (frontend), existing WebSocket `queue:updated` event for real-time doctor queue refresh.

---

## File Structure

**Create:**
- `apps/backend/src/modules/kiosk/kiosk.router.ts` — all kiosk tRPC procedures (public + admin)
- `apps/frontend/src/components/kiosk/KioskPage.tsx` — public kiosk page (3 screens + keyboard)
- `apps/frontend/src/components/admin/KioskManager.tsx` — admin CRUD for kiosk points

**Modify:**
- `apps/backend/prisma/schema.prisma` — add Kiosk model, update QueueEntry + QueueSource + User + Service
- `apps/backend/src/trpc/trpc.router.ts` — register kiosk router
- `apps/frontend/src/App.tsx` — add public `/kiosk/:slug` route
- `apps/frontend/src/components/AdminPanel.tsx` — add Киоски tab

---

## Task 1: Schema — Kiosk model + QueueEntry changes

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Add KIOSK to QueueSource enum**

In `schema.prisma`, find:
```prisma
enum QueueSource {
  REGISTRAR
  CALL_CENTER
}
```
Replace with:
```prisma
enum QueueSource {
  REGISTRAR
  CALL_CENTER
  KIOSK
}
```

- [ ] **Step 2: Make QueueEntry.createdById nullable and add kioskId**

Find in `model QueueEntry`:
```prisma
  source    QueueSource
  createdById String
  createdBy   User    @relation("CreatedBy", fields: [createdById], references: [id])
```
Replace with:
```prisma
  source    QueueSource
  createdById String?
  createdBy   User?   @relation("CreatedBy", fields: [createdById], references: [id])
  kioskId   String?
  kiosk     Kiosk?  @relation(fields: [kioskId], references: [id])
```

- [ ] **Step 3: Add kioskPoints back-relation to User model**

In `model User`, after `doctorServices DoctorService[]`, add:
```prisma
  kioskPoints Kiosk[] @relation("KioskDoctor")
```

- [ ] **Step 4: Add kiosks back-relation to Service model**

In `model Service`, after `queueEntries QueueEntry[]`, add:
```prisma
  kiosks Kiosk[]
```

- [ ] **Step 5: Add Kiosk model at end of schema (before closing)**

After the `DoctorService` model, add:
```prisma
// ============================================================================
// KIOSK
// ============================================================================

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

  @@map("kiosks")
}
```

- [ ] **Step 6: Push schema to DB**

```bash
docker exec eque-backend npx prisma db push
```

Expected output ends with: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 7: Verify table was created**

```bash
docker exec eque-postgres psql -U eque_admin -d eque -c "\dt kiosks"
```

Expected: `kiosks` appears in the list.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/prisma/schema.prisma
git commit -m "feat(kiosk): схема — модель Kiosk, KIOSK источник, nullable createdById"
```

---

## Task 2: Backend — kiosk tRPC router

**Files:**
- Create: `apps/backend/src/modules/kiosk/kiosk.router.ts`

- [ ] **Step 1: Create the file**

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { PatientCategory } from '@prisma/client';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../events/events.gateway';

export const createKioskRouter = (
  trpc: TrpcService,
  prisma: PrismaService,
  events: EventsGateway,
) => {
  return trpc.router({

    // ── Public: get kiosk config + waiting count ──────────────────────────
    getConfig: trpc.procedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const kiosk = await prisma.kiosk.findUnique({
          where: { slug: input.slug },
          include: {
            doctor:  { select: { firstName: true, lastName: true } },
            service: { select: { name: true } },
          },
        });
        if (!kiosk) throw new TRPCError({ code: 'NOT_FOUND', message: 'Киоск не найден' });

        const now = new Date();
        const dayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const dayEnd   = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));

        const waitingCount = await prisma.queueEntry.count({
          where: {
            doctorId: kiosk.doctorId,
            status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] },
            OR: [
              { scheduledAt: { gte: dayStart, lt: dayEnd } },
              { scheduledAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
            ],
          },
        });

        return {
          name:        kiosk.name,
          doctorName:  `${kiosk.doctor.lastName} ${kiosk.doctor.firstName}`,
          serviceName: kiosk.service.name,
          active:      kiosk.active,
          waitingCount,
        };
      }),

    // ── Public: add patient to walk-in queue ──────────────────────────────
    addToQueue: trpc.procedure
      .input(z.object({
        slug:        z.string(),
        lastName:    z.string().min(1),
        firstName:   z.string().min(1),
        middleName:  z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const kiosk = await prisma.kiosk.findUnique({ where: { slug: input.slug } });
        if (!kiosk || !kiosk.active) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Киоск недоступен' });
        }

        const lastName   = input.lastName.trim().toUpperCase();
        const firstName  = input.firstName.trim();
        const middleName = input.middleName?.trim() || undefined;

        // Find or create patient
        let patient = await prisma.patient.findFirst({
          where: {
            lastName:  { equals: lastName,  mode: 'insensitive' },
            firstName: { equals: firstName, mode: 'insensitive' },
          },
        });
        if (!patient) {
          patient = await prisma.patient.create({
            data: { lastName, firstName, middleName, categories: [kiosk.defaultCategory] },
          });
        }

        // UTC midnight today — no browser timezone shift
        const now = new Date();
        const scheduledAt = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const dayEnd      = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));

        const entry = await prisma.$transaction(async (tx) => {
          const last = await tx.queueEntry.findFirst({
            where: {
              doctorId: kiosk.doctorId,
              OR: [
                { scheduledAt: { gte: scheduledAt, lt: dayEnd } },
                { scheduledAt: null, createdAt: { gte: scheduledAt, lt: dayEnd } },
              ],
            },
            orderBy: { queueNumber: 'desc' },
            select: { queueNumber: true },
          });
          const queueNumber = (last?.queueNumber ?? 0) + 1;

          return tx.queueEntry.create({
            data: {
              doctorId:                    kiosk.doctorId,
              patientId:                   patient!.id,
              serviceId:                   kiosk.serviceId,
              priority:                    'WALK_IN',
              source:                      'KIOSK',
              category:                    kiosk.defaultCategory,
              status:                      'ARRIVED',
              arrivedAt:                   new Date(),
              requiresArrivalConfirmation: false,
              paymentConfirmed:            false,
              scheduledAt,
              createdById:                 null,
              kioskId:                     kiosk.id,
              queueNumber,
            } as any,
          });
        });

        events.emit('queue:updated', { doctorId: kiosk.doctorId, entry });
        return { queueNumber: entry.queueNumber };
      }),

    // ── Admin: list all kiosk points ──────────────────────────────────────
    list: trpc.protectedProcedure
      .query(async ({ ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN' });
        return prisma.kiosk.findMany({
          include: {
            doctor:  { select: { firstName: true, lastName: true } },
            service: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        });
      }),

    // ── Admin: create kiosk point ─────────────────────────────────────────
    create: trpc.protectedProcedure
      .input(z.object({
        name:            z.string().min(1),
        slug:            z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug: только строчные латинские буквы, цифры и дефис'),
        doctorId:        z.string(),
        serviceId:       z.string(),
        defaultCategory: z.nativeEnum(PatientCategory).default('OSMS'),
        active:          z.boolean().default(true),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN' });
        return prisma.kiosk.create({ data: input });
      }),

    // ── Admin: update kiosk point ─────────────────────────────────────────
    update: trpc.protectedProcedure
      .input(z.object({
        id:              z.string(),
        name:            z.string().min(1).optional(),
        slug:            z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
        doctorId:        z.string().optional(),
        serviceId:       z.string().optional(),
        defaultCategory: z.nativeEnum(PatientCategory).optional(),
        active:          z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN' });
        const { id, ...data } = input;
        return prisma.kiosk.update({ where: { id }, data });
      }),

    // ── Admin: delete kiosk point ─────────────────────────────────────────
    delete: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN' });
        return prisma.kiosk.delete({ where: { id: input.id } });
      }),
  });
};
```

- [ ] **Step 2: Check backend compiles**

```bash
docker logs eque-backend --tail 20
```

Expected: no TypeScript errors, NestJS shows `Nest application successfully started`.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/modules/kiosk/kiosk.router.ts
git commit -m "feat(kiosk): tRPC роутер — публичные и admin процедуры"
```

---

## Task 3: Register kiosk router

**Files:**
- Modify: `apps/backend/src/trpc/trpc.router.ts`

- [ ] **Step 1: Add import**

After the last import line (e.g., `import { createServicesRouter }...`), add:
```typescript
import { createKioskRouter } from '../modules/kiosk/kiosk.router';
```

- [ ] **Step 2: Register in appRouter**

In `appRouter`, after `services: createServicesRouter(this.trpc, this.prisma),`, add:
```typescript
    kiosk: createKioskRouter(this.trpc, this.prisma, this.eventsGateway),
```

- [ ] **Step 3: Verify backend starts clean**

```bash
docker logs eque-backend --tail 5
```

Expected: `Nest application successfully started` with no errors.

- [ ] **Step 4: Quick smoke test — getConfig via curl**

First create a kiosk point manually in DB to test (replace `<doctorId>` and `<serviceId>` with real IDs from your DB):

```bash
docker exec eque-postgres psql -U eque_admin -d eque \
  -c "INSERT INTO kiosks (id, slug, name, \"doctorId\", \"serviceId\", active, \"createdAt\") \
      SELECT gen_random_uuid(), 'test-kiosk', 'Тест', id, \
        (SELECT id FROM services LIMIT 1), true, now() \
      FROM users WHERE role='DOCTOR' LIMIT 1;"
```

Then test:
```bash
curl -s "http://localhost:3000/trpc/kiosk.getConfig?input=%7B%22slug%22%3A%22test-kiosk%22%7D" | python3 -m json.tool
```

Expected: JSON with `name`, `doctorName`, `serviceName`, `active: true`, `waitingCount: 0`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/trpc/trpc.router.ts
git commit -m "feat(kiosk): регистрация kiosk роутера"
```

---

## Task 4: Frontend — KioskPage component

**Files:**
- Create: `apps/frontend/src/components/kiosk/KioskPage.tsx`

- [ ] **Step 1: Create the component file**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { trpc } from '@/lib/trpc';

type Screen = 'welcome' | 'entry' | 'confirm';
type ActiveField = 'lastName' | 'firstName' | 'middleName';
interface Fields { lastName: string; firstName: string; middleName: string; }

const KZ_ROW  = ['Ә','Ғ','Қ','Ң','Ө','Ұ','Ү','Һ','І'];
const ROW1    = ['Й','Ц','У','К','Е','Н','Г','Ш','Щ','З','Х','Ъ'];
const ROW2    = ['Ф','Ы','В','А','П','Р','О','Л','Д','Ж','Э'];
const ROW3    = ['Я','Ч','С','М','И','Т','Ь','Б','Ю','–'];

const GR = 'linear-gradient(135deg,#00685B,#004d44)';
const s = (obj: React.CSSProperties): React.CSSProperties => obj;

function KioskKeyboard({ onKey, onBackspace, onClear, onNext, loading }: {
  onKey: (c: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onNext: () => void;
  loading?: boolean;
}) {
  const keyStyle = s({
    flex: 1, display:'flex', alignItems:'center', justifyContent:'center',
    fontWeight:700, color:'white', cursor:'pointer', userSelect:'none',
    borderRadius:'clamp(3px,0.6vmin,7px)',
    height:'clamp(34px,5.5vh,52px)', minWidth:0,
    fontSize:'clamp(13px,2vmin,20px)',
    background:'rgba(255,255,255,.16)', border:'1px solid rgba(255,255,255,.22)',
    transition:'background .1s, transform .08s',
  });

  const rowStyle = s({ display:'flex', gap:'clamp(2px,0.4vw,5px)' });

  return (
    <div style={{ width:'100%', maxWidth:'min(820px,98vw)',
      background:'rgba(0,0,0,.27)', borderRadius:'clamp(7px,1.2vmin,13px)',
      padding:'clamp(6px,1vmin,10px) clamp(4px,0.7vw,8px)',
      display:'flex', flexDirection:'column', gap:'clamp(4px,0.65vh,7px)' }}>

      <div style={{ textAlign:'center', fontSize:'clamp(8px,1vmin,11px)',
        color:'rgba(179,145,104,.72)', letterSpacing:'1.5px', textTransform:'uppercase',
        marginBottom:'-2px' }}>
        Қазақ әріптері
      </div>

      {/* Kazakh row */}
      <div style={rowStyle}>
        {KZ_ROW.map(c => (
          <button key={c} onClick={() => onKey(c)} style={s({
            ...keyStyle,
            background:'rgba(179,145,104,.26)', border:'1px solid rgba(179,145,104,.48)',
            fontSize:'clamp(14px,2.2vmin,21px)',
          })}>
            {c}
          </button>
        ))}
      </div>

      {/* Row 1 */}
      <div style={rowStyle}>
        {ROW1.map(c => <button key={c} onClick={() => onKey(c)} style={keyStyle}>{c}</button>)}
      </div>

      {/* Row 2 */}
      <div style={rowStyle}>
        {ROW2.map(c => <button key={c} onClick={() => onKey(c)} style={keyStyle}>{c}</button>)}
      </div>

      {/* Row 3 + backspace */}
      <div style={rowStyle}>
        {ROW3.map(c => <button key={c} onClick={() => onKey(c)} style={keyStyle}>{c}</button>)}
        <button onClick={onBackspace} style={s({ ...keyStyle, flex:'1.6',
          background:'rgba(255,255,255,.1)', fontSize:'clamp(16px,2.4vmin,24px)' })}>
          ⌫
        </button>
      </div>

      {/* Bottom row */}
      <div style={rowStyle}>
        <button onClick={onClear} style={s({ ...keyStyle, flex:'2.4',
          fontSize:'clamp(10px,1.4vmin,14px)', lineHeight:1.25, textAlign:'center' })}>
          Тазалау<br/><span style={{ opacity:.6, fontSize:'.8em', fontWeight:400 }}>Очистить</span>
        </button>
        <button onClick={() => onKey(' ')} style={s({ ...keyStyle, flex:5,
          fontSize:'clamp(10px,1.4vmin,14px)' })}>
          БОС ОРЫН / ПРОБЕЛ
        </button>
        <button onClick={onNext} disabled={loading} style={s({ ...keyStyle, flex:'3.2',
          background: loading ? 'rgba(179,145,104,.5)' : '#B39168',
          border:'1px solid #a07d54', fontSize:'clamp(11px,1.6vmin,16px)',
          lineHeight:1.25, textAlign:'center', cursor: loading ? 'not-allowed' : 'pointer' })}>
          ✓ Келесі<br/><span style={{ opacity:.7, fontSize:'.8em', fontWeight:400 }}>Далее</span>
        </button>
      </div>
    </div>
  );
}

export function KioskPage({ slug }: { slug: string }) {
  const [screen, setScreen]           = useState<Screen>('welcome');
  const [fields, setFields]           = useState<Fields>({ lastName:'', firstName:'', middleName:'' });
  const [activeField, setActiveField] = useState<ActiveField>('lastName');
  const [queueNumber, setQueueNumber] = useState(0);
  const [countdown, setCountdown]     = useState(8);
  const [errors, setErrors]           = useState<Partial<Record<ActiveField, boolean>>>({});

  const { data: config, isLoading, error } = trpc.kiosk.getConfig.useQuery(
    { slug },
    { refetchInterval: 30_000 },
  );
  const addMutation = trpc.kiosk.addToQueue.useMutation();

  // Countdown and auto-reset on confirm screen
  useEffect(() => {
    if (screen !== 'confirm') return;
    setCountdown(8);
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(id);
          reset();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    setScreen('welcome');
    setFields({ lastName:'', firstName:'', middleName:'' });
    setActiveField('lastName');
    setErrors({});
    addMutation.reset();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKey = useCallback((char: string) => {
    setFields(p => ({ ...p, [activeField]: p[activeField] + char }));
    setErrors(p => ({ ...p, [activeField]: false }));
  }, [activeField]);

  const handleBackspace = useCallback(() => {
    setFields(p => ({ ...p, [activeField]: p[activeField].slice(0, -1) }));
  }, [activeField]);

  const handleClear = useCallback(() => {
    setFields(p => ({ ...p, [activeField]: '' }));
  }, [activeField]);

  const handleNext = useCallback(async () => {
    if (activeField === 'lastName') {
      if (!fields.lastName.trim()) { setErrors(p => ({ ...p, lastName: true })); return; }
      setActiveField('firstName');
      return;
    }
    if (activeField === 'firstName') {
      if (!fields.firstName.trim()) { setErrors(p => ({ ...p, firstName: true })); return; }
      setActiveField('middleName');
      return;
    }
    // middleName — submit
    if (!fields.lastName.trim())  { setErrors(p => ({ ...p, lastName: true }));  setActiveField('lastName');  return; }
    if (!fields.firstName.trim()) { setErrors(p => ({ ...p, firstName: true })); setActiveField('firstName'); return; }
    try {
      const res = await addMutation.mutateAsync({
        slug,
        lastName:   fields.lastName.trim(),
        firstName:  fields.firstName.trim(),
        middleName: fields.middleName.trim() || undefined,
      });
      setQueueNumber(res.queueNumber);
      setScreen('confirm');
    } catch {
      // error shown via addMutation.error
    }
  }, [activeField, fields, slug, addMutation]);

  const baseStyle = s({
    background: GR, width:'100vw', height:'100vh', overflow:'hidden',
    display:'flex', flexDirection:'column', alignItems:'center',
    fontFamily:"'Segoe UI',system-ui,sans-serif",
  });

  const hosp = s({ color:'rgba(255,255,255,.6)', fontSize:'clamp(11px,1.5vmin,16px)',
    letterSpacing:'2px', textTransform:'uppercase', flexShrink:0 });

  // Loading
  if (isLoading) return (
    <div style={{ ...baseStyle, justifyContent:'center', color:'rgba(255,255,255,.6)',
      fontSize:'clamp(14px,2vmin,20px)' }}>
      Жүктелуде... / Загрузка...
    </div>
  );

  // Error / not found
  if (error || !config) return (
    <div style={{ ...baseStyle, justifyContent:'center', gap:'clamp(8px,1.5vh,16px)' }}>
      <div style={{ color:'white', fontSize:'clamp(20px,3.5vmin,40px)', fontWeight:800 }}>
        Киоск баптанбаған
      </div>
      <div style={{ color:'rgba(255,255,255,.6)', fontSize:'clamp(14px,2.2vmin,24px)' }}>
        Киоск не настроен
      </div>
    </div>
  );

  // Inactive
  if (!config.active) return (
    <div style={{ ...baseStyle, justifyContent:'center', gap:'clamp(8px,1.5vh,16px)' }}>
      <div style={{ color:'white', fontSize:'clamp(20px,3.5vmin,40px)', fontWeight:800 }}>
        Уақытша жұмыс істемейді
      </div>
      <div style={{ color:'rgba(255,255,255,.6)', fontSize:'clamp(14px,2.2vmin,24px)' }}>
        Киоск временно недоступен
      </div>
    </div>
  );

  // ── Screen: Welcome ──────────────────────────────────────────────────────
  if (screen === 'welcome') return (
    <div style={{ ...baseStyle, justifyContent:'space-evenly',
      padding:'clamp(20px,4vh,60px) clamp(20px,4vw,60px)' }}>
      <div style={hosp}>УЛТ. ГОСПИТАЛЬ</div>
      <div style={{ color:'white', fontSize:'clamp(24px,5vmin,60px)', fontWeight:800,
        lineHeight:1.15, textAlign:'center' }}>
        {config.name}
      </div>
      <button onClick={() => setScreen('entry')} style={s({
        background:'#B39168', border:'2px solid #a07d54',
        borderRadius:'clamp(10px,1.5vmin,18px)', color:'white', fontWeight:800, cursor:'pointer',
        padding:'clamp(16px,3vh,36px) clamp(40px,8vw,100px)',
        fontSize:'clamp(20px,3.5vmin,42px)', lineHeight:1.3,
      })}>
        Кезекке тұру<br/>
        <span style={{ fontWeight:400, fontSize:'.7em', opacity:.8 }}>Встать в очередь</span>
      </button>
      <div style={{ color:'rgba(255,255,255,.5)', fontSize:'clamp(12px,1.8vmin,20px)' }}>
        {config.waitingCount > 0
          ? `Қазір ${config.waitingCount} адам күтуде / Сейчас ожидают ${config.waitingCount} чел.`
          : 'Кезек бос / Очередь свободна'}
      </div>
    </div>
  );

  // ── Screen: Name Entry ───────────────────────────────────────────────────
  if (screen === 'entry') {
    const fieldDefs: { key: ActiveField; kz: string; ru: string }[] = [
      { key:'lastName',   kz:'Тегі',         ru:'Фамилия' },
      { key:'firstName',  kz:'Аты',          ru:'Имя' },
      { key:'middleName', kz:'Әкесінің аты', ru:'Отчество' },
    ];
    return (
      <div style={{ ...baseStyle, justifyContent:'space-between',
        padding:'clamp(8px,1.6vh,20px) clamp(8px,1.5vw,24px)' }}>
        <div style={hosp}>УЛТ. ГОСПИТАЛЬ</div>
        <div style={{ textAlign:'center', flexShrink:0 }}>
          <div style={{ color:'white', fontSize:'clamp(14px,2.4vmin,22px)', fontWeight:700 }}>
            Деректеріңізді енгізіңіз
          </div>
          <div style={{ color:'rgba(255,255,255,.55)', fontSize:'clamp(11px,1.7vmin,16px)', marginTop:'2px' }}>
            Введите ваши данные
          </div>
        </div>
        <div style={{ width:'100%', maxWidth:'min(820px,98vw)',
          display:'flex', flexDirection:'column', gap:'clamp(4px,0.8vh,9px)' }}>
          {fieldDefs.map(f => (
            <div key={f.key} onClick={() => setActiveField(f.key)} style={s({
              display:'flex', alignItems:'center', gap:'clamp(7px,1.3vw,14px)',
              background: activeField === f.key ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.12)',
              border: `2.5px solid ${errors[f.key] ? '#ef4444' : activeField === f.key ? '#B39168' : 'rgba(255,255,255,.25)'}`,
              borderRadius:'clamp(5px,0.9vmin,9px)',
              padding:'clamp(6px,1.1vh,12px) clamp(9px,1.7vw,16px)', cursor:'pointer',
            })}>
              <div style={{ width:'clamp(110px,19vw,170px)', flexShrink:0 }}>
                <span style={{ color:'rgba(255,255,255,.92)', fontSize:'clamp(11px,1.6vmin,17px)',
                  fontWeight:700, display:'block' }}>{f.kz}</span>
                <span style={{ color:'rgba(255,255,255,.38)', fontSize:'clamp(9px,1.2vmin,13px)',
                  display:'block', marginTop:'2px' }}>{f.ru}</span>
              </div>
              <div style={{ flex:1, color:'white', fontSize:'clamp(14px,2.2vmin,22px)', fontWeight:700 }}>
                {fields[f.key] ? (
                  <>
                    {fields[f.key]}
                    {activeField === f.key && (
                      <span style={{ display:'inline-block', width:'3px',
                        height:'clamp(13px,2vmin,20px)', background:'#B39168', marginLeft:'3px',
                        verticalAlign:'middle', animation:'blink 1s step-end infinite' }} />
                    )}
                  </>
                ) : (
                  <span style={{ fontWeight:400 }}>
                    {activeField === f.key
                      ? <span style={{ display:'inline-block', width:'3px',
                          height:'clamp(13px,2vmin,20px)', background:'#B39168',
                          verticalAlign:'middle', animation:'blink 1s step-end infinite' }} />
                      : <><span style={{ color:'rgba(255,255,255,.4)', display:'block',
                            fontSize:'clamp(11px,1.6vmin,16px)' }}>
                            Енгізу үшін басыңыз...
                          </span>
                          <span style={{ color:'rgba(255,255,255,.22)', display:'block',
                            fontSize:'clamp(9px,1.2vmin,13px)' }}>
                            Нажмите для ввода...
                          </span>
                        </>
                    }
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        {addMutation.error && (
          <div style={{ color:'#fca5a5', fontSize:'clamp(11px,1.6vmin,16px)', flexShrink:0 }}>
            {addMutation.error.message}
          </div>
        )}
        <KioskKeyboard
          onKey={handleKey}
          onBackspace={handleBackspace}
          onClear={handleClear}
          onNext={handleNext}
          loading={addMutation.isPending}
        />
        <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
      </div>
    );
  }

  // ── Screen: Confirm ──────────────────────────────────────────────────────
  return (
    <div style={{ ...baseStyle, justifyContent:'center',
      gap:'clamp(16px,3vh,40px)', padding:'clamp(20px,4vw,60px)' }}>
      <div style={hosp}>УЛТ. ГОСПИТАЛЬ</div>
      <div style={{ background:'rgba(255,255,255,.13)', border:'2px solid rgba(255,255,255,.3)',
        borderRadius:'clamp(12px,2vmin,24px)',
        padding:'clamp(24px,5vh,64px) clamp(32px,8vw,96px)', textAlign:'center' }}>
        <div style={{ color:'rgba(255,255,255,.7)', fontSize:'clamp(14px,2.2vmin,24px)',
          marginBottom:'8px' }}>
          Сіздің нөміріңіз / Ваш номер
        </div>
        <div style={{ color:'white', fontSize:'clamp(60px,14vmin,160px)',
          fontWeight:900, lineHeight:1 }}>
          №{queueNumber}
        </div>
        <div style={{ color:'#B39168', fontSize:'clamp(18px,3.2vmin,36px)',
          fontWeight:800, marginTop:'16px' }}>
          Кезекке тұрдыңыз!
        </div>
        <div style={{ color:'rgba(255,255,255,.7)', fontSize:'clamp(14px,2.2vmin,24px)',
          marginTop:'4px' }}>
          Вы в очереди!
        </div>
        <div style={{ color:'rgba(255,255,255,.5)', fontSize:'clamp(12px,1.8vmin,20px)',
          marginTop:'16px' }}>
          Шақыруды күтіңіз / Ожидайте вызова
        </div>
      </div>
      <div style={{ color:'rgba(255,255,255,.4)', fontSize:'clamp(12px,1.7vmin,18px)' }}>
        {countdown} сек.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/kiosk/KioskPage.tsx
git commit -m "feat(kiosk): KioskPage — 3 экрана, двуязычная клавиатура"
```

---

## Task 5: Frontend — public route in App.tsx

**Files:**
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Add import for KioskPage**

At the top of `App.tsx`, after the existing imports, add:
```typescript
import { KioskPage } from '@/components/kiosk/KioskPage';
```

- [ ] **Step 2: Add public route before auth check**

In `AppContent`, the existing public route block looks like:
```typescript
  if (path.startsWith('/board/')) {
    const slug = path.replace('/board/', '').split('/')[0];
    return <BoardView slug={slug} />;
  }
```

Add a similar block directly after it:
```typescript
  if (path.startsWith('/kiosk/')) {
    const slug = path.replace('/kiosk/', '').split('/')[0];
    return <KioskPage slug={slug} />;
  }
```

- [ ] **Step 3: Verify in browser**

Navigate to `http://localhost:5173/kiosk/test-kiosk` (slug created in Task 3 smoke test). Expected: Kiosk welcome screen with green gradient background.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/App.tsx
git commit -m "feat(kiosk): публичный роут /kiosk/:slug"
```

---

## Task 6: Frontend — KioskManager admin component

**Files:**
- Create: `apps/frontend/src/components/admin/KioskManager.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

const CATEGORY_OPTIONS = [
  { value: 'PAID_ONCE',     label: 'Платный (разовый)' },
  { value: 'PAID_CONTRACT', label: 'Платный (контракт)' },
  { value: 'OSMS',          label: 'ОСМС' },
  { value: 'CONTINGENT',    label: 'Контингент' },
  { value: 'EMPLOYEE',      label: 'Сотрудник' },
];

const selectCls = 'w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[а-яёa-z0-9]+/gi, m =>
      m.split('').map(c => {
        const map: Record<string, string> = {
          а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',
          и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',
          с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',
          ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
        };
        return map[c] ?? c;
      }).join('')
    )
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface KioskForm {
  name: string;
  slug: string;
  doctorId: string;
  serviceId: string;
  defaultCategory: string;
  active: boolean;
}

const EMPTY: KioskForm = {
  name:'', slug:'', doctorId:'', serviceId:'',
  defaultCategory:'OSMS', active:true,
};

interface DialogProps {
  open: boolean;
  onClose: () => void;
  editing: any | null;
}

function KioskDialog({ open, onClose, editing }: DialogProps) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<KioskForm>(editing
    ? { name:editing.name, slug:editing.slug, doctorId:editing.doctorId,
        serviceId:editing.serviceId, defaultCategory:editing.defaultCategory,
        active:editing.active }
    : EMPTY
  );

  const { data: doctors = [] } = trpc.users.getDoctors.useQuery(undefined);
  const { data: services = [] } = trpc.services.getForDoctor.useQuery(
    { doctorId: form.doctorId },
    { enabled: !!form.doctorId },
  );

  const create = trpc.kiosk.create.useMutation({
    onSuccess: () => { utils.kiosk.list.invalidate(); toast.success('Киоск создан'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = trpc.kiosk.update.useMutation({
    onSuccess: () => { utils.kiosk.list.invalidate(); toast.success('Киоск обновлён'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (field: keyof KioskForm, value: any) =>
    setForm(p => ({ ...p, [field]: value }));

  const handleNameChange = (name: string) => {
    setForm(p => ({ ...p, name, slug: p.slug || slugify(name) }));
  };

  const handleSubmit = () => {
    if (!form.name.trim())    { toast.error('Укажите название'); return; }
    if (!form.slug.trim())    { toast.error('Укажите slug'); return; }
    if (!/^[a-z0-9-]+$/.test(form.slug)) { toast.error('Slug: только строчные латинские буквы, цифры и дефис'); return; }
    if (!form.doctorId)       { toast.error('Выберите врача'); return; }
    if (!form.serviceId)      { toast.error('Выберите услугу'); return; }

    const data = { ...form, active: form.active };
    if (editing) {
      update.mutate({ id: editing.id, ...data });
    } else {
      create.mutate(data as any);
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Редактировать киоск' : 'Создать киоск'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Название (отображается на экране)</Label>
            <Input value={form.name} onChange={e => handleNameChange(e.target.value)}
              placeholder="Кабинет забора крови / Қан алу кабинеті" />
          </div>
          <div>
            <Label>Slug (URL-идентификатор)</Label>
            <Input value={form.slug}
              onChange={e => set('slug', e.target.value.toLowerCase())}
              placeholder="blood-draw" className="font-mono" />
            <p className="text-xs text-muted-foreground mt-1">
              Ссылка: {window.location.origin}/kiosk/{form.slug || '...'}
            </p>
          </div>
          <div>
            <Label>Врач</Label>
            <select className={selectCls} value={form.doctorId}
              onChange={e => { set('doctorId', e.target.value); set('serviceId', ''); }}>
              <option value="">— выберите врача —</option>
              {(doctors as any[]).map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.lastName} {d.firstName} {d.middleName ?? ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Услуга</Label>
            <select className={selectCls} value={form.serviceId}
              onChange={e => set('serviceId', e.target.value)}
              disabled={!form.doctorId}>
              <option value="">— выберите услугу —</option>
              {(services as any[]).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Категория пациентов по умолчанию</Label>
            <select className={selectCls} value={form.defaultCategory}
              onChange={e => set('defaultCategory', e.target.value)}>
              {CATEGORY_OPTIONS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="kiosk-active" checked={form.active}
              onChange={e => set('active', e.target.checked)} />
            <Label htmlFor="kiosk-active">Активен</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? 'Сохранение...' : (editing ? 'Сохранить' : 'Создать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KioskManager() {
  const utils = trpc.useUtils();
  const { data: kiosks = [], isLoading } = trpc.kiosk.list.useQuery();
  const del = trpc.kiosk.delete.useMutation({
    onSuccess: () => { utils.kiosk.list.invalidate(); toast.success('Киоск удалён'); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggle = trpc.kiosk.update.useMutation({
    onSuccess: () => utils.kiosk.list.invalidate(),
    onError: (e: any) => toast.error(e.message),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/kiosk/${slug}`);
    toast.success('Ссылка скопирована');
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          Создать киоск
        </Button>
      </div>

      {(kiosks as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет киосков</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium">Врач</th>
                <th className="text-left px-4 py-2 font-medium">Услуга</th>
                <th className="text-left px-4 py-2 font-medium">Slug</th>
                <th className="text-left px-4 py-2 font-medium">Статус</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(kiosks as any[]).map((k: any) => (
                <tr key={k.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2 font-medium">{k.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {k.doctor.lastName} {k.doctor.firstName}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{k.service.name}</td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs text-blue-500">/kiosk/{k.slug}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      k.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {k.active ? 'Активен' : 'Неактивен'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <Button size="sm" variant="outline"
                        onClick={() => copyLink(k.slug)}>
                        Копировать ссылку
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => { setEditing(k); setDialogOpen(true); }}>
                        Изменить
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => toggle.mutate({ id: k.id, active: !k.active })}>
                        {k.active ? 'Деактивировать' : 'Активировать'}
                      </Button>
                      <Button size="sm" variant="destructive"
                        onClick={() => { if (confirm(`Удалить киоск "${k.name}"?`)) del.mutate({ id: k.id }); }}>
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <KioskDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          editing={editing}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/admin/KioskManager.tsx
git commit -m "feat(kiosk): KioskManager — CRUD киосков в админке"
```

---

## Task 7: AdminPanel — add Киоски tab

**Files:**
- Modify: `apps/frontend/src/components/AdminPanel.tsx`

- [ ] **Step 1: Add import**

At top of `AdminPanel.tsx`, after existing tab imports, add:
```typescript
import { KioskManager } from './admin/KioskManager';
```

- [ ] **Step 2: Add tab trigger**

In the `<TabsList>`, after `{isAdmin && <TabsTrigger value="boards">Табло</TabsTrigger>}`, add:
```tsx
{isAdmin && <TabsTrigger value="kiosks">Киоски</TabsTrigger>}
```

- [ ] **Step 3: Add tab content**

After the boards `<TabsContent>` block, add:
```tsx
        {isAdmin && (
          <TabsContent value="kiosks" className="pt-4">
            <KioskManager />
          </TabsContent>
        )}
```

- [ ] **Step 4: End-to-end verify**

1. Open the app as ADMIN
2. Go to AdminPanel → tab "Киоски"
3. Click "Создать киоск" → fill in name, slug, pick a doctor, pick a service → Save
4. Row appears in table with "Активен" badge
5. Click "Копировать ссылку" → toast "Ссылка скопирована"
6. Open copied link in new tab → kiosk welcome screen loads with the name you entered
7. Click "Кезекке тұру" → name entry screen with keyboard appears
8. Type a last name using keyboard → click Далее → type first name → click Далее → click Далее to submit
9. Confirmation screen shows "№1" (or next queue number)
10. After 8 seconds screen resets to welcome
11. Open doctor's queue in RegistrarView → the entry appears with source KIOSK

- [ ] **Step 5: Commit and push**

```bash
git add apps/frontend/src/components/AdminPanel.tsx
git commit -m "feat(kiosk): вкладка Киоски в AdminPanel"
git push
```

---

## Self-Review Notes

- `addToQueue` uses `as any` cast on `queueEntry.create` because `createdById: null` is newly nullable — Prisma types may lag until next client regeneration inside container; `as any` is intentional and safe here.
- `getConfig` returns `waitingCount` inline — refreshed every 30s on the welcome screen via `refetchInterval`.
- Slug validation (`/^[a-z0-9-]+$/`) is enforced both client-side (KioskManager form) and server-side (zod `regex`).
- The cursor blink animation uses an inline `<style>` tag in the entry screen — this is intentional since the kiosk page is isolated and has no Tailwind animation classes for this pattern.
- `trpc.services.getForDoctor` is a `protectedProcedure` (requires auth). The KioskManager dialog is only shown to ADMIN users who are already authenticated, so this is fine.
