import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CabinetDialog } from './CabinetDialog';

export function CabinetsTab() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  const { data: cabinets = [] } = trpc.cabinets.getAll.useQuery();
  const utils = trpc.useUtils();

  const deactivate = trpc.cabinets.deactivate.useMutation({
    onSuccess: () => { utils.cabinets.getAll.invalidate(); toast.success('Кабинет деактивирован'); },
    onError: (e: any) => toast.error(e.message),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: any) => { setEditing(c); setDialogOpen(true); };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={openCreate}>Создать кабинет</Button>
        </div>
      )}

      {(cabinets as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет активных кабинетов</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Номер</th>
                <th className="text-left px-4 py-2 font-medium">Этаж</th>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium">Отделение</th>
                {isAdmin && <th className="px-4 py-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(cabinets as any[]).map((c: any) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2 font-medium">{c.number}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.floor != null ? `${c.floor} эт.` : '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.name ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.department?.name ?? '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                          Изменить
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={deactivate.isPending}
                          onClick={() => {
                            if (confirm(`Деактивировать кабинет ${c.number}?`)) {
                              deactivate.mutate({ id: c.id });
                            }
                          }}
                        >
                          Деактивировать
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CabinetDialog open={dialogOpen} onClose={() => setDialogOpen(false)} cabinet={editing} />
    </div>
  );
}
