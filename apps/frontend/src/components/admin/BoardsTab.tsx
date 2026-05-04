import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BoardDialog } from './BoardDialog';

const AUDIO_MODE_LABEL: Record<string, string> = {
  SOUND:     'Только звук',
  SOUND_TTS: 'Звук + речь',
};

export function BoardsTab() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  const { data: boards = [], isLoading } = trpc.displayBoards.getAll.useQuery();
  const utils = trpc.useUtils();

  const del = trpc.displayBoards.delete.useMutation({
    onSuccess: () => { utils.displayBoards.getAll.invalidate(); toast.success('Табло удалено'); },
    onError: (e: any) => toast.error(e.message),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (b: any) => { setEditing(b); setDialogOpen(true); };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={openCreate}>Создать табло</Button>
        </div>
      )}

      {(boards as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет табло</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium">Slug</th>
                <th className="text-left px-4 py-2 font-medium">Кабинеты</th>
                <th className="text-left px-4 py-2 font-medium">Колонки</th>
                <th className="text-left px-4 py-2 font-medium">Режим</th>
                {isAdmin && <th className="px-4 py-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(boards as any[]).map((b: any) => (
                <tr key={b.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2 font-medium">{b.name}</td>
                  <td className="px-4 py-2">
                    <a
                      href={`/board/${b.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline font-mono text-xs"
                    >
                      /board/{b.slug}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {(b.cabinets as any[]).map((c: any) => c.cabinet.number).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{b.columns}</td>
                  <td className="px-4 py-2 text-muted-foreground">{AUDIO_MODE_LABEL[b.audioMode] ?? b.audioMode}</td>
                  {isAdmin && (
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => openEdit(b)}>
                          Изменить
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={del.isPending}
                          onClick={() => {
                            if (confirm(`Удалить табло "${b.name}"?`)) {
                              del.mutate({ id: b.id });
                            }
                          }}
                        >
                          Удалить
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

      <BoardDialog open={dialogOpen} onClose={() => setDialogOpen(false)} board={editing} />
    </div>
  );
}
