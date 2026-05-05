import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

function useElapsedMinutes(startedAt: string | null | undefined): number {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000) : 0,
  );
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
    }, 30_000);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренный',
  INPATIENT: 'Стационарный',
  SCHEDULED: 'Плановый',
  WALK_IN:   'Обращение',
};

const CATEGORY_LABEL: Record<string, string> = {
  PAID_ONCE:    'Платный (разово)',
  PAID_CONTRACT:'По договору',
  OSMS:         'ОСМС',
  CONTINGENT:   'Контингент',
  EMPLOYEE:     'Сотрудник',
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  priority: string;
  category?: string | null;
  startedAt?: string | null;
  service?: { id: string; name: string; durationMinutes: number } | null;
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

  const callRepeat = trpc.queue.callRepeat.useMutation({
    onSuccess: () => toast.success('Пациент вызван повторно'),
    onError: (e: any) => toast.error(e.message),
  });

  const fullName = [entry.patient.lastName, entry.patient.firstName, entry.patient.middleName]
    .filter(Boolean)
    .join(' ');

  const categoryLabel = entry.category ? (CATEGORY_LABEL[entry.category] ?? entry.category) : null;

  const elapsed    = useElapsedMinutes(entry.startedAt);
  const duration   = entry.service?.durationMinutes ?? 0;
  const pct        = duration > 0 ? elapsed / duration : 0;
  const timerColor = pct < 0.8 ? '#86efac' : pct <= 1.0 ? '#fde68a' : '#fca5a5';

  return (
    <div
      className="mx-3 my-2.5 p-3"
      style={{ background: '#00685B', borderRadius: '8px 40px 40px 8px' }}
    >
      <div className="text-[8px] font-bold text-white/50 tracking-wide mb-1">ИДЁТ ПРИЁМ</div>
      <div className="text-[15px] font-bold text-white mb-0.5 leading-tight">{fullName}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[9px] text-white/55">{PRIORITY_LABEL[entry.priority] ?? entry.priority}</span>
        {categoryLabel && (
          <>
            <span className="text-[9px] text-white/30">·</span>
            <span className="text-[9px] text-white/70 font-medium">{categoryLabel}</span>
          </>
        )}
        {entry.service && (
          <>
            <span className="text-[9px] text-white/30">·</span>
            <span className="text-[9px] text-white/70 font-medium">{entry.service.name}</span>
          </>
        )}
      </div>

      {entry.service && entry.startedAt && (
        <div className="flex items-center gap-1.5 mb-2">
          <span
            className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded"
            style={{ background: 'rgba(0,0,0,.25)', color: timerColor }}
          >
            {elapsed} / {duration} мин
          </span>
        </div>
      )}
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
          onClick={() => callRepeat.mutate({ entryId: entry.id })}
          disabled={callRepeat.isPending}
          className="text-[9px] font-bold px-2.5 py-1 disabled:opacity-50"
          style={{
            background: 'rgba(179,145,104,.14)',
            border: '1px solid rgba(179,145,104,.4)',
            color: '#B39168',
            borderRadius: '4px 16px 16px 4px',
          }}
        >
          Повторный вызов
        </button>
      </div>
    </div>
  );
}
