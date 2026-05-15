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

const PRIORITY_PILL: Record<string, { label: string; cls: string }> = {
  EMERGENCY: { label: 'Экстренный',   cls: 'bg-red-100 text-red-700' },
  INPATIENT: { label: 'Стационарный', cls: 'bg-orange-100 text-orange-700' },
  SCHEDULED: { label: 'Плановый',     cls: 'bg-yellow-100 text-yellow-700' },
  WALK_IN:   { label: 'Живая',        cls: 'bg-amber-100 text-amber-700' },
};

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  WAITING_ARRIVAL: { label: 'Не прибыл',  cls: 'bg-slate-100 text-slate-500' },
  ARRIVED:         { label: 'Прибыл',     cls: 'bg-emerald-50 text-emerald-700' },
  CALLED:          { label: 'Вызван',     cls: 'bg-amber-100 text-amber-700' },
  IN_PROGRESS:     { label: 'На приёме',  cls: 'bg-teal-50 text-teal-700' },
  COMPLETED:       { label: 'Завершён',   cls: 'bg-slate-100 text-slate-400' },
  NO_SHOW:         { label: 'Неявка',     cls: 'bg-red-50 text-red-400' },
  CANCELLED:       { label: 'Отменён',    cls: 'bg-slate-100 text-slate-400' },
};

const FINISHED = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW']);

