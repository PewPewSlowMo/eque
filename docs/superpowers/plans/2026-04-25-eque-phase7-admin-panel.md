# СЭО Phase 7: Admin Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать AdminPanel с четырьмя вкладками: Пользователи, Кабинеты, Категории, Статистика. ADMIN — полный доступ, DIRECTOR — только просмотр (мутации скрыты или отключены).

**Architecture:** Чисто фронтендовая фаза — все backend-роутеры уже существуют. AdminPanel.tsx заменяет заглушку и собирает четыре таб-компонента. Каждая вкладка — отдельный файл в `apps/frontend/src/components/admin/`. Роль берётся из `useUser()`, кнопки мутаций скрыты для DIRECTOR условием `user.role === 'ADMIN'`.

**Tech Stack:** React 18 + Vite + Tailwind + shadcn/ui (Tabs, Dialog, Button, Input, Label, Select, Checkbox), tRPC hooks, sonner toast

---

## Файловая структура

```
apps/frontend/src/components/
  AdminPanel.tsx              MODIFY  заглушка → четыре вкладки
  admin/
    StatsTab.tsx              CREATE  dailyStats таблица с date picker
    CategoriesTab.tsx         CREATE  5 категорий × 2 чекбокса
    CabinetDialog.tsx         CREATE  диалог создания/редактирования кабинета
    CabinetsTab.tsx           CREATE  таблица кабинетов + CabinetDialog
    UserDialog.tsx            CREATE  диалог создания/редактирования пользователя
    UsersTab.tsx              CREATE  таблица пользователей + UserDialog
```

> **Не трогаем** backend — все роутеры уже реализованы:
> - `trpc.users.getAll`, `users.create`, `users.update`
> - `trpc.cabinets.getAll`, `cabinets.create`, `cabinets.update`, `cabinets.deactivate`
> - `trpc.settings.getCategorySettings`, `settings.updateCategorySettings`
> - `trpc.queue.dailyStats({ date? })`
> - `trpc.departments.getAll` — для select при создании пользователя/кабинета

> **Соглашения проекта:**
> - `(data as any)` при create/update — project-wide pattern
> - `trpc.useUtils()` для инвалидации, toast из `sonner`
> - shadcn компоненты из `@/components/ui/`
> - DIRECTOR видит AdminPanel, кнопки мутаций скрыты через `isAdmin = user.role === 'ADMIN'`

---

### Task 1: StatsTab

**Files:**
- Create: `apps/frontend/src/components/admin/StatsTab.tsx`

Таблица дневной статистики очереди. Выбор даты через `<input type="date">`. Запрос `trpc.queue.dailyStats({ date })` возвращает `{ status, priority, _count: { _all: number } }[]`. Отображаем как таблицу строк. Доступно и ADMIN, и DIRECTOR — нет мутаций.

- [ ] **Step 1: Создать StatsTab.tsx**

```tsx
// apps/frontend/src/components/admin/StatsTab.tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const STATUS_LABEL: Record<string, string> = {
  WAITING_ARRIVAL: 'Ожидает прихода',
  ARRIVED: 'Пришёл',
  CALLED: 'Вызван',
  IN_PROGRESS: 'На приёме',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
  NO_SHOW: 'Неявка',
};

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренный',
  INPATIENT: 'Стационарный',
  SCHEDULED: 'Плановый',
  WALK_IN: 'Обращение',
};

function toLocalDateValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function StatsTab() {
  const [dateValue, setDateValue] = useState(() => toLocalDateValue(new Date()));

  const { data: rows = [], isLoading } = trpc.queue.dailyStats.useQuery(
    { date: dateValue },
    { enabled: !!dateValue },
  );

  const total = (rows as any[]).reduce((sum: number, r: any) => sum + r._count._all, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Дата:</label>
        <input
          type="date"
          value={dateValue}
          onChange={(e) => setDateValue(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        />
        <span className="text-sm text-muted-foreground">Всего записей: {total}</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : (rows as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет данных за выбранную дату</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Статус</th>
                <th className="text-left px-4 py-2 font-medium">Приоритет</th>
                <th className="text-right px-4 py-2 font-medium">Кол-во</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(rows as any[]).map((row: any, i: number) => (
                <tr key={i} className="hover:bg-muted/50">
                  <td className="px-4 py-2">{STATUS_LABEL[row.status] ?? row.status}</td>
                  <td className="px-4 py-2">{PRIORITY_LABEL[row.priority] ?? row.priority}</td>
                  <td className="px-4 py-2 text-right font-medium">{row._count._all}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "admin/StatsTab" | head -5
```

