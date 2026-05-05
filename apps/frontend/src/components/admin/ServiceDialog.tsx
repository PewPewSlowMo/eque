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
  { value: 'OSMS',          label: 'ОМС' },
  { value: 'CONTINGENT',    label: 'Контингент' },
  { value: 'EMPLOYEE',      label: 'Сотрудник' },
];

interface ServiceRecord {
  id: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  paymentCategory: string;
  isActive: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  service?: ServiceRecord | null;
}

export function ServiceDialog({ open, onClose, service }: Props) {
  const isEdit = !!service;

  const [name, setName]         = useState('');
  const [description, setDesc]  = useState('');
  const [duration, setDuration] = useState('30');
  const [category, setCategory] = useState('OSMS');

  useEffect(() => {
    if (open) {
      setName(service?.name ?? '');
      setDesc(service?.description ?? '');
      setDuration(String(service?.durationMinutes ?? 30));
      setCategory(service?.paymentCategory ?? 'OSMS');
    }
  }, [open, service]);

  const utils = trpc.useUtils();

  const create = trpc.services.create.useMutation({
    onSuccess: () => {
      utils.services.getAll.invalidate();
      toast.success('Услуга создана');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = trpc.services.update.useMutation({
    onSuccess: () => {
      utils.services.getAll.invalidate();
      toast.success('Услуга обновлена');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!name.trim()) { toast.error('Название обязательно'); return; }
    const durationMinutes = parseInt(duration, 10);
    if (isNaN(durationMinutes) || durationMinutes < 1) {
      toast.error('Длительность должна быть >= 1 мин'); return;
    }
    if (isEdit) {
      update.mutate({
        id: service!.id,
        name: name.trim(),
        description: description.trim() || undefined,
        durationMinutes,
        paymentCategory: category as any,
      });
    } else {
      create.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
        durationMinutes,
        paymentCategory: category as any,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать услугу' : 'Новая услуга'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Название *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Консультация терапевта"
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

          <div className="grid grid-cols-2 gap-3">
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
              <Label>Категория оплаты *</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-sm px-2 py-1.5 rounded border border-border bg-white outline-none h-9"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
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
