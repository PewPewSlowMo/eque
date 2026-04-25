# СЭО Phase 4: Doctor View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать интерфейс врача — панель текущего пациента, вызов следующего и управление очередью в реальном времени.

**Architecture:** `DoctorView` получает `doctorId` из `useUser()`, загружает очередь через `trpc.queue.getByDoctor` и назначение через `trpc.assignments.getForDoctor`. Записи разделяются на «текущий пациент» (IN_PROGRESS) и «список ожидания» (ARRIVED, WAITING_ARRIVAL, CALLED). Real-time через существующий `useQueueSocket` (Phase 3). Два дочерних компонента: `CurrentPatientCard` и `DoctorQueueList`, которым doctorId и entries передаются как props.

**Tech Stack:** React 18, Vite, Tailwind CSS, shadcn/ui (Badge, Button, Card), tRPC, socket.io-client

---

## Файловая структура

```
apps/frontend/src/
  components/
    doctor/
      CurrentPatientCard.tsx   CREATE  карточка IN_PROGRESS пациента + кнопка «Завершить приём»
      DoctorQueueList.tsx      CREATE  кнопка «Вызвать следующего» + список очереди с действиями
    DoctorView.tsx             MODIFY  заглушка → финальный компонент (3 строки → ~50)
```

> **Соглашения проекта:**
> - `trpc.xxx.useQuery()` / `trpc.xxx.useMutation()` — типизация `any`, TS не блокирует
> - Тосты через `toast` из `sonner`
> - `useUser()` из `@/contexts/UserContext` → `user.id` = doctorId
> - `useQueueSocket()` из `./registrar/useQueueSocket` — реиспользуем, он уже инвалидирует `queue.getByDoctor`
> - Иконки из `lucide-react`
> - `Badge`, `Button`, `Card`, `CardHeader`, `CardTitle`, `CardContent` — все уже в `ui/`

---

### Task 1: CurrentPatientCard

**Files:**
- Create: `apps/frontend/src/components/doctor/CurrentPatientCard.tsx`

Показывает карточку пациента со статусом IN_PROGRESS. Кнопка «Завершить приём» вызывает `trpc.queue.complete` и инвалидирует кэш.

- [ ] **Step 1: Создать CurrentPatientCard.tsx**

```tsx
// apps/frontend/src/components/doctor/CurrentPatientCard.tsx
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';

const PRIORITY_BADGE: Record<string, { label: string; variant: 'destructive' | 'default' | 'secondary' | 'outline' }> = {
  EMERGENCY: { label: 'Экстренный', variant: 'destructive' },
  INPATIENT:  { label: 'Стационарный', variant: 'default' },
  SCHEDULED:  { label: 'Плановый', variant: 'secondary' },
  WALK_IN:    { label: 'Обращение', variant: 'outline' },
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  priority: string;
  patient: { firstName: string; lastName: string; middleName?: string | null };
}

interface CurrentPatientCardProps {
  entry: QueueEntry;
  doctorId: string;
}

export function CurrentPatientCard({ entry, doctorId }: CurrentPatientCardProps) {
  const utils = trpc.useUtils();

  const complete = trpc.queue.complete.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      toast.success('Приём завершён');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const prio = PRIORITY_BADGE[entry.priority] ?? { label: entry.priority, variant: 'outline' as const };

  return (
    <Card className="border-2 border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          На приёме
          <Badge variant={prio.variant}>{prio.label}</Badge>
          <span className="ml-auto text-muted-foreground font-normal text-sm">
            №{entry.queueNumber}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <p className="text-xl font-bold">
          {entry.patient.lastName} {entry.patient.firstName}{' '}
          {entry.patient.middleName ?? ''}
        </p>
        <Button
          onClick={() => complete.mutate({ entryId: entry.id })}
          disabled={complete.isPending}
          className="gap-2"
        >
          <CheckCircle2 className="h-4 w-4" />
          {complete.isPending ? 'Завершение...' : 'Завершить приём'}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Ожидаем: нет ошибок в новом файле.

- [ ] **Step 3: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(doctor): карточка текущего пациента" && git push
```