Ожидаем: нет ошибок в новом файле.

- [ ] **Step 3: Коммит**

```bash
cd /home/administrator/projects_danik && git add apps/frontend/src/components/admin/StatsTab.tsx && git commit -m "feat(admin): вкладка статистики очереди" && git push
```

---

### Task 2: CategoriesTab

**Files:**
- Create: `apps/frontend/src/components/admin/CategoriesTab.tsx`

Пять категорий × два чекбокса. `trpc.settings.getCategorySettings` возвращает массив `{ category, requiresArrivalConfirmation, requiresPaymentConfirmation }`. При изменении чекбокса — немедленный вызов `trpc.settings.updateCategorySettings`. Для DIRECTOR чекбоксы `disabled`.

- [ ] **Step 1: Создать CategoriesTab.tsx**

```tsx
// apps/frontend/src/components/admin/CategoriesTab.tsx
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';

const CATEGORY_LABEL: Record<string, string> = {
  PAID_ONCE: 'Платный (разовый)',
  PAID_CONTRACT: 'Платный (контракт)',
  OSMS: 'ОСМС',
  CONTINGENT: 'Контингент',
  EMPLOYEE: 'Сотрудник',
};

const CATEGORIES = ['PAID_ONCE', 'PAID_CONTRACT', 'OSMS', 'CONTINGENT', 'EMPLOYEE'] as const;

export function CategoriesTab() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  const { data: settings = [] } = trpc.settings.getCategorySettings.useQuery();
  const utils = trpc.useUtils();

  const updateSetting = trpc.settings.updateCategorySettings.useMutation({
    onSuccess: () => utils.settings.getCategorySettings.invalidate(),
    onError: (e: any) => toast.error(e.message),
  });

  const getVal = (category: string, field: 'requiresArrivalConfirmation' | 'requiresPaymentConfirmation') => {
    const s = (settings as any[]).find((x: any) => x.category === category);
    return s ? s[field] : false;
  };

  const toggle = (
    category: string,
    field: 'requiresArrivalConfirmation' | 'requiresPaymentConfirmation',
    current: boolean,
  ) => {
    const s = (settings as any[]).find((x: any) => x.category === category);
    if (!s) return;
    updateSetting.mutate({
      category: category as any,
      requiresArrivalConfirmation: field === 'requiresArrivalConfirmation' ? !current : s.requiresArrivalConfirmation,
      requiresPaymentConfirmation: field === 'requiresPaymentConfirmation' ? !current : s.requiresPaymentConfirmation,
    });
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Категория</th>
            <th className="text-center px-4 py-2 font-medium">Требует подтверждения прихода</th>
            <th className="text-center px-4 py-2 font-medium">Требует подтверждения оплаты</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {CATEGORIES.map((cat) => (
            <tr key={cat} className="hover:bg-muted/50">
              <td className="px-4 py-3 font-medium">{CATEGORY_LABEL[cat]}</td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  disabled={!isAdmin || updateSetting.isPending}
                  checked={getVal(cat, 'requiresArrivalConfirmation')}
                  onChange={() => toggle(cat, 'requiresArrivalConfirmation', getVal(cat, 'requiresArrivalConfirmation'))}
                  className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                />
              </td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  disabled={!isAdmin || updateSetting.isPending}
                  checked={getVal(cat, 'requiresPaymentConfirmation')}
                  onChange={() => toggle(cat, 'requiresPaymentConfirmation', getVal(cat, 'requiresPaymentConfirmation'))}
                  className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "admin/CategoriesTab" | head -5
```

Ожидаем: нет ошибок в новом файле.

- [ ] **Step 3: Коммит**

```bash
cd /home/administrator/projects_danik && git add apps/frontend/src/components/admin/CategoriesTab.tsx && git commit -m "feat(admin): вкладка настроек категорий пациентов" && git push
```

---

### Task 3: CabinetDialog + CabinetsTab

**Files:**
- Create: `apps/frontend/src/components/admin/CabinetDialog.tsx`
- Create: `apps/frontend/src/components/admin/CabinetsTab.tsx`

CabinetDialog — Dialog с полями: number (Input), name (Input, опционально), departmentId (Select из `trpc.departments.getAll`). Поддерживает режим create (без начальных данных) и edit (предзаполненные поля). CabinetsTab — таблица кабинетов с кнопками «Изменить» и «Деактивировать». Для DIRECTOR кнопок нет.

- [ ] **Step 1: Создать CabinetDialog.tsx**

