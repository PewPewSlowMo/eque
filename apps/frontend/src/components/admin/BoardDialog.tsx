import { useEffect, useState, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const BACKEND_BASE = (import.meta.env.VITE_TRPC_URL || 'http://localhost:3002/trpc').replace('/trpc', '');

interface Board {
  id: string;
  name: string;
  slug: string;
  columns: number;
  audioMode: string;
  ttsTemplate: string;
  soundUrl?: string | null;
  cabinets: Array<{ cabinetId: string; cabinet: { id: string; number: string; name?: string | null } }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  board?: Board | null;
}

export function BoardDialog({ open, onClose, board }: Props) {
  const isEdit = !!board;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [columns, setColumns] = useState(3);
  const [audioMode, setAudioMode] = useState<'SOUND' | 'SOUND_TTS'>('SOUND');
  const [ttsTemplate, setTtsTemplate] = useState('{lastName} пройдите в кабинет {cabinet}');
  const [selectedCabIds, setSelectedCabIds] = useState<string[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<number | null | 'none'>(null);
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: cabinets = [] } = trpc.cabinets.getAll.useQuery();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (open) {
      setName(board?.name ?? '');
      setSlug(board?.slug ?? '');
      setColumns(board?.columns ?? 3);
      setAudioMode((board?.audioMode as 'SOUND' | 'SOUND_TTS') ?? 'SOUND');
      setTtsTemplate(board?.ttsTemplate ?? '{lastName} пройдите в кабинет {cabinet}');
      setSelectedCabIds(board?.cabinets.map((c) => c.cabinetId) ?? []);
      setSelectedFloor(null);
      setSoundUrl(board?.soundUrl ?? null);
    }
  }, [open, board]);

  const create = trpc.displayBoards.create.useMutation({
    onSuccess: () => { utils.displayBoards.getAll.invalidate(); toast.success('Табло создано'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = trpc.displayBoards.update.useMutation({
    onSuccess: () => { utils.displayBoards.getAll.invalidate(); toast.success('Табло обновлено'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending || uploading;

  const toggleCabinet = (id: string) => {
    setSelectedCabIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const token = localStorage.getItem('auth_token') ?? '';
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BACKEND_BASE}/api/sounds/upload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message ?? 'Ошибка загрузки');
      }
      const json = await res.json();
      setSoundUrl(json.soundUrl);
      toast.success('Файл загружен');
    } catch (e: any) {
      toast.error(e.message ?? 'Ошибка загрузки файла');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) { toast.error('Название обязательно'); return; }
    if (!slug.trim()) { toast.error('Slug обязателен'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) { toast.error('Slug: только строчные латинские буквы, цифры и дефис'); return; }
    if (selectedCabIds.length === 0) { toast.error('Выберите хотя бы один кабинет'); return; }

    const payload = {
      name: name.trim(),
      slug: slug.trim(),
      columns,
      audioMode,
      ttsTemplate,
      soundUrl: soundUrl ?? undefined,
      cabinetIds: selectedCabIds,
    };

    if (isEdit) {
      update.mutate({ id: board!.id, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader className="pb-1">
          <DialogTitle className="text-base">{isEdit ? 'Редактировать табло' : 'Новое табло'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Name + Slug в одну строку */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Название *</Label>
              <Input
                className="h-8 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Табло 1 этажа"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Slug (URL) *</Label>
              <Input
                className="h-8 text-sm"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="floor-1"
              />
              <p className="text-[10px] text-muted-foreground">/board/{slug || 'slug'}</p>
            </div>
          </div>

          {/* Cabinets: floor selector → cabinet list */}
          {(() => {
            const list = cabinets as any[];
            const withFloor = list.filter((c: any) => c.floor != null);
            const noFloor   = list.filter((c: any) => c.floor == null);
            const floors = [...new Set(withFloor.map((c: any) => c.floor as number))].sort((a, b) => a - b);
            const floorOptions: Array<{ key: number | 'none'; label: string; items: any[] }> = [
              ...floors.map((f) => ({ key: f as number | 'none', label: `${f} этаж`, items: withFloor.filter((c: any) => c.floor === f) })),
              ...(noFloor.length > 0 ? [{ key: 'none' as const, label: 'Без этажа', items: noFloor }] : []),
            ];
            const currentItems = selectedFloor !== null
              ? (floorOptions.find((fo) => fo.key === selectedFloor)?.items ?? [])
              : [];
            return (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Кабинеты *</Label>
                  {selectedCabIds.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">выбрано: {selectedCabIds.length}</span>
                  )}
                </div>
                {/* Floor buttons */}
                {floorOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {floorOptions.map((fo) => {
                      const countSelected = fo.items.filter((c: any) => selectedCabIds.includes(c.id)).length;
                      return (
                        <button
                          key={String(fo.key)}
                          type="button"
                          onClick={() => setSelectedFloor(fo.key === selectedFloor ? null : fo.key)}
                          className={`h-6 px-2 text-[11px] rounded border transition-colors ${
                            selectedFloor === fo.key
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-input hover:bg-muted'
                          }`}
                        >
                          {fo.label}{countSelected > 0 ? ` (${countSelected})` : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Cabinet list for selected floor */}
                {selectedFloor !== null && (
                  <div className="border rounded-md max-h-32 overflow-y-auto">
                    {currentItems.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-2 py-1.5">Нет кабинетов</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-0.5 p-1">
                        {currentItems.map((c: any) => (
                          <label key={c.id} className="flex items-center gap-1.5 cursor-pointer px-1 py-0.5 rounded hover:bg-muted/50">
                            <input
                              type="checkbox"
                              checked={selectedCabIds.includes(c.id)}
                              onChange={() => toggleCabinet(c.id)}
                              className="w-3.5 h-3.5 shrink-0"
                            />
                            <span className="text-xs truncate">{c.number}{c.name ? ` ${c.name}` : ''}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {selectedFloor === null && floorOptions.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">Выберите этаж для отображения кабинетов</p>
                )}
                {list.length === 0 && (
                  <p className="text-xs text-muted-foreground">Нет кабинетов</p>
                )}
              </div>
            );
          })()}

          {/* Columns + Audio mode в одну строку */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Колонки очереди</Label>
              <div className="flex gap-1 pt-0.5">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setColumns(n)}
                    className={`flex-1 h-7 text-xs rounded border transition-colors ${
                      columns === n
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input hover:bg-muted'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Режим аудио</Label>
              <div className="flex flex-col gap-1 pt-0.5">
                {(['SOUND', 'SOUND_TTS'] as const).map((mode) => (
                  <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={audioMode === mode}
                      onChange={() => setAudioMode(mode)}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-xs">{mode === 'SOUND' ? 'Только звук' : 'Звук + речь'}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Sound file upload */}
          <div className="space-y-1">
            <Label className="text-xs">Звуковой файл (.mp3 / .wav / .ogg)</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? 'Загрузка...' : soundUrl ? 'Заменить' : 'Выбрать файл'}
              </Button>
              {soundUrl && (
                <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">{soundUrl}</span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".mp3,.wav,.ogg"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = '';
              }}
            />
          </div>

          {/* TTS template (only SOUND_TTS) */}
          {audioMode === 'SOUND_TTS' && (
            <div className="space-y-1">
              <Label className="text-xs">Шаблон речи</Label>
              <textarea
                value={ttsTemplate}
                onChange={(e) => setTtsTemplate(e.target.value)}
                className="w-full border rounded-md p-1.5 text-xs resize-none bg-background"
                rows={2}
                placeholder="{lastName} пройдите в кабинет {cabinet}"
              />
              <p className="text-[10px] text-muted-foreground">
                Переменные: {'{lastName}'} — фамилия, {'{firstName}'} — имя, {'{middleName}'} — отчество, {'{cabinet}'} — кабинет, {'{number}'} — номер очереди
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Отмена</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
