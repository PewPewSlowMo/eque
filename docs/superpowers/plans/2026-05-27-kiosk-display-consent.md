# Kiosk Display Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить экран согласия на показ имени в киоске; на табло показывать `№{queueNumber}` вместо имени если согласия нет.

**Architecture:** Новое поле `displayConsent Boolean @default(true)` на `QueueEntry`. Киоск добавляет экран `'consent'` между `'entry'` и `'confirm'`. Backend условно обнуляет имена при `displayConsent=false`. Фронт-компоненты табло рендерят имя или номер через единый nullable-check.

**Tech Stack:** Prisma 6 + PostgreSQL, NestJS/tRPC, React 18 + inline styles

---

### Task 1: Schema — добавить поле displayConsent

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Добавить поле в модель QueueEntry**

В файле `apps/backend/prisma/schema.prisma` найти строку `paymentConfirmed Boolean @default(false)` и добавить поле после неё:

```prisma
  paymentConfirmed Boolean @default(false)
  displayConsent   Boolean @default(true)
```

- [ ] **Step 2: Создать и применить миграцию**

```bash
cd /home/administrator/projects_danik
pnpm db:migrate
```

Когда запросит имя миграции — ввести: `add_display_consent_to_queue_entry`

Ожидаемый вывод: `The following migration(s) have been applied: ... add_display_consent_to_queue_entry`

- [ ] **Step 3: Проверить TypeScript**

```bash
cd apps/backend && npx tsc --noEmit
```