```tsx
// apps/frontend/src/components/admin/CabinetDialog.tsx
import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface Props {
  open: boolean;
  onClose: () => void;
  cabinet?: { id: string; number: string; name?: string | null; department?: { id: string } | null };
}

export function CabinetDialog({ open, onClose, cabinet }: Props) {
  const isEdit = !!cabinet;

  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  useEffect(() => {
    if (open) {
      setNumber(cabinet?.number ?? '');
      setName(cabinet?.name ?? '');
      setDepartmentId(cabinet?.department?.id ?? '');
    }
  }, [open, cabinet]);

  const { data: departments = [] } = trpc.departments.getAll.useQuery();
  const utils = trpc.useUtils();

  const create = trpc.cabinets.create.useMutation({
    onSuccess: () => { utils.cabinets.getAll.invalidate(); toast.success('Кабинет создан'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = trpc.cabinets.update.useMutation({
    onSuccess: () => { utils.cabinets.getAll.invalidate(); toast.success('Кабинет обновлён'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!number.trim()) { toast.error('Номер кабинета обязателен'); return; }
    const payload = {
      number: number.trim(),
      name: name.trim() || undefined,
      departmentId: departmentId || undefined,
    };
    if (isEdit) {
      update.mutate({ id: cabinet!.id, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать кабинет' : 'Новый кабинет'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Номер *</Label>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="101" />
          </div>

          <div className="space-y-1">
            <Label>Название</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Кабинет терапевта" />
          </div>

          <div className="space-y-1">
            <Label>Отделение</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Без отделения" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Без отделения</SelectItem>
                {(departments as any[]).map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Создать CabinetsTab.tsx**

```tsx
// apps/frontend/src/components/admin/CabinetsTab.tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CabinetDialog } from './CabinetDialog';

