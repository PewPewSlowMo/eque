import { trpc } from '@/lib/trpc';
import { QueueEntryRow } from './QueueEntryRow';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';

function DoctorQueue({ assignment }: { assignment: any }) {
  const { data: entries = [], isLoading } = trpc.queue.getByDoctor.useQuery(
    { doctorId: assignment.doctorId },
    { refetchInterval: 30_000 },
  );

  const active = (entries as any[]).filter(
    (e: any) => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status),
  );

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-secondary/40 px-4 py-2.5 flex items-center justify-between">
        <div>
          <span className="font-semibold text-sm">
            {assignment.doctor.lastName} {assignment.doctor.firstName}
          </span>
          {assignment.doctor.specialty && (
            <span className="ml-2 text-xs text-muted-foreground">{assignment.doctor.specialty}</span>
          )}
          <span className="ml-2 text-xs text-muted-foreground">
            · каб. {assignment.cabinet.number}
          </span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {active.length} в очереди
        </Badge>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground p-3">Загрузка...</p>
      ) : active.length === 0 ? (
        <p className="text-xs text-muted-foreground p-3">Очередь пуста</p>
      ) : (
        <div className="divide-y">
          {active.map((entry: any) => (
            <QueueEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WaitingList() {
  const { data: assignments = [], isLoading } = trpc.assignments.getActive.useQuery(
    undefined,
    { refetchInterval: 30_000 },
  );

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Загрузка врачей...</p>;
  }

  if ((assignments as any[]).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <Users className="h-8 w-8" />
        <p className="text-sm">Нет активных врачей</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(assignments as any[]).map((a: any) => (
        <DoctorQueue key={a.id} assignment={a} />
      ))}
    </div>
  );
}
