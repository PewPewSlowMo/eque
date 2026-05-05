import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CabinetDialog } from './CabinetDialog';

export function CabinetsTab() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  const [showInactive, setShowInactive] = useState(false);
  const { data: cabinets = [] } = trpc.cabinets.getAll.useQuery(
    { includeInactive: showInactive },
  );
  const utils = trpc.useUtils();

  const deactivate = trpc.cabinets.deactivate.useMutation({
    onSuccess: () => { utils.cabinets.getAll.invalidate(); toast.success('Кабинет деактивирован'); },
    onError: (e: any) => toast.error(e.message),
  });

  const activate = trpc.cabinets.activate.useMutation({
    onSuccess: () => { utils.cabinets.getAll.invalidate(); toast.success('Кабинет активирован'); },
    onError: (e: any) => toast.error(e.message),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: any) => { setEditing(c); setDialogOpen(true); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Показать деактивированные
        </label>
        {isAdmin && (
          <Button onClick={openCreate}>Создать кабинет</Button>
        )}
      </div>

      {(cabinets as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет кабинетов</p>
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
              {(cabinets as any[]).map((c: any) => {
                const isInactive = c.isActive === false;
                return (
                  <tr key={c.id} className={isInactive ? 'opacity-50' : 'hover:bg-muted/50'}>
                    <td className="px-4 py-2 font-medium">
                      {c.number}
                      {isInactive && <span className="ml-1 text-xs text-muted-foreground">(деактивирован)</span>}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.floor != null ? `${c.floor} эт.` : '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.name ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.department?.name ?? '—'}</td>
                    {isAdmin && (
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 justify-end">
                          {!isInactive && (
                            <>
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
                            </>
                          )}
                          {isInactive && showInactive && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 hover:text-green-600"
                              disabled={activate.isPending}
                              onClick={() => activate.mutate({ id: c.id })}
                            >
                              Активировать
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CabinetDialog open={dialogOpen} onClose={() => setDialogOpen(false)} cabinet={editing} />
    </div>
  );
}
