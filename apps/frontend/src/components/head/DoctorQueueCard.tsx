import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users } from 'lucide-react';

const PRIORITY_BADGE: Record<string, { label: string; variant: 'destructive' | 'default' | 'secondary' | 'outline' }> = {
  EMERGENCY: { label: 'Экстренный', variant: 'destructive' },
  INPATIENT:  { label: 'Стационарный', variant: 'default' },
  SCHEDULED:  { label: 'Плановый', variant: 'secondary' },
  WALK_IN:    { label: 'Обращение', variant: 'outline' },
};

interface DoctorQueueCardProps {
  assignment: any;
}

export function DoctorQueueCard({ assignment }: DoctorQueueCardProps) {
  const { data: entries = [] } = trpc.queue.getByDoctor.useQuery(
    { doctorId: assignment.doctorId },
    { refetchInterval: 30_000 },
  );

  const allEntries = entries as any[];
  const active = allEntries.filter(
    (e: any) => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status),
  );
  const inProgress = active.find((e: any) => e.status === 'IN_PROGRESS') ?? null;
  const waitingCount = active.filter((e: any) => e.status !== 'IN_PROGRESS').length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
          <span className="truncate">
            {assignment.doctor.lastName} {assignment.doctor.firstName}
            {assignment.doctor.specialty && (
              <span className="ml-1 font-normal text-muted-foreground">
                · {assignment.doctor.specialty}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground font-normal shrink-0">
            каб. {assignment.cabinet.number}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {inProgress ? (
          <div className="flex items-center gap-2">
            <Badge
              variant={PRIORITY_BADGE[inProgress.priority]?.variant ?? 'outline'}
              className="text-xs shrink-0"
            >
              На приёме
            </Badge>
            <span className="text-sm truncate">
              {inProgress.patient.lastName} {inProgress.patient.firstName}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Нет активного пациента</p>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>{waitingCount} ожидают</span>
        </div>
      </CardContent>
    </Card>
  );
}