Ожидаемый вывод: нет ошибок.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(queue): добавлено поле displayConsent в QueueEntry"
```

---

### Task 2: Backend — kiosk.router.ts принимает displayConsent

**Files:**
- Modify: `apps/backend/src/modules/kiosk/kiosk.router.ts`

- [ ] **Step 1: Добавить displayConsent в Zod-схему addToQueue**

Найти блок `.input(z.object({` в мутации `addToQueue` (строка ~73) и добавить поле:

```typescript
    addToQueue: trpc.procedure
      .input(z.object({
        slug:           z.string(),
        lastName:       z.string().min(1),
        firstName:      z.string().min(1),
        middleName:     z.string().min(1).optional(),
        displayConsent: z.boolean().default(true),
      }))
```

- [ ] **Step 2: Передать displayConsent в queueEntry.create**

Найти вызов `tx.queueEntry.create` (строка ~129) и добавить поле в `data`:

```typescript
          return tx.queueEntry.create({
            data: {
              doctorId:                    kiosk.doctorId,
              patientId:                   patient.id,
              serviceId:                   kiosk.serviceId,
              priority:                    'WALK_IN',
              source:                      'KIOSK',
              category:                    kiosk.defaultCategory,
              status:                      'ARRIVED',
              arrivedAt:                   new Date(),
              requiresArrivalConfirmation: false,
              paymentConfirmed:            !PAID_CATEGORIES.includes(kiosk.defaultCategory),
              scheduledAt:                 null,
              createdById:                 null,
              kioskId:                     kiosk.id,
              queueNumber,
              displayConsent:              input.displayConsent ?? true,
            } as any,
          });
```

- [ ] **Step 3: Проверить TypeScript**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
```

Ожидаемый вывод: нет ошибок.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/kiosk/kiosk.router.ts
git commit -m "feat(kiosk): kiosk.addToQueue принимает displayConsent"
```

---

### Task 3: Backend — display.router.ts скрывает имя при отсутствии согласия

**Files:**
- Modify: `apps/backend/src/modules/display/display.router.ts`

- [ ] **Step 1: Обновить маппинг activeCalls — добавить queueNumber и conditional names**

Найти блок `const activeCalls = activeEntries.map(...)` (строка ~104) и заменить его целиком:

```typescript
        const activeCalls = activeEntries.map((e) => ({
          cabinetNumber:    cabinetByDoctorId[e.doctorId]?.number ?? '?',
          cabinetName:      cabinetByDoctorId[e.doctorId]?.name ?? null,
          queueNumber:      e.queueNumber,
          patientLastName:  e.displayConsent ? e.patient.lastName : null,
          patientFirstName: e.displayConsent ? e.patient.firstName : null,
          calledAt:         e.calledAt,
        }));
```

- [ ] **Step 2: Обновить маппинг queue — conditional names**

Найти блок `const queue = queueEntries.map(...)` (строка ~112) и заменить:

```typescript
        const queue = queueEntries.map((e) => ({
          queueNumber:      e.queueNumber,
          priority:         e.priority as string,
          patientLastName:  e.displayConsent ? e.patient.lastName : null,
          patientFirstName: e.displayConsent ? e.patient.firstName : null,
          cabinetNumber:    cabinetByDoctorId[e.doctorId]?.number ?? '?',
          scheduledAt:      e.scheduledAt ?? null,
        }));
```

- [ ] **Step 3: Проверить TypeScript**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
```

Ожидаемый вывод: нет ошибок.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/display/display.router.ts
git commit -m "feat(display): скрывать имя пациента на табло при displayConsent=false"
```

---

### Task 4: Frontend — ActiveCallsPanel.tsx и QueuePanel.tsx

**Files:**
- Modify: `apps/frontend/src/components/board/ActiveCallsPanel.tsx`
- Modify: `apps/frontend/src/components/board/QueuePanel.tsx`

- [ ] **Step 1: Обновить ActiveCallsPanel — интерфейс и рендер**

Заменить файл `apps/frontend/src/components/board/ActiveCallsPanel.tsx` целиком:

```tsx
interface ActiveCall {
  cabinetNumber: string;
  cabinetName: string | null;
  queueNumber: number;
  patientLastName: string | null;
  patientFirstName: string | null;
  calledAt: Date | string | null;
}

interface Props {
  calls: ActiveCall[];
}

export function ActiveCallsPanel({ calls }: Props) {
  return (
    <div style={{
      flex: '0 0 62%', display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,.06)', overflow: 'hidden',
      padding: '24px 32px', gap: 16, position: 'relative',
    }}>
      <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 22, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        Активные вызовы
      </div>

      {calls.length === 0 ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 32, fontWeight: 500 }}>Ожидайте вызова</span>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden', alignItems: 'stretch' }}>
          {calls.map((call) => (
            <div
              key={`${call.cabinetNumber}-${String(call.calledAt ?? '')}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 20, padding: '12px 24px', borderRadius: 12,
                background: 'rgba(0,104,91,.15)', border: '1px solid rgba(0,104,91,.3)',
              }}
            >
              <span style={{ color: '#B39168', fontWeight: 800, fontSize: 48, lineHeight: 1, flexShrink: 0 }}>
                {call.patientFirstName != null
                  ? <>{call.patientFirstName}{' '}<span style={{ fontWeight: 600 }}>{call.patientLastName ? call.patientLastName.slice(0, 2) + '.' : ''}</span></>
                  : `№${call.queueNumber}`
                }
              </span>
              <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 72, lineHeight: 0.6, overflow: 'hidden', flexShrink: 0 }}>
                →
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                <span style={{ color: '#ffffff', fontWeight: 900, fontSize: 72, lineHeight: 1 }}>
                  {call.cabinetNumber}
                </span>
                <span style={{ color: 'rgba(255,255,255,.45)', fontSize: 20 }}>каб.</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Обновить QueuePanel — интерфейс и рендер**

В файле `apps/frontend/src/components/board/QueuePanel.tsx`:

Заменить интерфейс `QueueEntry`:

```typescript
interface QueueEntry {
  queueNumber: number;
  priority: string;
  patientLastName: string | null;
  patientFirstName: string | null;
  cabinetNumber: string;
  scheduledAt: string | Date | null;
}
```

Найти блок рендера пациента внутри `entries.map(...)` (строка ~74) и заменить расчёт имени:

```tsx
            const isAnon = entry.patientFirstName === null;
            const nameFirst = isAnon ? `№${entry.queueNumber}` : entry.patientFirstName!;
            const nameLast  = isAnon ? '' : (entry.patientLastName ? entry.patientLastName.slice(0, 2) + '.' : '');
            const time = entry.priority === 'WALK_IN' ? '' : formatTime(entry.scheduledAt);
```

И строку рендера имени (была `const { first, last } = formatName(...)`):

```tsx
                  <span style={{
                    fontSize: 36, fontWeight: 700, color: '#e2e8f0',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    flex: 1, minWidth: 0,
                  }}>
                    {nameFirst}{' '}
                    <span style={{ color: '#94a3b8', fontWeight: 500 }}>{nameLast}</span>
                  </span>
```

- [ ] **Step 3: Проверить TypeScript фронтенда**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit
```

Ожидаемый вывод: нет ошибок.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/board/ActiveCallsPanel.tsx \
        apps/frontend/src/components/board/QueuePanel.tsx
git commit -m "feat(board): условный рендер имени или номера талона на табло"
```

---

### Task 5: Frontend — useCallNotifications.ts и CallOverlay.tsx

**Files:**
- Modify: `apps/frontend/src/components/board/useCallNotifications.ts`
- Modify: `apps/frontend/src/components/board/CallOverlay.tsx`

- [ ] **Step 1: Обновить CallEvent тип и handleCalled в useCallNotifications.ts**

Найти интерфейс `CallEvent` (строка 4) и заменить типы имён на nullable:

```typescript
export interface CallEvent {
  cabinetId: string | null;
  cabinetNumber: string | null;
  patientLastName: string | null;
  patientFirstName: string | null;
  patientMiddleName: string;
  queueNumber: number | null;
}
```

Найти блок `const handleCalled = (data: any) => {` (строка ~94) и заменить создание `event`:

```typescript
    const handleCalled = (data: any) => {
      if (!data.cabinetId || !cabinetIdsRef.current.includes(data.cabinetId)) return;

      const noConsent = data.entry?.displayConsent === false;
      const event: CallEvent = {
        cabinetId:         data.cabinetId,
        cabinetNumber:     data.cabinetNumber,
        patientLastName:   noConsent ? null : (data.entry?.patient?.lastName ?? ''),
        patientFirstName:  noConsent ? null : (data.entry?.patient?.firstName ?? ''),
        patientMiddleName: noConsent ? '' : (data.entry?.patient?.middleName ?? ''),
        queueNumber:       data.entry?.queueNumber ?? null,
      };

      queueRef.current.push(event);
      if (!processingRef.current) processNext();
    };
```

- [ ] **Step 2: Обновить speakTTS — TTS fallback при отсутствии согласия**

Найти функцию `speakTTS` внутри `playAudio` (строка ~45) и заменить:

```typescript
    const speakTTS = () => {
      if (board.audioMode !== 'SOUND_TTS') return;
      const text = event.patientFirstName === null
        ? `Номер ${event.queueNumber ?? ''}, кабинет ${event.cabinetNumber ?? ''}`
        : board.ttsTemplate
            .replace('{lastName}',   event.patientLastName ?? '')
            .replace('{firstName}',  event.patientFirstName ?? '')
            .replace('{middleName}', event.patientMiddleName)
            .replace('{cabinet}',    event.cabinetNumber ?? '')
            .replace('{number}',     String(event.queueNumber ?? ''));
      window.speechSynthesis.cancel();
      setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        window.speechSynthesis.speak(utterance);
      }, 150);
    };
```

- [ ] **Step 3: Обновить CallOverlay.tsx — null-safe рендер**

В файле `apps/frontend/src/components/board/CallOverlay.tsx`:

Найти строку `key={...}` (строка ~64) и заменить:

```tsx
            key={`${call.cabinetId ?? 'none'}-${call.patientLastName ?? String(call.queueNumber ?? '')}`}
```

Найти блок `{/* Patient name */}` (строка ~81) и заменить содержимое `<span>`:

```tsx
            {/* Patient name */}
            <span style={{
              flexShrink: 0, whiteSpace: 'nowrap',
              fontWeight: 900, color: '#B39168', lineHeight: 1,
              fontSize: sz.patient,
              animation: 'gold-flash 0.5s ease-in-out infinite alternate',
            }}>
              {call.patientFirstName != null
                ? `${call.patientLastName} ${call.patientFirstName.charAt(0)}.`
                : `№${call.queueNumber}`
              }
            </span>
```

- [ ] **Step 4: Проверить TypeScript фронтенда**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit
```

Ожидаемый вывод: нет ошибок.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/board/useCallNotifications.ts \
        apps/frontend/src/components/board/CallOverlay.tsx
git commit -m "feat(board): TTS и overlay используют номер талона при отсутствии согласия"
```

---

### Task 6: Frontend — KioskPage.tsx новый экран согласия

**Files:**
- Modify: `apps/frontend/src/components/kiosk/KioskPage.tsx`

- [ ] **Step 1: Добавить 'consent' в тип Screen и хук handleConsent**

Найти строку `type Screen = 'welcome' | 'entry' | 'confirm';` (строка 4) и заменить:

```typescript
type Screen = 'welcome' | 'entry' | 'consent' | 'confirm';
```

После объявления `const addMutation = trpc.kiosk.addToQueue.useMutation();` (строка ~113) добавить новый callback:

```typescript
  const handleConsent = useCallback(async (consent: boolean) => {
    if (!fields.lastName.trim() || !fields.firstName.trim()) return;
    try {
      const res = await addMutation.mutateAsync({
        slug,
        lastName:       fields.lastName.trim(),
        firstName:      fields.firstName.trim(),
        middleName:     fields.middleName.trim() || undefined,
        displayConsent: consent,
      });
      setQueueNumber(res.queueNumber);
      setScreen('confirm');
    } catch {
      // error shown via addMutation.error
    }
  }, [fields, slug, addMutation]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Изменить handleNext — переход на 'consent' вместо submit**

Найти `const handleNext = useCallback(async () => {` (строка ~152) и заменить функцию целиком:

```typescript
  const handleNext = useCallback(() => {
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
    // middleName — переход к экрану согласия
    if (!fields.lastName.trim())  { setErrors(p => ({ ...p, lastName: true }));  setActiveField('lastName');  return; }
    if (!fields.firstName.trim()) { setErrors(p => ({ ...p, firstName: true })); setActiveField('firstName'); return; }
    setScreen('consent');
  }, [activeField, fields]);
```

Обратите внимание: функция больше не `async`, убраны `slug` и `addMutation` из deps — они перешли в `handleConsent`.

- [ ] **Step 3: Добавить рендер экрана consent**

Вставить блок рендера ПЕРЕД финальным `// ── Screen: Confirm ──` (строка ~358):

```tsx
  // ── Screen: Consent ─────────────────────────────────────────────────────
  if (screen === 'consent') {
    const previewName = `${fields.firstName} ${fields.lastName.slice(0, 2)}.`;
    return (
      <div style={{ ...baseStyle, justifyContent: 'space-evenly',
        padding: 'clamp(20px,4vh,60px) clamp(20px,4vw,60px)' }}>
        <Logo />

        {/* Name confirmation card */}
        <div style={{
          background: 'rgba(255,255,255,.13)', border: '2px solid rgba(255,255,255,.3)',
          borderRadius: 'clamp(12px,2vmin,24px)',
          padding: 'clamp(16px,3vh,32px) clamp(24px,6vw,64px)',
          textAlign: 'center', width: '100%', maxWidth: 'min(820px,98vw)',
        }}>
          <div style={{ color: 'rgba(255,255,255,.5)',
            fontSize: 'clamp(12px,1.8vmin,18px)', marginBottom: 6 }}>
            Сіздің деректеріңіз / Ваши данные
          </div>
          <div style={{ color: 'white', fontSize: 'clamp(22px,4vmin,40px)', fontWeight: 800 }}>
            {fields.lastName} {fields.firstName}
          </div>
          {fields.middleName && (
            <div style={{ color: 'rgba(255,255,255,.5)',
              fontSize: 'clamp(14px,2vmin,22px)', marginTop: 4 }}>
              {fields.middleName}
            </div>
          )}
        </div>

        {/* Question */}
        <div style={{ textAlign: 'center', maxWidth: 'min(820px,98vw)', width: '100%' }}>
          <div style={{ color: 'white', fontSize: 'clamp(16px,2.6vmin,28px)',
            fontWeight: 700, lineHeight: 1.3 }}>
            Атыңызды ақпараттық тақтада көрсетуге рұқсат бересіз бе?
          </div>
          <div style={{ color: 'rgba(255,255,255,.55)',
            fontSize: 'clamp(13px,2vmin,22px)', marginTop: 8, lineHeight: 1.35 }}>
            Разрешаете отображать ваше имя на информационном табло?
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column',
          gap: 'clamp(8px,1.5vh,16px)', width: '100%', maxWidth: 'min(820px,98vw)' }}>

          {addMutation.error && (
            <div style={{ color: '#fca5a5',
              fontSize: 'clamp(11px,1.6vmin,16px)', textAlign: 'center' }}>
              {addMutation.error.message}
            </div>
          )}

          <button
            disabled={addMutation.isPending}
            onClick={() => handleConsent(true)}
            style={s({
              background: addMutation.isPending ? 'rgba(179,145,104,.5)' : '#B39168',
              border: '2px solid #a07d54',
              borderRadius: 'clamp(10px,1.5vmin,18px)',
              color: 'white', fontWeight: 800,
              cursor: addMutation.isPending ? 'not-allowed' : 'pointer',
              padding: 'clamp(14px,2.5vh,28px) clamp(20px,4vw,48px)',
              fontSize: 'clamp(18px,3vmin,32px)', lineHeight: 1.3, width: '100%',
            })}>
            ✓ Иә, келісемін / Да
            <div style={{ fontWeight: 400, fontSize: '.65em', opacity: .75, marginTop: 4 }}>
              На табло: «{previewName}»
            </div>
          </button>

          <button
            disabled={addMutation.isPending}
            onClick={() => handleConsent(false)}
            style={s({
              background: 'rgba(255,255,255,.1)',
              border: '2px solid rgba(255,255,255,.2)',
              borderRadius: 'clamp(10px,1.5vmin,18px)',
              color: 'white', fontWeight: 800,
              cursor: addMutation.isPending ? 'not-allowed' : 'pointer',
              padding: 'clamp(14px,2.5vh,28px) clamp(20px,4vw,48px)',
              fontSize: 'clamp(18px,3vmin,32px)', lineHeight: 1.3, width: '100%',
            })}>
            ✗ Жоқ / Нет
            <div style={{ fontWeight: 400, fontSize: '.65em', opacity: .65, marginTop: 4 }}>
              На табло: только порядковый номер
            </div>
          </button>
        </div>

        {/* Back button */}
        <button
          onClick={() => { setScreen('entry'); addMutation.reset(); }}
          style={s({
            background: 'none', border: 'none',
            color: 'rgba(255,255,255,.4)',
            fontSize: 'clamp(12px,1.8vmin,18px)', cursor: 'pointer',
          })}>
          ← Артқа / Назад
        </button>
      </div>
    );
  }
```

- [ ] **Step 4: Проверить TypeScript фронтенда**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit
```

Ожидаемый вывод: нет ошибок.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/kiosk/KioskPage.tsx
git commit -m "feat(kiosk): экран согласия на отображение имени на табло"
```

---

### Task 7: Ручная проверка end-to-end

- [ ] **Step 1: Поднять стек**

```bash
cd /home/administrator/projects_danik
docker-compose up -d
docker logs eque-backend -f
```

Убедиться что бэкенд запустился без ошибок.

- [ ] **Step 2: Проверить путь «согласие дано»**

1. Открыть `/kiosk/<slug>` в браузере
2. Ввести ФИО (Тест Тестовый Тестович), нажать «Далее» на последнем поле
3. Убедиться что появился экран согласия с карточкой «ТЕСТ Тестовый Тестович»
4. Нажать «✓ Иә, келісемін / Да»
5. Убедиться что перешли на экран подтверждения с номером
6. Открыть `/board/<slug>` — в очереди должно быть «Тестовый Те.»

- [ ] **Step 3: Проверить путь «согласие не дано»**

1. Повторить запись с другим именем (Приват Анонимов)
2. На экране согласия нажать «✗ Жоқ / Нет»
3. Открыть `/board/<slug>` — в очереди должен быть «№2» (или текущий номер), без имени

- [ ] **Step 4: Проверить кнопку «Назад»**

1. Зайти на экран согласия
2. Нажать «← Артқа / Назад»
3. Убедиться что вернулись на экран ввода с сохранёнными данными

- [ ] **Step 5: Проверить TTS при вызове без согласия**

1. Вызвать пациента без согласия из рабочего места врача
2. На табло должен прозвучать «Номер X, кабинет Y» (не имя)
3. `CallOverlay` должен показывать «№X» вместо имени

- [ ] **Step 6: Проверить регистраторский путь (дефолт)**

1. Добавить пациента через регистратуру
2. На табло должно показываться имя как раньше (поскольку `displayConsent = true` по умолчанию)
