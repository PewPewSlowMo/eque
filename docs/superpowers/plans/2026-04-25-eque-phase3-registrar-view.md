# СЭО Phase 3: Registrar View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать полноценный интерфейс регистратора/колл-центра — постановка пациентов в очередь к врачам и управление списком ожидания в реальном времени.

**Architecture:** Два таба в `RegistrarView`: «Постановка в очередь» (поиск/создание пациента → форма) и «Список ожидания» (живой список по всем врачам с кнопками действий). Socket.io слушает `queue:updated` → инвалидирует tRPC-кэш. `trpc` — `createTRPCReact<any>()`, все запросы через хуки `useQuery`/`useMutation`.

**Tech Stack:** React 18, Vite, Tailwind CSS, shadcn/ui (Radix UI), react-hook-form, socket.io-client, @tanstack/react-query, tRPC

---

## Файловая структура

```
apps/frontend/src/
  components/
    ui/
      tabs.tsx           CREATE  Radix Tabs обёртка (shadcn-style)
      select.tsx         CREATE  Radix Select обёртка (shadcn-style)
      dialog.tsx         CREATE  Radix Dialog обёртка (shadcn-style)
    registrar/
      useQueueSocket.ts  CREATE  хук: слушает queue:updated, инвалидирует кэш
      PatientSearch.tsx  CREATE  поиск пациента + кнопка «Создать нового»
      AddToQueueForm.tsx CREATE  форма постановки в очередь
      WaitingList.tsx    CREATE  список очереди для всех активных врачей
      QueueEntryRow.tsx  CREATE  строка очереди с кнопками действий
    RegistrarView.tsx    MODIFY  заглушка → финальный компонент с табами
```

> **Соглашения проекта:**
> - `trpc.xxx.useQuery()` / `trpc.xxx.useMutation()` — типизация `any`, TS не мешает
> - Тосты через `toast` из `sonner` (уже подключён в `App.tsx`)
> - `useUser()` — получить `user.allowedCategories`, `user.role`
> - `getSocket()` из `@/lib/socket` — синглтон Socket.io
> - Иконки из `lucide-react`

---

### Task 1: UI-примитивы — Tabs, Select, Dialog

**Files:**
- Create: `apps/frontend/src/components/ui/tabs.tsx`
- Create: `apps/frontend/src/components/ui/select.tsx`
- Create: `apps/frontend/src/components/ui/dialog.tsx`

Все три пакета уже установлены (`@radix-ui/react-tabs`, `@radix-ui/react-select`, `@radix-ui/react-dialog`). Нужны только обёртки в стиле shadcn/ui.

- [ ] **Step 1: Создать tabs.tsx**

```tsx
// apps/frontend/src/components/ui/tabs.tsx
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
```

- [ ] **Step 2: Создать select.tsx**

```tsx
// apps/frontend/src/components/ui/select.tsx
import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className,
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('py-1.5 pl-8 pr-2 text-sm font-semibold', className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectLabel };
```

- [ ] **Step 3: Создать dialog.tsx**

```tsx
// apps/frontend/src/components/ui/dialog.tsx
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Закрыть</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose };
```

- [ ] **Step 4: Проверить TypeScript**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Ожидаем: нет ошибок в новых файлах.

- [ ] **Step 5: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(ui): примитивы Tabs, Select, Dialog для регистратора" && git push
```

---

### Task 2: Хук useQueueSocket + PatientSearch

**Files:**
- Create: `apps/frontend/src/components/registrar/useQueueSocket.ts`
- Create: `apps/frontend/src/components/registrar/PatientSearch.tsx`

- [ ] **Step 1: Создать useQueueSocket.ts**

Хук подключается к Socket.io и при событии `queue:updated` инвалидирует кэш очереди для нужного врача.

```typescript
// apps/frontend/src/components/registrar/useQueueSocket.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';

