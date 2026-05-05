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

const NONE_DEPT = '__none__';

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
    isActive?: boolean;
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
  const [departmentId, setDepartmentId] = useState(NONE_DEPT);
  const [allowedCategories,  setAllowedCategories]  = useState<string[]>([]);
  const [acceptedCategories, setAcceptedCategories] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setUsername(editUser?.username ?? '');
      setPassword('');
      setFirstName(editUser?.firstName ?? '');
      setLastName(editUser?.lastName ?? '');
      setMiddleName(editUser?.middleName ?? '');
      setRole(editUser?.role ?? 'REGISTRAR');
      setSpecialty(editUser?.specialty ?? '');
      setDepartmentId(editUser?.departmentId ?? NONE_DEPT);
      setAllowedCategories(editUser?.allowedCategories   ?? []);
      setAcceptedCategories((editUser as any)?.acceptedCategories ?? []);
    }
  }, [open, editUser]);

  const { data: departments = [] } = trpc.departments.getAll.useQuery();
  const utils = trpc.useUtils();

  const { data: allServices = [] } = trpc.services.getAll.useQuery(
    undefined,
    { enabled: open && (role === 'DOCTOR' || editUser?.role === 'DOCTOR') },
  );

  const { data: doctorServices = [], refetch: refetchDoctorServices } =
    trpc.services.getForDoctor.useQuery(
      { doctorId: editUser?.id ?? '' },
      { enabled: open && !!editUser?.id && editUser?.role === 'DOCTOR' },
    );

  const [addServiceId, setAddServiceId] = useState('');

  const assignService = trpc.services.assignToDoctor.useMutation({
    onSuccess: () => {
      refetchDoctorServices();
      setAddServiceId('');
      toast.success('Услуга добавлена врачу');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeService = trpc.services.removeFromDoctor.useMutation({
    onSuccess: () => {
      refetchDoctorServices();
      toast.success('Услуга удалена у врача');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const create = trpc.users.create.useMutation({
    onSuccess: () => { utils.users.getAll.invalidate(); toast.success('Пользователь создан'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = trpc.users.update.useMutation({
    onSuccess: () => { utils.users.getAll.invalidate(); toast.success('Пользователь обновлён'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending;

  const toggleCategory = (cat: string) =>
    setAllowedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);

  const toggleAccepted = (cat: string) =>
    setAcceptedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);

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
        departmentId: (departmentId && departmentId !== NONE_DEPT) ? departmentId : undefined,
        allowedCategories:  allowedCategories as any,
        acceptedCategories: acceptedCategories as any,
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
        departmentId: (departmentId && departmentId !== NONE_DEPT) ? departmentId : undefined,
        allowedCategories:  allowedCategories as any,
        acceptedCategories: acceptedCategories as any,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg flex flex-col" style={{ maxHeight: '85vh' }}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{isEdit ? 'Редактировать пользователя' : 'Новый пользователь'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
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
                <SelectItem value={NONE_DEPT}>Без отделения</SelectItem>
                {(departments as any[]).map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(role === 'DOCTOR' || editUser?.role === 'DOCTOR') && (
            <div className="space-y-2">
              <Label>Принимаемые категории пациентов <span className="text-muted-foreground font-normal">(пусто = все)</span></Label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORY_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox"
                      checked={acceptedCategories.includes(opt.value)}
                      onChange={() => toggleAccepted(opt.value)}
                      className="h-4 w-4 accent-primary" />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {(role !== 'DOCTOR' && editUser?.role !== 'DOCTOR') && (
            <div className="space-y-2">
              <Label>Разрешённые категории <span className="text-muted-foreground font-normal">(для постановки в очередь)</span></Label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORY_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox"
                      checked={allowedCategories.includes(opt.value)}
                      onChange={() => toggleCategory(opt.value)}
                      className="h-4 w-4 accent-primary" />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {editUser?.role === 'DOCTOR' && editUser?.id && (
            <div className="space-y-2">
              <Label>Услуги врача</Label>
              {(doctorServices as any[]).length === 0 && (
                <p className="text-xs text-muted-foreground">Нет привязанных услуг</p>
              )}
              <div className="space-y-1">
                {(doctorServices as any[]).map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between text-sm px-2 py-1 rounded bg-muted/50">
                    <span>{s.name} <span className="text-xs text-muted-foreground">· {s.durationMinutes} мин</span></span>
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={() => removeService.mutate({ doctorId: editUser!.id, serviceId: s.id })}
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <select
                  value={addServiceId}
                  onChange={(e) => setAddServiceId(e.target.value)}
                  className="flex-1 text-sm px-2 py-1.5 rounded border border-border bg-white outline-none"
                >
                  <option value="">— добавить услугу —</option>
                  {(allServices as any[])
                    .filter((s: any) => !(doctorServices as any[]).some((ds: any) => ds.id === s.id))
                    .map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!addServiceId || assignService.isPending}
                  onClick={() => {
                    if (addServiceId) assignService.mutate({ doctorId: editUser!.id, serviceId: addServiceId });
                  }}
                >
                  Добавить
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 flex-wrap gap-2">
          {isEdit && (
            <Button
              variant="outline"
              className={editUser!.isActive !== false ? 'text-destructive hover:text-destructive mr-auto' : 'text-green-600 hover:text-green-600 mr-auto'}
              disabled={isPending}
              onClick={() => update.mutate({ id: editUser!.id, isActive: editUser!.isActive !== false ? false : true })}
            >
              {editUser!.isActive !== false ? 'Деактивировать' : 'Активировать'}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
