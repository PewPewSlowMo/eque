import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Plus, Pencil, X } from 'lucide-react';

function DeptRow({ dept, onEdit }: { dept: any; onEdit: () => void }) {
  const utils = trpc.useUtils();
  const deactivate = trpc.departments.deactivate.useMutation({
    onSuccess: () => { utils.departments.getAll.invalidate(); toast.info('Отделение деактивировано'); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <tr className="border-b border-border/60 hover:bg-primary/5 transition-colors">
      <td className="px-4 py-2.5 font-medium text-foreground text-[11px]">{dept.name}</td>
      <td className="px-4 py-2.5 text-[10px] text-muted-foreground">
        {dept._count?.users ?? 0} сотр. · {dept._count?.cabinets ?? 0} каб.
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex items-center justify-end gap-2">
          <button onClick={onEdit}
            className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/70 transition-colors">
            <Pencil size={11} /> Изменить
          </button>
          <button
            onClick={() => { if (confirm(`Деактивировать «${dept.name}»?`)) deactivate.mutate({ id: dept.id }); }}
            disabled={deactivate.isPending}
            className="inline-flex items-center gap-1 text-[10px] text-destructive/60 hover:text-destructive transition-colors disabled:opacity-40">
            <X size={11} /> Убрать
          </button>
        </div>
      </td>
    </tr>
  );
}

function DeptFormRow({ dept, onDone }: { dept?: any; onDone: () => void }) {
  const [name, setName] = useState(dept?.name ?? '');
  const utils = trpc.useUtils();

  const create = trpc.departments.create.useMutation({
    onSuccess: () => { utils.departments.getAll.invalidate(); toast.success('Отделение создано'); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = trpc.departments.update.useMutation({
    onSuccess: () => { utils.departments.getAll.invalidate(); toast.success('Отделение обновлено'); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending;

  const submit = () => {
    if (!name.trim()) { toast.error('Введите название'); return; }
    if (dept) update.mutate({ id: dept.id, name: name.trim() });
    else create.mutate({ name: name.trim() });
  };

  return (
    <tr className="border-b border-primary/20 bg-primary/5">
      <td className="px-4 py-2" colSpan={2}>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onDone(); }}
          placeholder="Название отделения"
          className="w-full text-[11px] px-2 py-1 border border-border rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <button onClick={onDone}
            className="text-[10px] text-muted-foreground px-2 py-1 border border-border rounded hover:bg-slate-100 transition-colors">
            Отмена
          </button>
          <button onClick={submit} disabled={isPending}
            className="text-[10px] font-semibold text-white px-3 py-1 disabled:opacity-50 transition-opacity"
            style={{ background: '#00685B', borderRadius: '3px 12px 12px 3px' }}>
            {isPending ? '...' : (dept ? 'Сохранить' : 'Создать')}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function DepartmentsTab() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]  = useState<any | null>(null);

  const { data: departments = [], isLoading } = trpc.departments.getAll.useQuery();

  if (isLoading) return <div className="p-6 text-[11px] text-muted-foreground">Загрузка...</div>;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => { setCreating(true); setEditing(null); }}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white px-4 py-1.5"
          style={{ background: '#00685B', borderRadius: '4px 16px 16px 4px' }}>
          <Plus size={13} /> Создать отделение
        </button>
      </div>

      <div className="rounded border border-border overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-slate-50 border-b border-border">
              <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Название</th>
              <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Состав</th>
              <th className="w-[160px]" />
            </tr>
          </thead>
          <tbody>
            {creating && <DeptFormRow onDone={() => setCreating(false)} />}
            {(departments as any[]).length === 0 && !creating && (
              <tr><td colSpan={3} className="text-center py-10 text-muted-foreground text-[11px]">Нет отделений</td></tr>
            )}
            {(departments as any[]).map((dept: any) => (
              editing?.id === dept.id
                ? <DeptFormRow key={dept.id} dept={dept} onDone={() => setEditing(null)} />
                : <DeptRow key={dept.id} dept={dept} onEdit={() => { setEditing(dept); setCreating(false); }} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
