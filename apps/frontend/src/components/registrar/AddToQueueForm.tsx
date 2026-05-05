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
  const [serviceId, setServiceId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');

  const { data: assignments = [] } = trpc.assignments.getActive.useQuery();

  const { data: availableServices = [] } = trpc.services.getForDoctor.useQuery(
    { doctorId, paymentCategory: category as any },
    { enabled: !!(doctorId && category) },
  );

  const addMutation = trpc.queue.add.useMutation({
    onSuccess: () => {
      toast.success('Пациент добавлен в очередь');
      setPatient(null);
      setDoctorId('');
      setPriority('WALK_IN');
      setCategory('');
      setServiceId('');
      setScheduledAt('');
      setNotes('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Categories available to this user
  const allowedCategories = user?.allowedCategories ?? [];
  const categoryOptions = allowedCategories.length > 0
    ? allowedCategories
    : Object.keys(CATEGORY_LABELS);

  const source = user?.role === 'CALL_CENTER' ? 'CALL_CENTER' : 'REGISTRAR';

  const canSubmit = patient && doctorId && priority && category && serviceId && !addMutation.isPending;

  return (
    <div className="space-y-5 max-w-lg">
      <div className="space-y-1">
        <Label>Пациент *</Label>
        <PatientSearch selected={patient} onSelect={p => setPatient(p)} />
      </div>

      <div className="space-y-1">
        <Label>Врач *</Label>
        <Select value={doctorId} onValueChange={(v) => { setDoctorId(v); setServiceId(''); }}>
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
          <Select value={category} onValueChange={(v) => { setCategory(v); setServiceId(''); }}>
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

      {doctorId && category && (
        <div className="space-y-1">
          <Label>Услуга *</Label>
          <Select
            value={serviceId}
            onValueChange={setServiceId}
            disabled={(availableServices as any[]).length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder={
                (availableServices as any[]).length === 0
                  ? 'Нет услуг для данной категории'
                  : 'Выберите услугу...'
              } />
            </SelectTrigger>
            <SelectContent>
              {(availableServices as any[]).map((s: any) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} · {s.durationMinutes} мин
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
            priority:  priority as any,
            category:  category as any,
            serviceId,
            source:    source as any,
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