export function CabinetsTab() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  const { data: cabinets = [] } = trpc.cabinets.getAll.useQuery();
  const utils = trpc.useUtils();

  const deactivate = trpc.cabinets.deactivate.useMutation({
    onSuccess: () => { utils.cabinets.getAll.invalidate(); toast.success('Кабинет деактивирован'); },
    onError: (e: any) => toast.error(e.message),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: any) => { setEditing(c); setDialogOpen(true); };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={openCreate}>Создать кабинет</Button>
        </div>
      )}

      {(cabinets as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет активных кабинетов</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Номер</th>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium">Отделение</th>
                {isAdmin && <th className="px-4 py-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(cabinets as any[]).map((c: any) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2 font-medium">{c.number}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.name ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.department?.name ?? '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                          Изменить
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={deactivate.isPending}
                          onClick={() => {
                            if (confirm(`Деактивировать кабинет ${c.number}?`)) {
                              deactivate.mutate({ id: c.id });
                            }
                          }}
                        >
                          Деактивировать
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CabinetDialog open={dialogOpen} onClose={() => setDialogOpen(false)} cabinet={editing} />
    </div>
  );
}
```

- [ ] **Step 3: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "admin/Cabinet" | head -5
```

Ожидаем: нет ошибок в новых файлах.

- [ ] **Step 4: Коммит**

```bash
cd /home/administrator/projects_danik && git add apps/frontend/src/components/admin/CabinetDialog.tsx apps/frontend/src/components/admin/CabinetsTab.tsx && git commit -m "feat(admin): вкладка управления кабинетами" && git push
```

---

### Task 4: UserDialog + UsersTab

**Files:**
- Create: `apps/frontend/src/components/admin/UserDialog.tsx`
- Create: `apps/frontend/src/components/admin/UsersTab.tsx`

UserDialog — Dialog с полями: username (только при создании), password (обязателен при создании, опционален при редактировании), firstName, lastName, middleName, role (Select), specialty, departmentId (Select), allowedCategories (чекбоксы для каждой из 5 категорий). UsersTab — таблица пользователей из `trpc.users.getAll`. DIRECTOR не видит этот таб (см. AdminPanel), но даже если увидит — кнопок нет.

- [ ] **Step 1: Создать UserDialog.tsx**

```tsx
// apps/frontend/src/components/admin/UserDialog.tsx
import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const ROLES = [
  { value: 'ADMIN', label: 'Администратор' },
  { value: 'DIRECTOR', label: 'Директор' },
  { value: 'REGISTRAR', label: 'Регистратор' },
  { value: 'CALL_CENTER', label: 'Колл-центр' },
  { value: 'DOCTOR', label: 'Врач' },
  { value: 'DEPARTMENT_HEAD', label: 'Завотделением' },
];

const CATEGORY_OPTIONS = [
  { value: 'PAID_ONCE', label: 'Платный (разовый)' },
  { value: 'PAID_CONTRACT', label: 'Платный (контракт)' },
  { value: 'OSMS', label: 'ОСМС' },
  { value: 'CONTINGENT', label: 'Контингент' },
  { value: 'EMPLOYEE', label: 'Сотрудник' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  user?: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    middleName?: string | null;
    role: string;
    specialty?: string | null;
    departmentId?: string | null;
    allowedCategories: string[];
  };
}

export function UserDialog({ open, onClose, user: editUser }: Props) {
  const isEdit = !!editUser;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [role, setRole] = useState('REGISTRAR');
  const [specialty, setSpecialty] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [allowedCategories, setAllowedCategories] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setUsername(editUser?.username ?? '');
      setPassword('');
      setFirstName(editUser?.firstName ?? '');
      setLastName(editUser?.lastName ?? '');
      setMiddleName(editUser?.middleName ?? '');
      setRole(editUser?.role ?? 'REGISTRAR');
      setSpecialty(editUser?.specialty ?? '');
      setDepartmentId(editUser?.departmentId ?? '');
      setAllowedCategories(editUser?.allowedCategories ?? []);
    }
  }, [open, editUser]);

  const { data: departments = [] } = trpc.departments.getAll.useQuery();
  const utils = trpc.useUtils();

  const create = trpc.users.create.useMutation({
    onSuccess: () => { utils.users.getAll.invalidate(); toast.success('Пользователь создан'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = trpc.users.update.useMutation({
    onSuccess: () => { utils.users.getAll.invalidate(); toast.success('Пользователь обновлён'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending;

  const toggleCategory = (cat: string) => {
    setAllowedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const handleSubmit = () => {
    if (!firstName.trim() || !lastName.trim()) { toast.error('Имя и фамилия обязательны'); return; }
    if (!isEdit && !username.trim()) { toast.error('Логин обязателен'); return; }
    if (!isEdit && !password.trim()) { toast.error('Пароль обязателен'); return; }

    if (isEdit) {
      update.mutate({
        id: editUser!.id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim() || undefined,
        specialty: specialty.trim() || undefined,
        departmentId: departmentId || undefined,
        allowedCategories: allowedCategories as any,
        ...(password.trim() ? { password: password.trim() } : {}),
      });
    } else {
      create.mutate({
        username: username.trim(),
        password: password.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim() || undefined,
        role: role as any,
        specialty: specialty.trim() || undefined,
        departmentId: departmentId || undefined,
        allowedCategories: allowedCategories as any,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать пользователя' : 'Новый пользователь'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isEdit && (
            <div className="space-y-1">
              <Label>Логин *</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ivanov" />
            </div>
          )}

          <div className="space-y-1">
            <Label>{isEdit ? 'Новый пароль (оставьте пустым, чтобы не менять)' : 'Пароль *'}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? 'Не менять' : 'Минимум 6 символов'}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Фамилия *</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Иванов" />
            </div>
            <div className="space-y-1">
              <Label>Имя *</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Иван" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Отчество</Label>
            <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="Иванович" />
          </div>

          {!isEdit && (
            <div className="space-y-1">
              <Label>Роль *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label>Специальность</Label>
            <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Терапевт" />
          </div>

          <div className="space-y-1">
            <Label>Отделение</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Без отделения" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Без отделения</SelectItem>
                {(departments as any[]).map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Разрешённые категории пациентов</Label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowedCategories.includes(opt.value)}
                    onChange={() => toggleCategory(opt.value)}
                    className="h-4 w-4"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Создать UsersTab.tsx**

```tsx
// apps/frontend/src/components/admin/UsersTab.tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { UserDialog } from './UserDialog';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Администратор',
  DIRECTOR: 'Директор',
  REGISTRAR: 'Регистратор',
  CALL_CENTER: 'Колл-центр',
  DOCTOR: 'Врач',
  DEPARTMENT_HEAD: 'Завотделением',
};

