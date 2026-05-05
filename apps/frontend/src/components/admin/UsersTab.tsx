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

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (u: any) => { setEditing(u); setDialogOpen(true); };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            Импорт из Excel
          </Button>
          <Button onClick={openCreate}>Создать пользователя</Button>
        </div>
      )}

      {(users as any[]).length === 0 ? (
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
              {(users as any[]).map((u: any) => (
                <tr key={u.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2">
                    {u.lastName} {u.firstName}
                    {u.middleName ? ` ${u.middleName}` : ''}
                    {!u.isActive && (
                      <span className="ml-1 text-xs text-muted-foreground">(неактивен)</span>
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
