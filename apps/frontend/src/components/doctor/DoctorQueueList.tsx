import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { UserCheck, Ban, X } from 'lucide-react';

const PRIORITY_BADGE: Record<string, { label: string; variant: 'destructive' | 'default' | 'secondary' | 'outline' }> = {
  EMERGENCY: { label: 'Экстренный', variant: 'destructive' },
  INPATIENT:  { label: 'Стационарный', variant: 'default' },
  SCHEDULED:  { label: 'Плановый', variant: 'secondary' },
  WALK_IN:    { label: 'Обращение', variant: 'outline' },
};

const STATUS_LABELS: Record<string, string> = {
  WAITING_ARRIVAL: 'Ожидает прихода',
  ARRIVED:         'Прибыл',
  CALLED:          'Вызван',
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  status: string;
  priority: string;
  paymentConfirmed: boolean;
  patient: { firstName: string; lastName: string; middleName?: string | null };
}

interface DoctorQueueListProps {
  entries: QueueEntry[];
  doctorId: string;
}

export function DoctorQueueList({ entries, doctorId }: DoctorQueueListProps) {
  const utils = trpc.useUtils();

  const callNext = trpc.queue.callNext.useMutation({
    onSuccess: (result: any) => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      if (result.called) {
        toast.success(
          `Вызван: ${result.called.patient.lastName} ${result.called.patient.firstName}`,
        );
      } else {
        toast.info(result.message ?? 'Нет пациентов в очереди');
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const markNoShow = trpc.queue.markNoShow.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      toast.info('Отмечена неявка');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancel = trpc.queue.cancel.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate({ doctorId });
      toast.info('Запись отменена');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const canCallNext = entries.some(
    (e) => e.status === 'ARRIVED' && e.paymentConfirmed,
  );

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Очередь пуста
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {entries.length} в очереди
        </span>
        <Button
          onClick={() => callNext.mutate({ doctorId })}
          disabled={!canCallNext || callNext.isPending}
          className="gap-2"
        >
          <UserCheck className="h-4 w-4" />
          {callNext.isPending ? 'Вызов...' : 'Вызвать следующего'}
        </Button>
      </div>

      <div className="border rounded-lg divide-y">
        {entries.map((entry) => {
          const prio = PRIORITY_BADGE[entry.priority] ?? {
            label: entry.priority,
            variant: 'outline' as const,
          };
          const canNoShow = ['WAITING_ARRIVAL', 'ARRIVED'].includes(entry.status);

          return (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-2">
              <span className="text-lg font-bold text-muted-foreground w-8 text-center shrink-0">
                {entry.queueNumber}
              </span>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {entry.patient.lastName} {entry.patient.firstName}{' '}
                  {entry.patient.middleName ?? ''}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant={prio.variant} className="text-xs">
                    {prio.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {STATUS_LABELS[entry.status] ?? entry.status}
                  </span>
                  {!entry.paymentConfirmed && (
                    <span className="text-xs text-orange-600">· ожидает оплаты</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {canNoShow && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={markNoShow.isPending}
                    onClick={() => markNoShow.mutate({ entryId: entry.id })}
                  >
                    <Ban className="h-3.5 w-3.5 mr-1" />
                    Неявка
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  disabled={cancel.isPending}
                  onClick={() => {
                    if (confirm(`Отменить запись пациента ${entry.patient.lastName}?`)) {
                      cancel.mutate({ entryId: entry.id });
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
