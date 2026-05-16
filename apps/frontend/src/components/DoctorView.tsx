import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { useQueueSocket } from './registrar/useQueueSocket';
import { CurrentPatientCard } from './doctor/CurrentPatientCard';
import { DoctorQueueList } from './doctor/DoctorQueueList';
import { toast } from 'sonner';

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренный',
  INPATIENT: 'Стационарный',
  SCHEDULED: 'Плановый',
  WALK_IN:   'Обращение',
};

const DAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLabel(d: Date, todayStr: string): string {
  const str = isoDate(d);
  if (str === todayStr) return 'Сегодня';
  const tomorrow = new Date(d); tomorrow.setDate(d.getDate() - 1);
  if (isoDate(tomorrow) === todayStr) return `Завтра, ${d.getDate()} ${MONTHS_RU[d.getMonth()]}`;
  const yesterday = new Date(d); yesterday.setDate(d.getDate() + 1);
  if (isoDate(yesterday) === todayStr) return `Вчера, ${d.getDate()} ${MONTHS_RU[d.getMonth()]}`;
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} (${DAYS_RU[d.getDay()]})`;
}

export function DoctorView() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [dayOffset, setDayOffset] = useState(0);
  const utils = trpc.useUtils();

  const { data: allDoctors = [] } = trpc.users.getDoctors.useQuery(
    undefined,
    { enabled: isAdmin },
  );

  const doctorId = isAdmin ? selectedDoctorId : (user?.id ?? '');

  useQueueSocket();

  const todayStr = useMemo(() => isoDate(new Date()), []);
  const selectedDate = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + dayOffset); return d;
  }, [dayOffset]);
  const dateStr = isoDate(selectedDate);
  const isToday = dateStr === todayStr;

  const { data: entries = [], isLoading } = trpc.queue.getByDoctor.useQuery(
    { doctorId, date: dateStr },
    { enabled: !!doctorId, refetchInterval: isToday ? 30_000 : 60_000 },
  );

  const { data: assignment } = trpc.assignments.getForDoctor.useQuery(
    { doctorId },
    { enabled: !!doctorId },
  );

  const startAppointment = trpc.queue.startAppointment.useMutation({
    onSuccess: () => utils.queue.getByDoctor.invalidate({ doctorId, date: dateStr }),
    onError: (e: any) => toast.error(e.message),
  });

  if (!isAdmin && !doctorId) return null;

  const allEntries = entries as any[];
  const inProgressPatients = allEntries.filter((e: any) => e.status === 'IN_PROGRESS');
  const calledEntry   = allEntries.find((e: any) => e.status === 'CALLED') ?? null;
  const waitingEntries = allEntries.filter(
    (e: any) => !['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status),
  );
  const queueListEntries = allEntries;

  const panelWidth = 'var(--q-panel-width, 240px)';

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* ── ADMIN: doctor selector bar ── */}
      {isAdmin && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-b border-border">
          <span className="text-[10px] font-semibold text-muted-foreground shrink-0">Врач:</span>
          <select
            value={selectedDoctorId}
            onChange={e => setSelectedDoctorId(e.target.value)}
            className="flex-1 text-[11px] px-2 py-1 rounded border border-border bg-white outline-none"
            style={{ borderRadius: '4px 12px 12px 4px' }}
          >
            <option value="">— выберите врача —</option>
            {(allDoctors as any[]).map((d: any) => (
              <option key={d.id} value={d.id}>
                {d.lastName} {d.firstName} {d.middleName ?? ''}
                {d.specialty ? ` (${d.specialty})` : ''}
                {d.department ? ` · ${d.department.name}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Date navigation bar ── */}
      <div className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-white border-b border-border">
        <button
          onClick={() => setDayOffset(o => o - 1)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-muted-foreground text-sm"
        >‹</button>
        <span className={`text-[11px] font-semibold min-w-[120px] text-center ${isToday ? 'text-primary' : 'text-foreground'}`}>
          {dateLabel(selectedDate, todayStr)}
        </span>
        <button
          onClick={() => setDayOffset(o => o + 1)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-muted-foreground text-sm"
        >›</button>
      </div>

      {/* ── ADMIN: no doctor selected placeholder ── */}
      {isAdmin && !selectedDoctorId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <span className="text-3xl opacity-20">⚕</span>
          <span className="text-sm">Выберите врача для просмотра очереди</span>
        </div>
      ) : (
      <div className="flex flex-1 overflow-hidden">
      {/* ── LEFT: queue list ── */}
      <div
        className="flex flex-col border-r border-border bg-slate-50 shrink-0"
        style={{ width: panelWidth }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-white">
          <span className="text-[10px] font-bold text-foreground">Очередь</span>
          <span
            className="text-[8px] font-bold text-white px-1.5 py-0.5 rounded-full"
            style={{ background: '#00685B' }}
          >
            {waitingEntries.length}
          </span>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Загрузка...
          </div>
        ) : (
          <DoctorQueueList
            entries={queueListEntries}
            doctorId={doctorId}
            date={dateStr}
            isToday={isToday}
            calledEntryId={calledEntry?.id}
          />
        )}
      </div>

      {/* ── RIGHT: patient panel ── */}
      <div className="flex-1 flex flex-col bg-slate-100 overflow-y-auto">

        {/* called patient banner */}
        {calledEntry && inProgressPatients.length === 0 && (
          <div className="mx-3 mt-3 p-3 bg-white border border-border rounded-lg flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-bold text-foreground">
                {calledEntry.patient.lastName} {calledEntry.patient.firstName}
                {calledEntry.patient.middleName ? ` ${calledEntry.patient.middleName}` : ''} — вызван
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">
                {PRIORITY_LABEL[calledEntry.priority] ?? calledEntry.priority}
                {(calledEntry as any).scheduledAt && (calledEntry as any).priority !== 'WALK_IN'
                  ? ` · ${new Date((calledEntry as any).scheduledAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                  : ''}
                {assignment ? ` · Каб. ${(assignment as any).cabinet.number}` : ''}
              </div>
            </div>
            <button
              className="shrink-0 text-[10px] font-bold text-white px-4 py-2 disabled:opacity-40"
              style={{ background: '#00685B', borderRadius: '4px 20px 20px 4px' }}
              disabled={startAppointment.isPending}
              onClick={() => startAppointment.mutate({ entryId: calledEntry.id })}
            >
              Начать приём
            </button>
          </div>
        )}

        {/* current patient cards — one per IN_PROGRESS entry */}
        {inProgressPatients.map((p: any) => (
          <CurrentPatientCard key={p.id} entry={p} doctorId={doctorId} />
        ))}

        {/* no activity state */}
        {!calledEntry && inProgressPatients.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <span className="text-3xl opacity-20">⚕</span>
            <span className="text-sm">
              {waitingEntries.length > 0 ? 'Вызовите следующего пациента' : 'Очередь пуста'}
            </span>
            {assignment && (
              <span className="text-xs opacity-60">
                Кабинет {(assignment as any).cabinet.number}
                {(assignment as any).cabinet.name
                  ? ` — ${(assignment as any).cabinet.name}`
                  : ''}
              </span>
            )}
          </div>
        )}

        {/* next patient preview */}
        {(calledEntry || inProgressPatients.length > 0) && waitingEntries.length > 0 && (() => {
          const next = waitingEntries.find(
            (e: any) => e.status === 'ARRIVED' && e.id !== calledEntry?.id,
          );
          if (!next) return null;
          return (
            <div className="mx-3 mt-2 p-3 border border-border/60 bg-white/60 rounded-lg">
              <div className="text-[8px] font-bold text-muted-foreground uppercase tracking-wide mb-1">
                Следующий
              </div>
              <div className="text-[10px] font-semibold text-foreground">
                {next.patient.lastName} {next.patient.firstName}
              </div>
              <div className="text-[8px] text-muted-foreground mt-0.5">
                {PRIORITY_LABEL[next.priority] ?? next.priority}
              </div>
            </div>
          );
        })()}
      </div>
      </div>
      )}
    </div>
  );
}
