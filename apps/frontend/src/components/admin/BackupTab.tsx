import { useRef, useState } from 'react';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';

const API_BASE = (import.meta.env.VITE_TRPC_URL as string)?.replace('/trpc', '') ?? '';

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type BackupMeta = {
  version: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
};

export function BackupTab() {
  const { user } = useUser();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ meta: BackupMeta; raw: string } | null>(null);

  if (user?.role !== 'ADMIN') return null;

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/api/backup/export`, {
        headers: { ...authHeader() },
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eque-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Бэкап скачан');
    } catch (e: any) {
      toast.error(`Ошибка экспорта: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = ev.target?.result as string;
        const meta = JSON.parse(raw) as BackupMeta;
        if (!meta.version || !meta.data) throw new Error('Неверный формат');
        setPreview({ meta, raw });
      } catch {
        toast.error('Не удалось прочитать файл бэкапа');
        setPreview(null);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await fetch(`${API_BASE}/api/backup/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: preview.raw,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || res.statusText);
      }
      toast.success('Данные восстановлены. Перезагрузите страницу.');
      setPreview(null);
    } catch (e: any) {
      toast.error(`Ошибка импорта: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }

  const counts = preview
    ? Object.entries(preview.meta.data).map(([k, v]) => ({ key: k, count: v.length })).filter(x => x.count > 0)
    : [];

  const LABELS: Record<string, string> = {
    departments: 'Отделения', cabinets: 'Кабинеты', users: 'Пользователи',
    shiftTemplates: 'Шаблоны смен', categorySettings: 'Настройки категорий',
    patients: 'Пациенты', services: 'Услуги', serviceCategories: 'Категории услуг',
    doctorServices: 'Услуги врачей', displayBoards: 'Табло', displayBoardCabinets: 'Кабинеты табло',
    kiosks: 'Киоски', doctorDaySchedules: 'Графики врачей', dayScheduleBreaks: 'Перерывы',
    doctorAssignments: 'Назначения', queueEntries: 'Записи очереди', queueHistory: 'История очереди',
  };

  return (
    <div className="max-w-xl space-y-6">
      {/* Export */}
      <div className="rounded-lg border border-border bg-white p-5 space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Экспорт данных</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Скачать полный бэкап базы данных в JSON файл
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="text-xs font-semibold px-4 py-2 rounded text-white disabled:opacity-50 transition-opacity"
          style={{ background: '#00685B' }}
        >
          {exporting ? 'Скачивание...' : 'Скачать бэкап'}
        </button>
      </div>

      {/* Import */}
      <div className="rounded-lg border border-border bg-white p-5 space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Импорт данных</p>
          <p className="text-xs text-amber-600 mt-0.5">
            ⚠ Внимание: импорт полностью заменит все текущие данные
          </p>
        </div>

        {!preview ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="text-xs font-semibold px-4 py-2 rounded border border-border text-foreground hover:bg-slate-50 transition-colors"
            >
              Выбрать файл бэкапа...
            </button>
          </>
        ) : (
          <div className="space-y-3">
            {/* Meta */}
            <div className="rounded bg-slate-50 border border-border px-3 py-2 space-y-1">
              <p className="text-[10px] text-muted-foreground">
                Версия: <span className="font-medium text-foreground">{preview.meta.version}</span>
                &nbsp;·&nbsp;
                Дата: <span className="font-medium text-foreground">
                  {new Date(preview.meta.exportedAt).toLocaleString('ru-RU')}
                </span>
              </p>
            </div>

            {/* Counts table */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {counts.map(({ key, count }) => (
                <div key={key} className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">{LABELS[key] ?? key}</span>
                  <span className="font-semibold text-foreground">{count}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setPreview(null)}
                disabled={importing}
                className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="text-xs font-semibold px-4 py-1.5 rounded text-white disabled:opacity-50 transition-opacity"
                style={{ background: '#b91c1c' }}
              >
                {importing ? 'Восстановление...' : 'Восстановить данные'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