export function UsersTab() {
  const { data: users = [], isLoading } = trpc.users.getAll.useQuery();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (u: any) => { setEditing(u); setDialogOpen(true); };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>Создать пользователя</Button>
      </div>

      {(users as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет пользователей</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">ФИО</th>
                <th className="text-left px-4 py-2 font-medium">Логин</th>
                <th className="text-left px-4 py-2 font-medium">Роль</th>
                <th className="text-left px-4 py-2 font-medium">Отделение</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(users as any[]).map((u: any) => (
                <tr key={u.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2">
                    {u.lastName} {u.firstName}
                    {u.middleName ? ` ${u.middleName}` : ''}
                    {!u.isActive && (
                      <span className="ml-1 text-xs text-muted-foreground">(неактивен)</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{u.username}</td>
                  <td className="px-4 py-2">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.department?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => openEdit(u)}>
                      Изменить
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserDialog open={dialogOpen} onClose={() => setDialogOpen(false)} user={editing} />
    </div>
  );
}
```

- [ ] **Step 3: TypeScript-проверка**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "admin/User" | head -5
```

Ожидаем: нет ошибок в новых файлах.

- [ ] **Step 4: Коммит**

```bash
cd /home/administrator/projects_danik && git add apps/frontend/src/components/admin/UserDialog.tsx apps/frontend/src/components/admin/UsersTab.tsx && git commit -m "feat(admin): вкладка управления пользователями" && git push
```

---

### Task 5: AdminPanel — финальная сборка

**Files:**
- Modify: `apps/frontend/src/components/AdminPanel.tsx`

Заменяем заглушку. Четыре вкладки: Пользователи (только ADMIN), Кабинеты, Категории, Статистика. DIRECTOR сразу попадает на вкладку «Кабинеты» (defaultValue). ADMIN — на «Пользователи».

- [ ] **Step 1: Заменить AdminPanel.tsx**

```tsx
// apps/frontend/src/components/AdminPanel.tsx
import { useUser } from '@/contexts/UserContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { UsersTab } from './admin/UsersTab';
import { CabinetsTab } from './admin/CabinetsTab';
import { CategoriesTab } from './admin/CategoriesTab';
import { StatsTab } from './admin/StatsTab';

export function AdminPanel() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-4">
      <Tabs defaultValue={isAdmin ? 'users' : 'cabinets'}>
        <TabsList>
          {isAdmin && <TabsTrigger value="users">Пользователи</TabsTrigger>}
          <TabsTrigger value="cabinets">Кабинеты</TabsTrigger>
          <TabsTrigger value="categories">Категории</TabsTrigger>
          <TabsTrigger value="stats">Статистика</TabsTrigger>
        </TabsList>

        {isAdmin && (
          <TabsContent value="users" className="pt-4">
            <UsersTab />
          </TabsContent>
        )}

        <TabsContent value="cabinets" className="pt-4">
          <CabinetsTab />
        </TabsContent>

        <TabsContent value="categories" className="pt-4">
          <CategoriesTab />
        </TabsContent>

        <TabsContent value="stats" className="pt-4">
          <StatsTab />
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

Ожидаем: нет новых ошибок (pre-existing TS errors от tRPC — норма).

- [ ] **Step 3: Сборка фронтенда**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend build 2>&1 | tail -10
```

Ожидаем: сборка завершена успешно (exit 0).

- [ ] **Step 4: Коммит**

```bash
cd /home/administrator/projects_danik && git add apps/frontend/src/components/AdminPanel.tsx && git commit -m "feat(admin): панель администратора — финальная сборка" && git push
```

---

## Self-Review

**Spec coverage:**
- ✅ Вкладка «Пользователи» → `UsersTab` + `UserDialog`, `trpc.users.getAll` (ADMIN-only), create/update с полями username, password, firstName, lastName, middleName, role, specialty, departmentId, allowedCategories
- ✅ Вкладка «Кабинеты» → `CabinetsTab` + `CabinetDialog`, getAll/create/update/deactivate
- ✅ Вкладка «Категории» → `CategoriesTab`, getCategorySettings/updateCategorySettings, 5 категорий × 2 чекбокса
- ✅ Вкладка «Статистика» → `StatsTab`, `trpc.queue.dailyStats({ date })`
- ✅ ADMIN — полный доступ, DIRECTOR — просмотр (кнопки скрыты через `isAdmin`, чекбоксы disabled)
- ✅ DIRECTOR не видит вкладку «Пользователи» — скрыта в AdminPanel
- ✅ onError toast для всех мутаций
- ✅ defaultValue таба: ADMIN → 'users', DIRECTOR → 'cabinets'

**Placeholder scan:** нет TBD. Весь код полный.

**Type consistency:**
- `UserDialog` принимает `user.allowedCategories: string[]` → передаёт `allowedCategories as any` в мутацию — согласовано с `users.router.ts` (`z.array(z.nativeEnum(PatientCategory))`)
- `CabinetDialog` принимает `cabinet.department?.id` → передаёт `departmentId` строкой — согласовано с `cabinets.router.ts`
- `StatsTab`: `row._count._all` — точное поле из `prisma.queueEntry.groupBy`
- `CategoriesTab`: `toggle()` читает текущие значения из `settings` перед обновлением — не перезаписывает незатронутое поле
