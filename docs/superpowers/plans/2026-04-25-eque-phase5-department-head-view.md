# СЭО Phase 5: Department Head View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать интерфейс руководителя отдела — read-only обзор очередей всех врачей отдела и управление назначениями (назначить врача в кабинет / снять).

**Architecture:** `DepartmentHeadView` загружает все активные назначения через `assignments.getActive` и фильтрует по `doctor.departmentId === user.departmentId` на фронте. Вкладка «Очередь» — сетка карточек `DoctorQueueCard` (каждая сама подгружает свою очередь). Вкладка «Назначения» — список активных назначений с unassign + диалог `AssignDoctorDialog`. Socket.io через переиспользованный `useQueueSocket`.

**Tech Stack:** React 18, Vite, Tailwind CSS, shadcn/ui (Badge, Button, Card, Tabs, Select, Dialog), tRPC, socket.io-client

---

## Файловая структура

```
apps/frontend/src/
  components/
    head/
      DoctorQueueCard.tsx     CREATE  read-only карточка одного врача: текущий пациент + счётчик очереди
      AssignDoctorDialog.tsx  CREATE  диалог назначения врача в кабинет (assignments.assign)
    DepartmentHeadView.tsx    MODIFY  заглушка → табы «Очередь» + «Назначения»
```

> **Соглашения проекта:**
> - `trpc.xxx.useQuery()` / `trpc.xxx.useMutation()` — типизация `any`, TS не мешает
> - Тосты через `toast` из `sonner`
> - `useUser()` из `@/contexts/UserContext` → `user.departmentId`
> - `users.getAll` — ADMIN-only, нельзя использовать. Правильный хук: `trpc.users.getDoctors.useQuery({ departmentId })`
> - `assignments.getActive` — возвращает все активные назначения, поле `doctor.departmentId` для фильтрации
> - `useQueueSocket()` из `./registrar/useQueueSocket` — реиспользуем
> - Иконки из `lucide-react`

---

### Task 1: DoctorQueueCard

**Files:**
- Create: `apps/frontend/src/components/head/DoctorQueueCard.tsx`

Read-only карточка одного активного врача. Получает `assignment` как prop (уже загружен в родителе из `getActive`). Внутри подгружает очередь врача через `trpc.queue.getByDoctor`. Показывает: ФИО, специальность, кабинет, текущий пациент (IN_PROGRESS) с приоритетом, количество ожидающих.

- [ ] **Step 1: Создать DoctorQueueCard.tsx**

```tsx
// apps/frontend/src/components/head/DoctorQueueCard.tsx
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users } from 'lucide-react';

const PRIORITY_BADGE: Record<string, { label: string; variant: 'destructive' | 'default' | 'secondary' | 'outline' }> = {
  EMERGENCY: { label: 'Экстренный', variant: 'destructive' },
  INPATIENT:  { label: 'Стационарный', variant: 'default' },
  SCHEDULED:  { label: 'Плановый', variant: 'secondary' },
  WALK_IN:    { label: 'Обращение', variant: 'outline' },
};

interface DoctorQueueCardProps {
  assignment: any;
}

export function DoctorQueueCard({ assignment }: DoctorQueueCardProps) {
  const { data: entries = [] } = trpc.queue.getByDoctor.useQuery(
    { doctorId: assignment.doctorId },
    { refetchInterval: 30_000 },
  );

  const allEntries = entries as any[];
  const active = allEntries.filter(
    (e: any) => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status),
  );
  const inProgress = active.find((e: any) => e.status === 'IN_PROGRESS') ?? null;
  const waitingCount = active.filter((e: any) => e.status !== 'IN_PROGRESS').length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
          <span className="truncate">
            {assignment.doctor.lastName} {assignment.doctor.firstName}
            {assignment.doctor.specialty && (
              <span className="ml-1 font-normal text-muted-foreground">
                · {assignment.doctor.specialty}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground font-normal shrink-0">
            каб. {assignment.cabinet.number}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {inProgress ? (
          <div className="flex items-center gap-2">
            <Badge
              variant={PRIORITY_BADGE[inProgress.priority]?.variant ?? 'outline'}
              className="text-xs shrink-0"
            >
              На приёме
            </Badge>
            <span className="text-sm truncate">
              {inProgress.patient.lastName} {inProgress.patient.firstName}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Нет активного пациента</p>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>{waitingCount} ожидают</span>
        </div>
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
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(head): карточка очереди врача для руководителя отдела" && git push
```

---

### Task 2: AssignDoctorDialog

**Files:**
- Create: `apps/frontend/src/components/head/AssignDoctorDialog.tsx`

Диалог назначения врача в кабинет. Получает `doctors` и `cabinets` как пропсы (уже загружены в родителе). Внутри — два Select (врач, кабинет) и кнопка «Назначить». После успеха инвалидирует `assignments.getActive`, закрывает диалог, показывает toast.

- [ ] **Step 1: Создать AssignDoctorDialog.tsx**

