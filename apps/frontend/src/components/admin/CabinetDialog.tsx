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
