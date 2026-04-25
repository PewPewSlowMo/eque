import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { useQueueSocket } from './registrar/useQueueSocket';
import { CurrentPatientCard } from './doctor/CurrentPatientCard';
import { DoctorQueueList } from './doctor/DoctorQueueList';
import { Stethoscope } from 'lucide-react';

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

  const allEntries = entries as any[];

  const currentPatient = allEntries.find((e: any) => e.status === 'IN_PROGRESS') ?? null;
  const waitingEntries = allEntries.filter(
    (e: any) => !['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status),
  );

  if (!doctorId) {
    return <p className="text-muted-foreground text-sm">Загрузка...</p>;
  }

  return (
    <div className="space-y-6">
      {assignment && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Stethoscope className="h-4 w-4" />
          <span>
            Кабинет {(assignment as any).cabinet.number}
            {(assignment as any).cabinet.name
              ? ` — ${(assignment as any).cabinet.name}`
              : ''}
          </span>
        </div>
      )}

      {currentPatient && (
        <CurrentPatientCard entry={currentPatient} doctorId={doctorId} />
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка очереди...</p>
      ) : (
        <DoctorQueueList entries={waitingEntries} doctorId={doctorId} />
      )}
    </div>
  );
}
