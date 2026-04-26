import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренный',
  INPATIENT: 'Стационарный',
  SCHEDULED: 'Плановый',
  WALK_IN:   'Обращение',
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  priority: string;
  patient: { firstName: string; lastName: string; middleName?: string | null };
}

export function CurrentPatientCard({ entry, doctorId }: { entry: QueueEntry; doctorId: string }) {
  const utils = trpc.useUtils();

  const complete = trpc.queue.complete.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      toast.success('Приём завершён');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const fullName = [entry.patient.lastName, entry.patient.firstName, entry.patient.middleName]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className="mx-3 my-2.5 p-3"
      style={{ background: '#00685B', borderRadius: '8px 40px 40px 8px' }}
    >
      <div className="text-[8px] font-bold text-white/50 tracking-wide mb-1">ИДЁТ ПРИЁМ</div>
      <div className="text-[15px] font-bold text-white mb-0.5 leading-tight">{fullName}</div>
      <div className="text-[9px] text-white/55 mb-2.5">{PRIORITY_LABEL[entry.priority] ?? entry.priority}</div>
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => complete.mutate({ entryId: entry.id })}
          disabled={complete.isPending}
          className="text-[9px] font-bold text-white/85 px-2.5 py-1 disabled:opacity-50"
          style={{
            background: 'rgba(255,255,255,.14)',
            border: '1px solid rgba(255,255,255,.28)',
            borderRadius: '4px 16px 16px 4px',
          }}
        >
          {complete.isPending ? 'Завершение...' : 'Завершить приём'}
        </button>
        <button
          className="text-[9px] font-bold px-2.5 py-1"
          style={{
            background: 'rgba(179,145,104,.14)',
            border: '1px solid rgba(179,145,104,.4)',
            color: '#B39168',
            borderRadius: '4px 16px 16px 4px',
          }}
        >
          Направление
        </button>
        <button
          className="text-[9px] font-bold px-2.5 py-1"
          style={{
            background: 'rgba(179,145,104,.14)',
            border: '1px solid rgba(179,145,104,.4)',
            color: '#B39168',
            borderRadius: '4px 16px 16px 4px',
          }}
        >
          Повторный
        </button>
      </div>
    </div>
  );
}