export function useQueueSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    const handleQueueUpdated = () => {
      // Инвалидируем все запросы очереди — react-query refetch'ит автоматически
      queryClient.invalidateQueries({ queryKey: [['queue', 'getByDoctor']] });
      queryClient.invalidateQueries({ queryKey: [['assignments', 'getActive']] });
    };

    socket.on('queue:updated', handleQueueUpdated);
    socket.on('queue:called', handleQueueUpdated);
    socket.on('assignment:created', handleQueueUpdated);
    socket.on('assignment:ended', handleQueueUpdated);

    return () => {
      socket.off('queue:updated', handleQueueUpdated);
      socket.off('queue:called', handleQueueUpdated);
      socket.off('assignment:created', handleQueueUpdated);
      socket.off('assignment:ended', handleQueueUpdated);
    };
  }, [queryClient]);
}
```

- [ ] **Step 2: Создать PatientSearch.tsx**

Компонент: поле поиска с debounce (300ms) → список результатов → выбор → или кнопка «Создать нового пациента» (диалог с минимальной формой).

```tsx
// apps/frontend/src/components/registrar/PatientSearch.tsx
import { useState, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UserPlus, Search } from 'lucide-react';
import { toast } from 'sonner';

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  phone?: string | null;
  iin?: string | null;
}

interface PatientSearchProps {
  onSelect: (patient: Patient) => void;
  selected: Patient | null;
}

