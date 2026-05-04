import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  open: boolean;
  onClose: () => void;
  cabinet?: { id: string; number: string; name?: string | null; floor?: number | null; department?: { id: string } | null };
}

const NONE_DEPT = '__none__';

export function CabinetDialog({ open, onClose, cabinet }: Props) {
  const isEdit = !!cabinet;

  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('');
  const [departmentId, setDepartmentId] = useState(NONE_DEPT);

  useEffect(() => {
    if (open) {
      setNumber(cabinet?.number ?? '');
      setName(cabinet?.name ?? '');
      setFloor(cabinet?.floor != null ? String(cabinet.floor) : '');
      setDepartmentId(cabinet?.department?.id ?? NONE_DEPT);
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
    const floorNum = floor.trim() ? parseInt(floor.trim(), 10) : undefined;
    const payload = {
      number: number.trim(),
      name: name.trim() || undefined,
      floor: floorNum,
      departmentId: (departmentId && departmentId !== NONE_DEPT) ? departmentId : undefined,
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
            <Label>Этаж</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="1"
            />
          </div>

          <div className="space-y-1">
            <Label>Отделение</Label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value={NONE_DEPT}>Без отделения</option>
              {(departments as any[]).map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
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
