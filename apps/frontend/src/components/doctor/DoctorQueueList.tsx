import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

const PRIORITY_PILL: Record<string, { label: string; cls: string }> = {
  EMERGENCY: { label: 'Экстренный',   cls: 'bg-red-100 text-red-700' },
  INPATIENT: { label: 'Стационарный', cls: 'bg-orange-100 text-orange-700' },
  SCHEDULED: { label: 'Плановый',     cls: 'bg-yellow-100 text-yellow-700' },
  WALK_IN:   { label: 'Обращение',    cls: 'bg-slate-100 text-slate-600' },
};

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  WAITING_ARRIVAL: { label: 'Не прибыл', cls: 'bg-slate-100 text-slate-500' },
  ARRIVED:         { label: 'Прибыл',    cls: 'bg-emerald-50 text-emerald-700' },
  CALLED:          { label: 'Вызван',    cls: 'bg-amber-100 text-amber-700' },
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  status: string;
  priority: string;
  paymentConfirmed: boolean;
  waitMinutes?: number;
  patient: { firstName: string; lastName: string; middleName?: string | null };
}

interface Props {
  entries: QueueEntry[];
  doctorId: string;
  calledEntryId?: string | null;
  onCallSuccess?: () => void;
}

export function DoctorQueueList({ entries, doctorId, calledEntryId, onCallSuccess }: Props) {
  const utils = trpc.useUtils();

  const callNext = trpc.queue.callNext.useMutation({
    onSuccess: (result: any) => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      onCallSuccess?.();
      if (result.called) {
        toast.success(`Вызван: ${result.called.patient.lastName} ${result.called.patient.firstName}`);
      } else {
        toast.info(result.message ?? 'Нет пациентов в очереди');
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const markNoShow = trpc.queue.markNoShow.useMutation({
    onSuccess: () => { utils.queue.getByDoctor.invalidate({ doctorId }); toast.info('Отмечена неявка'); },
    onError: (e: any) => toast.error(e.message),
  });

  const cancel = trpc.queue.cancel.useMutation({
    onSuccess: () => { utils.queue.getByDoctor.invalidate({ doctorId }); toast.info('Запись отменена'); },
    onError: (e: any) => toast.error(e.message),
  });

  const canCallNext = entries.some(e => e.status === 'ARRIVED' && e.paymentConfirmed);

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Очередь пуста
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Call next button */}
      <div className="px-2 py-2 border-b border-border bg-white sticky top-0 z-10">
        <button
          onClick={() => callNext.mutate({ doctorId })}
          disabled={!canCallNext || callNext.isPending}
          className="w-full h-8 text-[10px] font-bold text-white disabled:opacity-40 transition-opacity"
          style={{ background: '#00685B', borderRadius: '4px 20px 20px 4px' }}
        >
          {callNext.isPending ? 'Вызов...' : 'Вызвать следующего'}
        </button>
      </div>

      {entries.map((entry) => {
        const prio = PRIORITY_PILL[entry.priority] ?? PRIORITY_PILL.WALK_IN;
        const stat = STATUS_PILL[entry.status] ?? { label: entry.status, cls: 'bg-slate-100 text-slate-500' };
        const isCalling = entry.id === calledEntryId || entry.status === 'CALLED';
        const canNoShow = ['WAITING_ARRIVAL', 'ARRIVED'].includes(entry.status);

        return (
          <div
            key={entry.id}
            className={`flex items-start gap-2 px-2.5 py-2 border-b border-border/60 transition-colors ${
              isCalling ? 'bg-amber-50 border-l-2 border-l-amber-400' : 'hover:bg-primary/5'
            }`}
          >
            {/* position number */}
            <span className="text-[10px] font-bold text-muted-foreground/60 w-5 text-right shrink-0 mt-0.5 tabular-nums">
              {entry.queueNumber}
            </span>

            {/* status dot */}
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
              style={{
                background: entry.status === 'ARRIVED' ? '#00685B'
                  : entry.status === 'CALLED' ? '#B39168'
                  : '#cbd5e1',
              }}
            />

            {/* main info */}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold text-foreground truncate">
                {entry.patient.lastName} {entry.patient.firstName}
                {entry.patient.middleName ? ` ${entry.patient.middleName[0]}.` : ''}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className={`text-[8px] font-semibold px-1.5 py-px rounded-full ${prio.cls}`}>
                  {prio.label}
                </span>
                <span className={`text-[8px] font-semibold px-1.5 py-px rounded-full ${stat.cls}`}>
                  {stat.label}
                </span>
                {!entry.paymentConfirmed && (
                  <span className="text-[8px] text-orange-600 font-medium">· ожидает оплаты</span>
                )}
              </div>
            </div>

            {/* wait + actions */}
            <div className="flex flex-col items-end gap-1 shrink-0">
              {entry.waitMinutes !== undefined && entry.waitMinutes > 0 && (
                <span
                  className={`text-[8px] font-bold tabular-nums ${entry.waitMinutes > 20 ? 'text-red-600' : 'text-muted-foreground'}`}
                >
                  {entry.waitMinutes} мин
                </span>
              )}
              <div className="flex items-center gap-1">
                {canNoShow && (
                  <button
                    onClick={() => markNoShow.mutate({ entryId: entry.id })}
                    disabled={markNoShow.isPending}
                    className="text-[8px] text-muted-foreground hover:text-destructive px-1.5 py-0.5 border border-border rounded transition-colors"
                  >
                    Неявка
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Отменить запись ${entry.patient.lastName}?`)) {
                      cancel.mutate({ entryId: entry.id });
                    }
                  }}
                  disabled={cancel.isPending}
                  className="text-[9px] text-destructive/60 hover:text-destructive px-1 py-0.5 transition-colors"
                  title="Отменить"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
