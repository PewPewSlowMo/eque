import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';

const PRIORITY_BADGE: Record<string, { label: string; variant: 'destructive' | 'default' | 'secondary' | 'outline' }> = {
  EMERGENCY: { label: 'Экстренный', variant: 'destructive' },
  INPATIENT:  { label: 'Стационарный', variant: 'default' },
  SCHEDULED:  { label: 'Плановый', variant: 'secondary' },
  WALK_IN:    { label: 'Обращение', variant: 'outline' },
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  priority: string;
  patient: { firstName: string; lastName: string; middleName?: string | null };
}

interface CurrentPatientCardProps {
  entry: QueueEntry;
  doctorId: string;
}

export function CurrentPatientCard({ entry, doctorId }: CurrentPatientCardProps) {
  const utils = trpc.useUtils();

  const complete = trpc.queue.complete.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      toast.success('Приём завершён');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const prio = PRIORITY_BADGE[entry.priority] ?? { label: entry.priority, variant: 'outline' as const };

  return (
    <Card className="border-2 border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          На приёме
          <Badge variant={prio.variant}>{prio.label}</Badge>
          <span className="ml-auto text-muted-foreground font-normal text-sm">
            №{entry.queueNumber}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <p className="text-xl font-bold">
          {entry.patient.lastName} {entry.patient.firstName}{' '}
          {entry.patient.middleName ?? ''}
        </p>
        <Button
          onClick={() => complete.mutate({ entryId: entry.id })}
          disabled={complete.isPending}
          className="gap-2"
        >
          <CheckCircle2 className="h-4 w-4" />
          {complete.isPending ? 'Завершение...' : 'Завершить приём'}
        </Button>
      </CardContent>
    </Card>
  );
}
