import { useEffect, useState, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

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
  const [columns, setColumns] = useState('3');
  const [audioMode, setAudioMode] = useState<'SOUND' | 'SOUND_TTS'>('SOUND');
  const [ttsTemplate, setTtsTemplate] = useState('{lastName} пройдите в кабинет {cabinet}');
  const [selectedCabIds, setSelectedCabIds] = useState<string[]>([]);
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: cabinets = [] } = trpc.cabinets.getAll.useQuery();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (open) {
      setName(board?.name ?? '');
      setSlug(board?.slug ?? '');
      setColumns(String(board?.columns ?? 3));
      setAudioMode((board?.audioMode as 'SOUND' | 'SOUND_TTS') ?? 'SOUND');
      setTtsTemplate(board?.ttsTemplate ?? '{lastName} пройдите в кабинет {cabinet}');
      setSelectedCabIds(board?.cabinets.map((c) => c.cabinetId) ?? []);
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
      columns: Number(columns),
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать табло' : 'Новое табло'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1">
            <Label>Название *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Табло 1 этажа" />
          </div>

          {/* Slug */}
          <div className="space-y-1">
            <Label>Slug (URL) *</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="floor-1" />
            <p className="text-xs text-muted-foreground">Публичный адрес: /board/{slug || 'slug'}</p>
          </div>

          {/* Cabinets multi-select */}
          <div className="space-y-1">
            <Label>Кабинеты *</Label>
            <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
              {(cabinets as any[]).length === 0 && (
                <p className="text-sm text-muted-foreground">Нет кабинетов</p>
              )}
              {(cabinets as any[]).map((c: any) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={selectedCabIds.includes(c.id)}
                    onChange={() => toggleCabinet(c.id)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{c.number}{c.name ? ` — ${c.name}` : ''}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Columns */}
          <div className="space-y-1">
            <Label>Колонки очереди</Label>
            <Select value={columns} onValueChange={setColumns}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 колонки</SelectItem>
                <SelectItem value="3">3 колонки</SelectItem>
                <SelectItem value="4">4 колонки</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Audio mode */}
          <div className="space-y-1">
            <Label>Режим аудио</Label>
            <div className="flex gap-4 pt-1">
              {(['SOUND', 'SOUND_TTS'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={audioMode === mode}
                    onChange={() => setAudioMode(mode)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">
                    {mode === 'SOUND' ? 'Только звук' : 'Звук + речь'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Sound file upload */}
          <div className="space-y-1">
            <Label>Звуковой файл (.mp3 / .wav / .ogg)</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? 'Загрузка...' : soundUrl ? 'Заменить файл' : 'Выбрать файл'}
              </Button>
              {soundUrl && (
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">{soundUrl}</span>
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
              <Label>Шаблон речи</Label>
              <textarea
                value={ttsTemplate}
                onChange={(e) => setTtsTemplate(e.target.value)}
                className="w-full border rounded-md p-2 text-sm resize-none bg-background"
                rows={2}
                placeholder="{lastName} пройдите в кабинет {cabinet}"
              />
              <p className="text-xs text-muted-foreground">Переменные: {'{lastName}'}, {'{cabinet}'}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