```tsx
// apps/frontend/src/components/head/AssignDoctorDialog.tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';

interface AssignDoctorDialogProps {
  doctors: any[];
  cabinets: any[];
}

export function AssignDoctorDialog({ doctors, cabinets }: AssignDoctorDialogProps) {
  const [open, setOpen] = useState(false);
  const [doctorId, setDoctorId] = useState('');
  const [cabinetId, setCabinetId] = useState('');
  const utils = trpc.useUtils();

  const assign = trpc.assignments.assign.useMutation({
    onSuccess: () => {
      utils.assignments.getActive.invalidate();
      toast.success('Врач назначен');
      setOpen(false);
      setDoctorId('');
      setCabinetId('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <UserPlus className="h-4 w-4" />
          Назначить врача
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Назначить врача в кабинет</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Врач</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите врача..." />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.lastName} {d.firstName}
                    {d.specialty ? ` — ${d.specialty}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Кабинет</Label>
            <Select value={cabinetId} onValueChange={setCabinetId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите кабинет..." />
              </SelectTrigger>
              <SelectContent>
                {cabinets.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.number}{c.name ? ` — ${c.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="w-full"
            disabled={!doctorId || !cabinetId || assign.isPending}
            onClick={() => assign.mutate({ doctorId, cabinetId })}
          >
            {assign.isPending ? 'Назначение...' : 'Назначить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(head): диалог назначения врача в кабинет" && git push
```

---

### Task 3: DepartmentHeadView — финальная сборка

**Files:**
- Modify: `apps/frontend/src/components/DepartmentHeadView.tsx`

Главный компонент. Загружает данные, фильтрует по отделу, рендерит два таба:
- «Очередь» — сетка `DoctorQueueCard` для каждого активного врача отдела
- «Назначения» — список назначений с кнопкой «Снять» + `AssignDoctorDialog`

Использует `useQueueSocket` для real-time инвалидации.

- [ ] **Step 1: Заменить заглушку**

```tsx
// apps/frontend/src/components/DepartmentHeadView.tsx
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { useQueueSocket } from './registrar/useQueueSocket';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { DoctorQueueCard } from './head/DoctorQueueCard';
import { AssignDoctorDialog } from './head/AssignDoctorDialog';
import { toast } from 'sonner';
import { LayoutGrid, Users } from 'lucide-react';

export function DepartmentHeadView() {
  const { user } = useUser();
  const departmentId = user?.departmentId ?? '';

  useQueueSocket();

  const { data: allAssignments = [] } = trpc.assignments.getActive.useQuery();
  const { data: doctors = [] } = trpc.users.getDoctors.useQuery(
    { departmentId },
    { enabled: !!departmentId },
  );
  const { data: cabinets = [] } = trpc.cabinets.getAll.useQuery();
  const utils = trpc.useUtils();

  const unassign = trpc.assignments.unassign.useMutation({
    onSuccess: () => {
      utils.assignments.getActive.invalidate();
      toast.success('Назначение снято');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deptAssignments = (allAssignments as any[]).filter(
    (a: any) => a.doctor.departmentId === departmentId,
  );

  return (
    <div className="space-y-4">
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue" className="gap-2">
            <LayoutGrid className="h-4 w-4" />
            Очередь
          </TabsTrigger>
          <TabsTrigger value="assignments" className="gap-2">
            <Users className="h-4 w-4" />
            Назначения
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="pt-4">
          {deptAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              Нет активных врачей в отделе
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {deptAssignments.map((a: any) => (
                <DoctorQueueCard key={a.id} assignment={a} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="assignments" className="pt-4">
          <div className="space-y-4">
            <div className="flex justify-end">
              <AssignDoctorDialog
                doctors={doctors as any[]}
                cabinets={cabinets as any[]}
              />
            </div>

            {deptAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Нет активных назначений
              </p>
            ) : (
              <div className="border rounded-lg divide-y">
                {deptAssignments.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="font-medium text-sm">
                        {a.doctor.lastName} {a.doctor.firstName}
                        {a.doctor.specialty && (
                          <span className="ml-1 text-muted-foreground font-normal">
                            · {a.doctor.specialty}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Кабинет {a.cabinet.number}
                        {a.cabinet.name ? ` — ${a.cabinet.name}` : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={unassign.isPending}
                      onClick={() => {
                        if (confirm(`Снять назначение врача ${a.doctor.lastName}?`)) {
                          unassign.mutate({ assignmentId: a.id });
                        }
                      }}
                    >
                      Снять
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
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
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(head): DepartmentHeadView — очередь отдела и управление назначениями" && git push
```

---

## Self-Review

**Spec coverage:**
- ✅ Вкладка «Очередь» — список активных врачей отдела с карточками → `DoctorQueueCard` в сетке
- ✅ Read-only: в `DoctorQueueCard` нет кнопок действий
- ✅ Текущий пациент (IN_PROGRESS) с приоритетом → поле `inProgress` в `DoctorQueueCard`
- ✅ Количество в очереди → `waitingCount` в `DoctorQueueCard`
- ✅ Вкладка «Назначения» — список активных назначений отдела → `deptAssignments`
- ✅ Кнопка «Снять» → `assignments.unassign` с confirm
- ✅ Назначить врача в кабинет → `AssignDoctorDialog` с `assignments.assign`
- ✅ Socket real-time → `useQueueSocket` в `DepartmentHeadView`
- ✅ Фильтрация по отделу → `a.doctor.departmentId === departmentId`
- ✅ `users.getDoctors({ departmentId })` (не `getAll` — он ADMIN-only) → корректно
- ✅ `cabinets.getAll` для списка кабинетов в диалоге

**Placeholder scan:** нет TBD, весь код полный.

**Type consistency:** `assignment: any` используется одинаково во всех трёх файлах. `doctors: any[]` и `cabinets: any[]` передаются из `DepartmentHeadView` в `AssignDoctorDialog` и используются корректно.