const CATEGORY_PILL: Record<string, { label: string; cls: string }> = {
  PAID_ONCE:     { label: 'Платный',    cls: 'bg-blue-50 text-blue-600' },
  PAID_CONTRACT: { label: 'По договору',cls: 'bg-indigo-50 text-indigo-600' },
  OSMS:          { label: 'ОСМС',       cls: 'bg-teal-50 text-teal-700' },
  CONTINGENT:    { label: 'Контингент', cls: 'bg-purple-50 text-purple-700' },
  EMPLOYEE:      { label: 'Сотрудник',  cls: 'bg-slate-100 text-slate-600' },
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  status: string;
  priority: string;
  category?: string | null;
  paymentConfirmed: boolean;
  scheduledAt?: string | null;
  waitMinutes?: number;
  startedAt?: string | null;
  service?: { id: string; name: string; durationMinutes: number } | null;
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

  const callSpecific = trpc.queue.callSpecific.useMutation({
    onSuccess: (result: any) => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      onCallSuccess?.();
      toast.success(`Вызван: ${result.called.patient.lastName} ${result.called.patient.firstName}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startAppointment = trpc.queue.startAppointment.useMutation({
    onSuccess: () => { utils.queue.getByDoctor.invalidate({ doctorId }); },
    onError: (e: any) => toast.error(e.message),
  });

  const callRepeat = trpc.queue.callRepeat.useMutation({
    onSuccess: () => { utils.queue.getByDoctor.invalidate({ doctorId }); toast.success('Пациент вызван повторно'); },
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
  const anyPending  = callNext.isPending || callSpecific.isPending || startAppointment.isPending || callRepeat.isPending;

  // Walk-in = no scheduled slot, regardless of priority label
  const activeEntries   = entries.filter(e => !FINISHED.has(e.status));
  const finishedEntries = entries.filter(e =>  FINISHED.has(e.status));
  const scheduled = activeEntries.filter(e => e.priority !== 'WALK_IN');
  const walkIn    = activeEntries.filter(e => e.priority === 'WALK_IN');

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Очередь пуста
      </div>
    );
  }

  function EntryTimer({ startedAt, duration }: { startedAt: string | null | undefined; duration: number }) {
    const elapsed = useElapsedMinutes(startedAt);
    const pct     = duration > 0 ? elapsed / duration : 0;
    const color   = pct < 0.8 ? 'text-emerald-600' : pct <= 1.0 ? 'text-yellow-600' : 'text-red-600';
    return (
      <span className={`text-[8px] font-bold tabular-nums ${color}`}>
        {elapsed}/{duration}м
      </span>
    );
  }

  const renderEntry = (entry: QueueEntry, isWalkIn = false) => {
    const isFinished = FINISHED.has(entry.status);
    const prio       = PRIORITY_PILL[entry.priority] ?? PRIORITY_PILL.WALK_IN;
    const stat       = STATUS_PILL[entry.status] ?? { label: entry.status, cls: 'bg-slate-100 text-slate-500' };
    const cat        = entry.category ? (CATEGORY_PILL[entry.category] ?? null) : null;
    const isCalling  = entry.id === calledEntryId || entry.status === 'CALLED';
    const canNoShow  = entry.status === 'CALLED';
    const canCall    = entry.status === 'ARRIVED' && entry.paymentConfirmed;
    const canStart   = entry.status === 'CALLED';

    return (
      <div
        key={entry.id}
        className={`px-2.5 py-2 border-b border-border/60 transition-colors ${
          isFinished
            ? 'opacity-50'
            : isCalling
            ? 'bg-amber-50 border-l-2 border-l-amber-400'
            : isWalkIn
            ? 'bg-orange-50/40 hover:bg-orange-50'
            : 'hover:bg-primary/5'
        }`}
      >
        {/* Row 1: number · dot · name · time */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold text-muted-foreground/50 tabular-nums shrink-0 w-4 text-right">
            {entry.queueNumber}
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              background: entry.status === 'ARRIVED'    ? '#00685B'
                : entry.status === 'CALLED'             ? '#B39168'
                : entry.status === 'IN_PROGRESS'        ? '#0d9488'
                : '#cbd5e1',
            }}
          />
          <span className="text-[10px] font-semibold text-foreground leading-tight">
            {entry.patient.lastName} {entry.patient.firstName}
            {entry.patient.middleName ? ` ${entry.patient.middleName[0]}.` : ''}
          </span>
          {entry.scheduledAt && entry.priority !== 'WALK_IN' && (
            <span className="ml-auto shrink-0 text-[8px] font-bold tabular-nums text-primary/70">
              {new Date(entry.scheduledAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* Row 2: pills + buttons */}
        <div className="flex items-center gap-1 mt-1 pl-5 flex-wrap">
          <span className={`text-[8px] font-semibold px-1.5 py-px rounded-full ${prio.cls}`}>
            {prio.label}
          </span>
          <span className={`text-[8px] font-semibold px-1.5 py-px rounded-full ${stat.cls}`}>
            {stat.label}
          </span>
          {cat && (
            <span className={`text-[8px] font-semibold px-1.5 py-px rounded-full ${cat.cls}`}>
              {cat.label}
            </span>
          )}
          {entry.status === 'IN_PROGRESS' && entry.service && (
            <EntryTimer startedAt={entry.startedAt} duration={entry.service.durationMinutes} />
          )}
          {!entry.paymentConfirmed && (
            <span className="text-[8px] text-orange-600 font-medium">· оплата</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {canCall && (
              <button
                onClick={() => callSpecific.mutate({ entryId: entry.id })}
                disabled={anyPending}
                className="text-[8px] font-bold text-white px-2 py-0.5 disabled:opacity-40 transition-opacity"
                style={{ background: '#00685B', borderRadius: '2px 8px 8px 2px' }}
              >
                Вызвать
              </button>
            )}
            {canStart && (
              <>
                <button
                  onClick={() => callRepeat.mutate({ entryId: entry.id })}
                  disabled={anyPending}
                  className="text-[8px] font-bold px-2 py-0.5 disabled:opacity-40 transition-opacity"
                  style={{ background: 'rgba(179,145,104,.14)', border: '1px solid rgba(179,145,104,.4)', color: '#B39168', borderRadius: '2px 8px 8px 2px' }}
                >
                  Повтор
                </button>
                <button
                  onClick={() => startAppointment.mutate({ entryId: entry.id })}
                  disabled={anyPending}
                  className="text-[8px] font-bold text-white px-2 py-0.5 disabled:opacity-40 transition-opacity"
                  style={{ background: '#0d9488', borderRadius: '2px 8px 8px 2px' }}
                >
                  Начать
                </button>
              </>
            )}
            {canNoShow && (
              <button
                onClick={() => markNoShow.mutate({ entryId: entry.id })}
                disabled={markNoShow.isPending}
                className="text-[8px] text-muted-foreground hover:text-destructive px-1.5 py-0.5 border border-border rounded transition-colors"
              >
                Неявка
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Call by priority button */}
      <div className="px-2 py-2 border-b border-border bg-white sticky top-0 z-10">
        <button
          onClick={() => callNext.mutate({ doctorId })}
          disabled={!canCallNext || anyPending}
          className="w-full h-8 text-[10px] font-bold text-white disabled:opacity-40 transition-opacity"
          style={{ background: '#00685B', borderRadius: '4px 20px 20px 4px' }}
        >
          {callNext.isPending ? 'Вызов...' : 'По приоритету'}
        </button>
      </div>

      {/* Scheduled / prioritized patients */}
      {scheduled.length > 0 && (
        <>
          {scheduled.length > 0 && walkIn.length > 0 && (
            <div className="px-2.5 py-1 bg-slate-50 border-b border-border">
              <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider">
                По записи · {scheduled.length}
              </span>
            </div>
          )}
          {scheduled.map(e => renderEntry(e, false))}
        </>
      )}

      {/* Walk-in group */}
      {walkIn.length > 0 && (
        <>
          <div className="px-2.5 py-1 border-b border-border sticky"
            style={{ background: '#fff7ed', top: '48px', zIndex: 5 }}>
            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: '#92400e' }}>
              Живая очередь · {walkIn.length}
            </span>
          </div>
          {walkIn.map(e => renderEntry(e, true))}
        </>
      )}

      {/* Finished entries for today */}
      {finishedEntries.length > 0 && (
        <>
          <div className="px-2.5 py-1 bg-slate-50 border-b border-t border-border">
            <span className="text-[8px] font-bold text-muted-foreground/60 uppercase tracking-wider">
              Завершено сегодня · {finishedEntries.length}
            </span>
          </div>
          {finishedEntries.map(e => renderEntry(e, false))}
        </>
      )}
    </div>
  );
}
