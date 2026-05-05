import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ServiceDialog } from './ServiceDialog';

const CATEGORY_LABEL: Record<string, string> = {
  PAID_ONCE:     'Платный (разово)',
  PAID_CONTRACT: 'По договору',
  OSMS:          'ОСМС',
  CONTINGENT:    'Контингент',
  EMPLOYEE:      'Сотрудник',
};

export function ServicesTab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]       = useState<any>(null);

  const { data: services = [], isLoading } = trpc.services.getAll.useQuery(
    { includeInactive: true },
  );
  const utils = trpc.useUtils();

  const deactivate = trpc.services.update.useMutation({
    onSuccess: () => {
      utils.services.getAll.invalidate();
      toast.success('Услуга деактивирована');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteService = trpc.services.delete.useMutation({
    onSuccess: () => {
      utils.services.getAll.invalidate();
      toast.success('Услуга удалена');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit   = (s: any) => { setEditing(s); setDialogOpen(true); };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>Добавить услугу</Button>
      </div>

      {(services as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет услуг</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium">Длительность</th>
                <th className="text-left px-4 py-2 font-medium">Категория оплаты</th>
                <th className="text-left px-4 py-2 font-medium">Статус</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(services as any[]).map((s: any) => (
                <tr
                  key={s.id}
                  className={`hover:bg-muted/50 ${!s.isActive ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-2 font-medium">
                    {s.name}
                    {s.description && (
                      <div className="text-xs text-muted-foreground font-normal">{s.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{s.durationMinutes} мин</td>
                  <td className="px-4 py-2">{CATEGORY_LABEL[s.paymentCategory] ?? s.paymentCategory}</td>
                  <td className="px-4 py-2">
                    {s.isActive
                      ? <span className="text-xs text-emerald-600 font-medium">Активна</span>
                      : <span className="text-xs text-muted-foreground">Неактивна</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                        Изменить
                      </Button>
                      {s.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deactivate.isPending}
                          onClick={() => deactivate.mutate({ id: s.id, isActive: false })}
                        >
                          Деакт.
                        </Button>
                      )}
                      {!s.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deleteService.isPending}
                          onClick={() => {
                            if (confirm(`Удалить услугу "${s.name}"?`)) {
                              deleteService.mutate({ id: s.id });
                            }
                          }}
                        >
                          Удалить
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ServiceDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        service={editing}
      />
    </div>
  );
}
