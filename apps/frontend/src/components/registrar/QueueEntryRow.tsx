import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CheckCircle, CreditCard, X } from 'lucide-react';

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
  IN_PROGRESS:     'На приёме',
  COMPLETED:       'Завершён',
  NO_SHOW:         'Не явился',
  CANCELLED:       'Отменён',
};

const CATEGORY_SHORT: Record<string, string> = {
  PAID_ONCE:     'Платный',
  PAID_CONTRACT: 'Договор',
  OSMS:          'ОСМС',
  CONTINGENT:    'Контингент',
  EMPLOYEE:      'Сотрудник',
};

interface QueueEntry {
  id: string;
  queueNumber: number;
  status: string;
  priority: string;
  category: string;
  paymentConfirmed: boolean;
  requiresArrivalConfirmation: boolean;
  arrivedAt?: string | null;
  patient: { id: string; firstName: string; lastName: string; middleName?: string | null };
}

interface QueueEntryRowProps {
  entry: QueueEntry;
}

export function QueueEntryRow({ entry }: QueueEntryRowProps) {
  const utils = trpc.useUtils();

  const confirmArrival = trpc.queue.confirmArrival.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate();
      toast.success('Приход подтверждён');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const confirmPayment = trpc.queue.confirmPayment.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate();
      toast.success('Оплата подтверждена');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancel = trpc.queue.cancel.useMutation({
    onSuccess: () => {
      utils.queue.getByDoctor.invalidate();
      toast.info('Запись отменена');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const prio = PRIORITY_BADGE[entry.priority] ?? { label: entry.priority, variant: 'outline' as const };
  const isTerminal = ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status);

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-accent/30 transition-colors">
      <span className="text-lg font-bold text-muted-foreground w-8 text-center">
        {entry.queueNumber}
      </span>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {entry.patient.lastName} {entry.patient.firstName}{' '}
          {entry.patient.middleName ?? ''}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <Badge variant={prio.variant} className="text-xs">{prio.label}</Badge>
          <span className="text-xs text-muted-foreground">{CATEGORY_SHORT[entry.category] ?? entry.category}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{STATUS_LABELS[entry.status] ?? entry.status}</span>
          {!entry.paymentConfirmed && !isTerminal && (
            <Badge variant="outline" className="text-xs text-orange-600 border-orange-400">Ожидает оплаты</Badge>
          )}
        </div>
      </div>

      {!isTerminal && (
        <div className="flex items-center gap-1 shrink-0">
          {entry.status === 'WAITING_ARRIVAL' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={confirmArrival.isPending}
              onClick={() => confirmArrival.mutate({ entryId: entry.id })}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              Пришёл
            </Button>
          )}
          {!entry.paymentConfirmed && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={confirmPayment.isPending}
              onClick={() => confirmPayment.mutate({ entryId: entry.id })}
            >
              <CreditCard className="h-3.5 w-3.5 mr-1" />
              Оплата
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
      )}
    </div>
  );
}