---

### Task 2: DoctorQueueList

**Files:**
- Create: `apps/frontend/src/components/doctor/DoctorQueueList.tsx`

Принимает `entries` (ARRIVED + WAITING_ARRIVAL + CALLED) и `doctorId`. Вверху — кнопка «Вызвать следующего» (`queue.callNext`). Ниже — список записей с кнопками «Неявка» (для WAITING_ARRIVAL и ARRIVED) и «Отмена».

`callNext` активна только если есть хотя бы один entry со статусом `ARRIVED` и `paymentConfirmed === true`.

- [ ] **Step 1: Создать DoctorQueueList.tsx**

```tsx
// apps/frontend/src/components/doctor/DoctorQueueList.tsx
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { UserCheck, Ban, X } from 'lucide-react';

const PRIORITY_BADGE: Record<string, { label: string; variant: 'destructive' | 'default' | 'secondary' | 'outline' }> = {
  EMERGENCY: { label: 'Экстренный', variant: 'destructive' },
  INPATIENT:  { label: 'Стационарный', variant: 'default' },
  SCHEDULED:  { label: 'Плановый', variant: 'secondary' },
  WALK_IN:    { label: 'Обращение', variant: 'outline' },
};

const STATUS_LABELS: Record<string, string> = {
  WAITING_ARRIVAL: 'Ожидает прихода',
  ARRIVED:         'Прибыл',
  CALLED:          'Вызван',
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  status: string;
  priority: string;
  paymentConfirmed: boolean;
  patient: { firstName: string; lastName: string; middleName?: string | null };
}

interface DoctorQueueListProps {
  entries: QueueEntry[];
  doctorId: string;
}

export function DoctorQueueList({ entries, doctorId }: DoctorQueueListProps) {
  const utils = trpc.useUtils();

  const callNext = trpc.queue.callNext.useMutation({
    onSuccess: (result: any) => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      if (result.called) {
        toast.success(
          `Вызван: ${result.called.patient.lastName} ${result.called.patient.firstName}`,
        );
      } else {
        toast.info(result.message ?? 'Нет пациентов в очереди');
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const markNoShow = trpc.queue.markNoShow.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      toast.info('Отмечена неявка');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancel = trpc.queue.cancel.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      toast.info('Запись отменена');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const canCallNext = entries.some(
    (e) => e.status === 'ARRIVED' && e.paymentConfirmed,
  );

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Очередь пуста
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {entries.length} в очереди
        </span>
        <Button
          onClick={() => callNext.mutate({ doctorId })}
          disabled={!canCallNext || callNext.isPending}
          className="gap-2"
        >
          <UserCheck className="h-4 w-4" />
          {callNext.isPending ? 'Вызов...' : 'Вызвать следующего'}
        </Button>
      </div>

      <div className="border rounded-lg divide-y">
        {entries.map((entry) => {
          const prio = PRIORITY_BADGE[entry.priority] ?? {
            label: entry.priority,
            variant: 'outline' as const,
          };
          const canNoShow = ['WAITING_ARRIVAL', 'ARRIVED'].includes(entry.status);

          return (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-2">
              <span className="text-lg font-bold text-muted-foreground w-8 text-center shrink-0">
                {entry.queueNumber}
              </span>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {entry.patient.lastName} {entry.patient.firstName}{' '}
                  {entry.patient.middleName ?? ''}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant={prio.variant} className="text-xs">
                    {prio.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {STATUS_LABELS[entry.status] ?? entry.status}
                  </span>
                  {!entry.paymentConfirmed && (
                    <span className="text-xs text-orange-600">· ожидает оплаты</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {canNoShow && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={markNoShow.isPending}
                    onClick={() => markNoShow.mutate({ entryId: entry.id })}
                  >
                    <Ban className="h-3.5 w-3.5 mr-1" />
                    Неявка
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  disabled={cancel.isPending}
                  onClick={() => {
                    if (confirm(`Отменить запись пациента ${entry.patient.lastName}?`)) {
                      cancel.mutate({ entryId: entry.id });
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Ожидаем: нет ошибок в новом файле.

- [ ] **Step 3: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(doctor): список очереди с вызовом и действиями" && git push
```

