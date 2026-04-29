import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { useQueueSocket } from './registrar/useQueueSocket';
import { CurrentPatientCard } from './doctor/CurrentPatientCard';
import { DoctorQueueList } from './doctor/DoctorQueueList';

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренный',
  INPATIENT: 'Стационарный',
  SCHEDULED: 'Плановый',
  WALK_IN:   'Обращение',
};

export function DoctorView() {
  const { user } = useUser();
  const doctorId = user?.id ?? '';

  useQueueSocket();

  const { data: entries = [], isLoading } = trpc.queue.getByDoctor.useQuery(
    { doctorId },
    { enabled: !!doctorId, refetchInterval: 30_000 },
  );

  const { data: assignment } = trpc.assignments.getForDoctor.useQuery(
    { doctorId },
    { enabled: !!doctorId },
  );

  if (!doctorId) return null;

  const allEntries = entries as any[];
  const currentPatient = allEntries.find((e: any) => e.status === 'IN_PROGRESS') ?? null;
  const calledEntry   = allEntries.find((e: any) => e.status === 'CALLED') ?? null;
  const waitingEntries = allEntries.filter(
    (e: any) => !['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status),
  );

  const panelWidth = 'var(--q-panel-width, 240px)';

  return (
    <div className="flex overflow-hidden h-full">
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
            entries={waitingEntries}
            doctorId={doctorId}
            calledEntryId={calledEntry?.id}
          />
        )}
      </div>

      {/* ── RIGHT: patient panel ── */}
      <div className="flex-1 flex flex-col bg-slate-100 overflow-y-auto">

        {/* called patient banner */}
        {calledEntry && !currentPatient && (
          <div className="mx-3 mt-3 p-3 bg-white border border-border rounded-lg flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-bold text-foreground">
                {calledEntry.patient.lastName} {calledEntry.patient.firstName}
                {calledEntry.patient.middleName ? ` ${calledEntry.patient.middleName}` : ''} — вызван
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">
                {PRIORITY_LABEL[calledEntry.priority] ?? calledEntry.priority}
                {assignment ? ` · Каб. ${(assignment as any).cabinet.number}` : ''}
              </div>
            </div>
            <button
              className="shrink-0 text-[10px] font-bold text-white px-4 py-2"
              style={{ background: '#00685B', borderRadius: '4px 20px 20px 4px' }}
              onClick={() => {
                /* trigger IN_PROGRESS via complete chain — backend sets via callNext/arrive */
              }}
            >
              Начать приём
            </button>
          </div>
        )}

        {/* current patient card */}
        {currentPatient && (
          <CurrentPatientCard entry={currentPatient} doctorId={doctorId} />
        )}

        {/* no activity state */}
        {!calledEntry && !currentPatient && (
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
        {(calledEntry || currentPatient) && waitingEntries.length > 0 && (() => {
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
  );
}
