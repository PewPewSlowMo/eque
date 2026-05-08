import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CATEGORY_OPTIONS = [
  { value: 'PAID_ONCE',     label: 'Платный (разово)' },
  { value: 'PAID_CONTRACT', label: 'По договору' },
  { value: 'OSMS',          label: 'ОСМС' },
  { value: 'CONTINGENT',    label: 'Контингент' },
  { value: 'EMPLOYEE',      label: 'Сотрудник' },
];

interface ServiceRecord {
  id: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  isActive: boolean;
  categories: { category: string }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  service?: ServiceRecord | null;
}

export function ServiceDialog({ open, onClose, service }: Props) {
  const isEdit = !!service;

  const [name, setName]             = useState('');
  const [description, setDesc]      = useState('');
  const [duration, setDuration]     = useState('30');
  const [categories, setCategories] = useState<Set<string>>(new Set(['OSMS']));
  const [doctorIds, setDoctorIds]   = useState<Set<string>>(new Set());

  const { data: allDoctors = [] } = trpc.users.getDoctors.useQuery(undefined, { enabled: open });
  const { data: assignedIds = [] } = trpc.services.getDoctorIds.useQuery(
    { serviceId: service?.id ?? '' },
    { enabled: isEdit && open && !!service?.id },
  );

  useEffect(() => {
    if (!open) return;
    setName(service?.name ?? '');
    setDesc(service?.description ?? '');
    setDuration(String(service?.durationMinutes ?? 30));
    setCategories(new Set((service?.categories ?? []).map((c) => c.category)));
    setDoctorIds(new Set(assignedIds as string[]));
  }, [open, service, assignedIds]);

  const utils = trpc.useUtils();

  const setDoctorsMut = trpc.services.setDoctors.useMutation({
    onError: (e: any) => toast.error(e.message),
  });

  const create = trpc.services.create.useMutation({
    onSuccess: async (created: any) => {
      await setDoctorsMut.mutateAsync({ serviceId: created.id, doctorIds: [...doctorIds] });
      utils.services.getAll.invalidate();
      toast.success('Услуга создана');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = trpc.services.update.useMutation({
    onSuccess: async () => {
      await setDoctorsMut.mutateAsync({ serviceId: service!.id, doctorIds: [...doctorIds] });
      utils.services.getAll.invalidate();
      toast.success('Услуга обновлена');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending || setDoctorsMut.isPending;

  const toggleCategory = (val: string) => {
    setCategories((prev) => {
      const next = new Set(prev);
      next.has(val) ? next.delete(val) : next.add(val);
      return next;
    });
  };

  const toggleDoctor = (id: string) => {
    setDoctorIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!name.trim()) { toast.error('Название обязательно'); return; }
    const durationMinutes = parseInt(duration, 10);
    if (isNaN(durationMinutes) || durationMinutes < 1) {
      toast.error('Длительность должна быть >= 1 мин'); return;
    }
    if (categories.size === 0) { toast.error('Выберите хотя бы одну категорию'); return; }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      durationMinutes,
      categories: [...categories] as any[],
    };

    if (isEdit) {
      update.mutate({ id: service!.id, ...payload });
    } else {
      create.mutate({ ...payload, doctorIds: [...doctorIds] });
    }
  };

  // Group doctors by department
  const doctors = allDoctors as any[];
  const deptMap = new Map<string, { name: string; doctors: any[] }>();
  const noDept: any[] = [];
  for (const d of doctors) {
    if (d.department) {
      if (!deptMap.has(d.department.id)) {
        deptMap.set(d.department.id, { name: d.department.name, doctors: [] });
      }
      deptMap.get(d.department.id)!.doctors.push(d);
    } else {
      noDept.push(d);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать услугу' : 'Новая услуга'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label>Название *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Консультация терапевта"
              />
            </div>
            <div className="space-y-1">
              <Label>Длительность (мин) *</Label>
              <Input
                type="number"
                min="1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Описание</Label>
              <Input
                value={description}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Необязательно"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <Label>Категории пациентов *</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm cursor-pointer select-none transition-colors ${
                    categories.has(opt.value)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={categories.has(opt.value)}
                    onChange={() => toggleCategory(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Doctors */}
          <div className="space-y-2">
            <Label>Врачи</Label>
            <div className="border rounded-lg overflow-hidden max-h-56 overflow-y-auto">
              {[...deptMap.entries()].map(([deptId, dept]) => (
                <div key={deptId}>
                  <div className="px-3 py-1.5 bg-muted text-xs font-semibold text-muted-foreground sticky top-0">
                    {dept.name}
                  </div>
                  {dept.doctors.map((d: any) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={doctorIds.has(d.id)}
                        onChange={() => toggleDoctor(d.id)}
                      />
                      {d.lastName} {d.firstName} {d.middleName ?? ''}
                      {d.specialty ? <span className="text-xs text-muted-foreground ml-1">· {d.specialty}</span> : null}
                    </label>
                  ))}
                </div>
              ))}
              {noDept.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 bg-muted text-xs font-semibold text-muted-foreground">
                    Без отделения
                  </div>
                  {noDept.map((d: any) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={doctorIds.has(d.id)}
                        onChange={() => toggleDoctor(d.id)}
                      />
                      {d.lastName} {d.firstName} {d.middleName ?? ''}
                    </label>
                  ))}
                </div>
              )}
              {doctors.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">Нет врачей</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