export function PatientSearch({ onSelect, selected }: PatientSearchProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newPatient, setNewPatient] = useState({
    lastName: '', firstName: '', middleName: '', phone: '', iin: '',
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [] } = trpc.patients.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 1 },
  );

  const createMutation = trpc.patients.create.useMutation({
    onSuccess: (patient: Patient) => {
      onSelect(patient);
      setCreateOpen(false);
      setNewPatient({ lastName: '', firstName: '', middleName: '', phone: '', iin: '' });
      toast.success('Пациент создан');
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (selected) {
    return (
      <div className="flex items-center justify-between p-3 border rounded-md bg-secondary/30">
        <div>
          <p className="font-medium text-sm">
            {selected.lastName} {selected.firstName} {selected.middleName ?? ''}
          </p>
          {selected.phone && <p className="text-xs text-muted-foreground">{selected.phone}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => onSelect(null as any)}>
          Изменить
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Поиск по ФИО, телефону, ИИН..."
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="pl-9"
        />
      </div>

      {open && debouncedQuery.length >= 1 && (
        <div className="border rounded-md bg-background shadow-md max-h-48 overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">Пациенты не найдены</p>
          ) : (
            results.map((p: Patient) => (
              <button
                key={p.id}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => { onSelect(p); setOpen(false); setQuery(''); }}
              >
                <span className="font-medium">{p.lastName} {p.firstName} {p.middleName ?? ''}</span>
                {p.phone && <span className="ml-2 text-muted-foreground">{p.phone}</span>}
              </button>
            ))
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <UserPlus className="h-4 w-4 mr-2" />
            Создать нового пациента
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый пациент</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Фамилия *</Label>
                <Input value={newPatient.lastName}
                  onChange={e => setNewPatient(p => ({ ...p, lastName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Имя *</Label>
                <Input value={newPatient.firstName}
                  onChange={e => setNewPatient(p => ({ ...p, firstName: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Отчество</Label>
              <Input value={newPatient.middleName}
                onChange={e => setNewPatient(p => ({ ...p, middleName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Телефон</Label>
                <Input value={newPatient.phone}
                  onChange={e => setNewPatient(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>ИИН</Label>
                <Input value={newPatient.iin}
                  onChange={e => setNewPatient(p => ({ ...p, iin: e.target.value }))} />
              </div>
            </div>
            <Button
              className="w-full"
              disabled={!newPatient.lastName || !newPatient.firstName || createMutation.isPending}
              onClick={() => createMutation.mutate({
                lastName: newPatient.lastName,
                firstName: newPatient.firstName,
                middleName: newPatient.middleName || undefined,
                phone: newPatient.phone || undefined,
                iin: newPatient.iin || undefined,
              })}
            >
              {createMutation.isPending ? 'Создание...' : 'Создать'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Ожидаем: нет ошибок.

- [ ] **Step 4: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(registrar): хук socket и компонент поиска пациента" && git push
```

---

### Task 3: AddToQueueForm

**Files:**
- Create: `apps/frontend/src/components/registrar/AddToQueueForm.tsx`

Форма: выбор врача из активных назначений, приоритет, категория (фильтр по `user.allowedCategories`), опциональные: дата/время для SCHEDULED, примечания.

- [ ] **Step 1: Создать AddToQueueForm.tsx**

```tsx
// apps/frontend/src/components/registrar/AddToQueueForm.tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PatientSearch } from './PatientSearch';
import { toast } from 'sonner';

const PRIORITY_OPTIONS = [
  { value: 'EMERGENCY', label: '🔴 Экстренный' },
  { value: 'INPATIENT',  label: '🟠 Стационарный' },
  { value: 'SCHEDULED',  label: '🟡 Плановый' },
  { value: 'WALK_IN',    label: '🟢 Обращение' },
];

const CATEGORY_LABELS: Record<string, string> = {
  PAID_ONCE:     'Платный (разовый)',
  PAID_CONTRACT: 'Платный (договор)',
  OSMS:          'ОМС',
  CONTINGENT:    'Контингент',
  EMPLOYEE:      'Сотрудник',
};

interface Patient { id: string; firstName: string; lastName: string; middleName?: string | null; phone?: string | null; }

export function AddToQueueForm() {
  const { user } = useUser();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [priority, setPriority] = useState('WALK_IN');
  const [category, setCategory] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');

  const { data: assignments = [] } = trpc.assignments.getActive.useQuery();

  const addMutation = trpc.queue.add.useMutation({
    onSuccess: () => {
      toast.success('Пациент добавлен в очередь');
      setPatient(null);
      setDoctorId('');
      setPriority('WALK_IN');
      setCategory('');
      setScheduledAt('');
      setNotes('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Категории доступные этому пользователю
  const allowedCategories = user?.allowedCategories ?? [];
  const categoryOptions = allowedCategories.length > 0
    ? allowedCategories
    : Object.keys(CATEGORY_LABELS);

  const source = user?.role === 'CALL_CENTER' ? 'CALL_CENTER' : 'REGISTRAR';

  const canSubmit = patient && doctorId && priority && category && !addMutation.isPending;

  return (
    <div className="space-y-5 max-w-lg">
      <div className="space-y-1">
        <Label>Пациент *</Label>
        <PatientSearch selected={patient} onSelect={p => setPatient(p)} />
      </div>

      <div className="space-y-1">
        <Label>Врач *</Label>
        <Select value={doctorId} onValueChange={setDoctorId}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите врача..." />
          </SelectTrigger>
          <SelectContent>
            {(assignments as any[]).length === 0 && (
              <SelectItem value="none" disabled>Нет активных врачей</SelectItem>
            )}
            {(assignments as any[]).map((a: any) => (
              <SelectItem key={a.doctorId} value={a.doctorId}>
                {a.doctor.lastName} {a.doctor.firstName} — каб. {a.cabinet.number}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>Приоритет *</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Категория *</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите..." />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((c: string) => (
                <SelectItem key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {priority === 'SCHEDULED' && (
        <div className="space-y-1">
          <Label>Плановое время</Label>
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={e => setScheduledAt(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-1">
        <Label>Примечание</Label>
        <Input
          placeholder="Необязательно..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      <Button
        className="w-full"
        disabled={!canSubmit}
        onClick={() =>
          addMutation.mutate({
            doctorId,
            patientId: patient!.id,
            priority: priority as any,
            category: category as any,
            source: source as any,
            scheduledAt: priority === 'SCHEDULED' && scheduledAt
              ? new Date(scheduledAt).toISOString()
              : undefined,
            notes: notes || undefined,
          })
        }
      >
        {addMutation.isPending ? 'Добавление...' : 'Добавить в очередь'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "error TS" | head -10
```

- [ ] **Step 3: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(registrar): форма постановки пациента в очередь" && git push
```

---

### Task 4: QueueEntryRow + WaitingList

**Files:**
- Create: `apps/frontend/src/components/registrar/QueueEntryRow.tsx`
- Create: `apps/frontend/src/components/registrar/WaitingList.tsx`

- [ ] **Step 1: Создать QueueEntryRow.tsx**

Строка одной записи в очереди. Показывает: номер, ФИО пациента, приоритет, категорию, статус, время. Кнопки: «Подтвердить приход» (если WAITING_ARRIVAL), «Оплата» (если не paymentConfirmed), «Отмена».

```tsx
// apps/frontend/src/components/registrar/QueueEntryRow.tsx
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CheckCircle, CreditCard, X } from 'lucide-react';

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
  IN_PROGRESS:     'На приёме',
  COMPLETED:       'Завершён',
  NO_SHOW:         'Не явился',
  CANCELLED:       'Отменён',
};

const CATEGORY_SHORT: Record<string, string> = {
  PAID_ONCE:     'Платный',
  PAID_CONTRACT: 'Договор',
  OSMS:          'ОМС',
  CONTINGENT:    'Контингент',
  EMPLOYEE:      'Сотрудник',
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  status: string;
  priority: string;
  category: string;
  paymentConfirmed: boolean;
  requiresArrivalConfirmation: boolean;
  arrivedAt?: string | null;
  patient: { id: string; firstName: string; lastName: string; middleName?: string | null };
}

interface QueueEntryRowProps {
  entry: QueueEntry;
}

export function QueueEntryRow({ entry }: QueueEntryRowProps) {
  const utils = trpc.useUtils();

  const confirmArrival = trpc.queue.confirmArrival.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate();
      toast.success('Приход подтверждён');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const confirmPayment = trpc.queue.confirmPayment.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate();
      toast.success('Оплата подтверждена');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancel = trpc.queue.cancel.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate();
      toast.info('Запись отменена');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const prio = PRIORITY_BADGE[entry.priority] ?? { label: entry.priority, variant: 'outline' as const };
  const isTerminal = ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status);

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-accent/30 transition-colors">
      <span className="text-lg font-bold text-muted-foreground w-8 text-center">
        {entry.queueNumber}
      </span>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {entry.patient.lastName} {entry.patient.firstName}{' '}
          {entry.patient.middleName ?? ''}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <Badge variant={prio.variant} className="text-xs">{prio.label}</Badge>
          <span className="text-xs text-muted-foreground">{CATEGORY_SHORT[entry.category] ?? entry.category}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{STATUS_LABELS[entry.status] ?? entry.status}</span>
          {!entry.paymentConfirmed && !isTerminal && (
            <Badge variant="outline" className="text-xs text-orange-600 border-orange-400">Ожидает оплаты</Badge>
          )}
        </div>
      </div>

      {!isTerminal && (
        <div className="flex items-center gap-1 shrink-0">
          {entry.status === 'WAITING_ARRIVAL' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={confirmArrival.isPending}
              onClick={() => confirmArrival.mutate({ entryId: entry.id })}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              Пришёл
            </Button>
          )}
          {!entry.paymentConfirmed && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={confirmPayment.isPending}
              onClick={() => confirmPayment.mutate({ entryId: entry.id })}
            >
              <CreditCard className="h-3.5 w-3.5 mr-1" />
              Оплата
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
      )}
    </div>
  );
}
```

- [ ] **Step 2: Создать WaitingList.tsx**

Показывает очередь по каждому активному врачу.

```tsx
// apps/frontend/src/components/registrar/WaitingList.tsx
import { trpc } from '@/lib/trpc';
import { QueueEntryRow } from './QueueEntryRow';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';

function DoctorQueue({ assignment }: { assignment: any }) {
  const { data: entries = [], isLoading } = trpc.queue.getByDoctor.useQuery(
    { doctorId: assignment.doctorId },
    { refetchInterval: 30_000 },
  );

  const active = (entries as any[]).filter(
    (e: any) => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status),
  );

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-secondary/40 px-4 py-2.5 flex items-center justify-between">
        <div>
          <span className="font-semibold text-sm">
            {assignment.doctor.lastName} {assignment.doctor.firstName}
          </span>
          {assignment.doctor.specialty && (
            <span className="ml-2 text-xs text-muted-foreground">{assignment.doctor.specialty}</span>
          )}
          <span className="ml-2 text-xs text-muted-foreground">
            · каб. {assignment.cabinet.number}
          </span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {active.length} в очереди
        </Badge>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground p-3">Загрузка...</p>
      ) : active.length === 0 ? (
        <p className="text-xs text-muted-foreground p-3">Очередь пуста</p>
      ) : (
        <div className="divide-y">
          {active.map((entry: any) => (
            <QueueEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WaitingList() {
  const { data: assignments = [], isLoading } = trpc.assignments.getActive.useQuery(
    undefined,
    { refetchInterval: 30_000 },
  );

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Загрузка врачей...</p>;
  }

  if ((assignments as any[]).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <Users className="h-8 w-8" />
        <p className="text-sm">Нет активных врачей</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(assignments as any[]).map((a: any) => (
        <DoctorQueue key={a.id} assignment={a} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "error TS" | head -10
```

- [ ] **Step 4: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(registrar): список ожидания с кнопками действий" && git push
```

---

### Task 5: RegistrarView — финальная сборка

**Files:**
- Modify: `apps/frontend/src/components/RegistrarView.tsx`

- [ ] **Step 1: Заменить заглушку на полный компонент**

```tsx
// apps/frontend/src/components/RegistrarView.tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AddToQueueForm } from './registrar/AddToQueueForm';
import { WaitingList } from './registrar/WaitingList';
import { useQueueSocket } from './registrar/useQueueSocket';
import { ClipboardList, UserPlus } from 'lucide-react';

export function RegistrarView() {
  useQueueSocket();

  return (
    <div className="space-y-4">
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue" className="gap-2">
            <UserPlus className="h-4 w-4" />
            Постановка в очередь
          </TabsTrigger>
          <TabsTrigger value="waiting" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Список ожидания
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="pt-4">
          <AddToQueueForm />
        </TabsContent>

        <TabsContent value="waiting" className="pt-4">
          <WaitingList />
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

- [ ] **Step 3: Проверить сборку frontend**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend build 2>&1 | tail -10
```

Ожидаем: сборка без ошибок.

- [ ] **Step 4: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(registrar): RegistrarView — постановка в очередь и список ожидания" && git push
```

---

## Self-Review

**Spec coverage:**
- ✅ Вкладка «Постановка в очередь» → `AddToQueueForm` + `PatientSearch`
- ✅ Поиск пациента по ФИО/телефону/ИИН → `PatientSearch` с debounce
- ✅ Создание нового пациента → диалог в `PatientSearch`
- ✅ Выбор врача из активных назначений → `AddToQueueForm` select из `assignments.getActive`
- ✅ Выбор приоритета (4 варианта) → select с метками
- ✅ Выбор категории (фильтр по `allowedCategories`) → select
- ✅ Плановое время для SCHEDULED → показывается при выборе SCHEDULED
- ✅ Примечание → поле notes
- ✅ Вкладка «Список ожидания» → `WaitingList` + `DoctorQueue` + `QueueEntryRow`
- ✅ Подтверждение прихода → кнопка «Пришёл» при статусе `WAITING_ARRIVAL`
- ✅ Подтверждение оплаты → кнопка «Оплата» при `paymentConfirmed=false`
- ✅ Отмена записи → кнопка X с confirm-диалогом
- ✅ Real-time обновления → `useQueueSocket` инвалидирует кэш по WebSocket событиям
- ✅ Группировка по врачам → `DoctorQueue` компонент

**Placeholder scan:** нет TBD, весь код приведён полностью.

**Type consistency:** `Patient` интерфейс определён в `PatientSearch.tsx`, в `AddToQueueForm` используется локальный одноимённый интерфейс. `QueueEntry` определён в `QueueEntryRow.tsx` и передаётся туда же. Всё согласованно.

---

**План сохранён в `docs/superpowers/plans/2026-04-25-eque-phase3-registrar-view.md`.**

**Два варианта выполнения:**

**1. Subagent-Driven (рекомендуется)** — отдельный агент на каждую задачу, проверка между задачами

**2. Inline Execution** — выполнение в этой сессии

**Какой подход?**
