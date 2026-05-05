import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { Button } from '@/components/ui/button';
import { UserDialog } from './UserDialog';
import { UserImportDialog } from './UserImportDialog';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Администратор',
  DIRECTOR: 'Директор',
  REGISTRAR: 'Регистратор',
  CALL_CENTER: 'Колл-центр',
  DOCTOR: 'Врач',
  DEPARTMENT_HEAD: 'Завотделением',
};

export function UsersTab() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  const { data: users = [], isLoading } = trpc.users.getAll.useQuery();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (u: any) => { setEditing(u); setDialogOpen(true); };

  const visibleUsers = (users as any[]).filter((u: any) => showInactive || u.isActive !== false);

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

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
          Показать деактивированных
        </label>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              Импорт из Excel
            </Button>
            <Button onClick={openCreate}>Создать пользователя</Button>
          </div>
        )}
      </div>

      {visibleUsers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет пользователей</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">ФИО</th>
                <th className="text-left px-4 py-2 font-medium">Логин</th>
                <th className="text-left px-4 py-2 font-medium">Роль</th>
                <th className="text-left px-4 py-2 font-medium">Отделение</th>
                {isAdmin && <th className="px-4 py-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleUsers.map((u: any) => (
                <tr key={u.id} className={u.isActive === false ? 'opacity-50' : 'hover:bg-muted/50'}>
                  <td className="px-4 py-2">
                    {u.lastName} {u.firstName}
                    {u.middleName ? ` ${u.middleName}` : ''}
                    {u.isActive === false && (
                      <span className="ml-1 text-xs text-muted-foreground">(деактивирован)</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{u.username}</td>
                  <td className="px-4 py-2">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.department?.name ?? '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => openEdit(u)}>
                        Изменить
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserDialog open={dialogOpen} onClose={() => setDialogOpen(false)} user={editing} />
      <UserImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