---

### Task 3: DoctorView — финальная сборка

**Files:**
- Modify: `apps/frontend/src/components/DoctorView.tsx`

Получает `doctorId` из `useUser()`. Загружает очередь и назначение. Разбивает entries на `currentPatient` (IN_PROGRESS) и `waitingEntries` (остальные активные). Рендерит: кабинет вверху, `CurrentPatientCard` если есть, `DoctorQueueList`.

- [ ] **Step 1: Заменить заглушку**

```tsx
// apps/frontend/src/components/DoctorView.tsx
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { useQueueSocket } from './registrar/useQueueSocket';
import { CurrentPatientCard } from './doctor/CurrentPatientCard';
import { DoctorQueueList } from './doctor/DoctorQueueList';
import { Stethoscope } from 'lucide-react';

export function DoctorView() {
  const { user } = useUser();
  const doctorId = user?.id ?? '';

  useQueueSocket();

  const { data: entries = [], isLoading } = trpc.queue.getByDoctor.useQuery(
    { doctorId },
    { enabled: !!doctorId, refetchInterval: 30_000 },
  );

  const { data: assignment } = trpc.assignments.getForDoctor.useQuery(
    { doctorId },
    { enabled: !!doctorId },
  );

  const allEntries = entries as any[];

  const currentPatient = allEntries.find((e: any) => e.status === 'IN_PROGRESS') ?? null;
  const waitingEntries = allEntries.filter(
    (e: any) => !['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status),
  );

  if (!doctorId) {
    return <p className="text-muted-foreground text-sm">Загрузка...</p>;
  }

  return (
    <div className="space-y-6">
      {assignment && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Stethoscope className="h-4 w-4" />
          <span>
            Кабинет {(assignment as any).cabinet.number}
            {(assignment as any).cabinet.name
              ? ` — ${(assignment as any).cabinet.name}`
              : ''}
          </span>
        </div>
      )}

      {currentPatient && (
        <CurrentPatientCard entry={currentPatient} doctorId={doctorId} />
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка очереди...</p>
      ) : (
        <DoctorQueueList entries={waitingEntries} doctorId={doctorId} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Ожидаем: нет новых ошибок.

- [ ] **Step 3: Проверить сборку**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend build 2>&1 | tail -10
```

Ожидаем: сборка без ошибок.

- [ ] **Step 4: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(doctor): DoctorView — панель врача с очередью и приёмом" && git push
```

---

## Self-Review

**Spec coverage:**
- ✅ Панель текущего пациента (IN_PROGRESS): ФИО, приоритет, кнопка «Завершить приём» → `CurrentPatientCard`
- ✅ Список очереди (ARRIVED + WAITING_ARRIVAL + CALLED) → `DoctorQueueList`
- ✅ Кнопка «Вызвать следующего» (queue.callNext) — активна только при наличии ARRIVED+paymentConfirmed → `DoctorQueueList`
- ✅ Кнопка «Неявка» (markNoShow) — для WAITING_ARRIVAL и ARRIVED → `DoctorQueueList`
- ✅ Кнопка «Отмена» с confirm → `DoctorQueueList`
- ✅ Real-time через Socket.io → `useQueueSocket` реиспользован в `DoctorView`
- ✅ Назначение (кабинет) отображается вверху → `trpc.assignments.getForDoctor` в `DoctorView`
- ✅ doctorId из `useUser().user.id` → `DoctorView`

**Placeholder scan:** нет TBD, весь код приведён полностью.

**Type consistency:** `QueueEntry` interface определён локально в каждом компоненте с нужными полями — это YAGNI, нет общего типа чтобы не усложнять. `doctorId: string` передаётся во все мутации и инвалидации одинаково.
