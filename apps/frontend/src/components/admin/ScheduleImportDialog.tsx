import { useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const BACKEND_BASE = (
  import.meta.env.VITE_TRPC_URL || 'http://localhost:3002/trpc'
).replace('/trpc', '');

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

interface PreviewRow {
  doctorId: string;
  doctorName: string;
  date: string;
  startTime: string;
  endTime: string;
  breaks: { startTime: string; endTime: string }[];
  hasConflict: boolean;
  errors: string[];
}

interface PreviewResult {
  rows: PreviewRow[];
  validCount: number;
  conflictCount: number;
  errorCount: number;
}

type Step = 'idle' | 'preview' | 'done';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultDeptId?: string;
  defaultYear?: number;
  defaultMonth?: number;
}

export function ScheduleImportDialog({
  open, onClose, defaultDeptId = '', defaultYear, defaultMonth,
}: Props) {
  const { user } = useUser();
  const isDeptHead = user?.role === 'DEPARTMENT_HEAD';

  const today = new Date();
  const [deptId,  setDeptId]  = useState(defaultDeptId);
  const [year,    setYear]    = useState(defaultYear  ?? today.getFullYear());
  const [month,   setMonth]   = useState(defaultMonth ?? today.getMonth() + 1);
  const [file,    setFile]    = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [step,    setStep]    = useState<Step>('idle');
  const [loading, setLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: departments = [] } = trpc.departments.getAll.useQuery(
    undefined,
    { enabled: open && !isDeptHead },
  );

  // DEPARTMENT_HEAD is locked to their own department
  const effectiveDeptId = isDeptHead ? (user?.departmentId ?? '') : deptId;

  function reset() {
    setFile(null);
    setPreview(null);
    setStep('idle');
    setLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleExport() {
    if (!effectiveDeptId) { toast.error('Выберите отделение'); return; }
    const token = localStorage.getItem('auth_token');
    const url = `${BACKEND_BASE}/api/schedules/export?departmentId=${effectiveDeptId}&year=${year}&month=${month}`;
    fetch(url, { headers: { authorization: token ? `Bearer ${token}` : '' } })
      .then((res) => {
        if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `schedule-${year}-${String(month).padStart(2, '0')}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
      })
      .catch((err) => toast.error(err.message ?? 'Ошибка скачивания'));
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreview(null);
    setStep('idle');
    await uploadPreview(selected);
  }

  async function uploadPreview(selectedFile: File) {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const formData = new FormData();
      formData.append('file', selectedFile);
      const res = await fetch(`${BACKEND_BASE}/api/schedules/import/preview`, {
        method: 'POST',
        headers: { authorization: token ? `Bearer ${token}` : '' },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Ошибка сервера: ${res.status}`);
      }
      const data: PreviewResult = await res.json();
      setPreview(data);
      setStep('preview');
    } catch (err: any) {
      toast.error(err.message ?? 'Ошибка загрузки файла');
      reset();
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!file || !preview) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BACKEND_BASE}/api/schedules/import/commit`, {
        method: 'POST',
        headers: { authorization: token ? `Bearer ${token}` : '' },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Ошибка сервера: ${res.status}`);
      }
      const result: { upserted: number; errors: string[] } = await res.json();
      if (result.upserted > 0) {
        toast.success(`Записей сохранено: ${result.upserted}`);
        utils.schedules.getForDepartmentMonth.invalidate();
        utils.schedules.getForDateRange.invalidate();
      }
      result.errors.forEach((err) => toast.error(err));
      setStep('done');
    } catch (err: any) {
      toast.error(err.message ?? 'Ошибка импорта');
    } finally {
      setLoading(false);
    }
  }

  const hasValid    = (preview?.validCount    ?? 0) > 0;
  const hasErrors   = (preview?.errorCount    ?? 0) > 0;
  const hasConflicts= (preview?.conflictCount ?? 0) > 0;

  const yearOptions = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Экспорт / Импорт графиков</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Department + period selectors */}
          <div className="flex flex-wrap gap-3 items-end">
            {!isDeptHead && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Отделение</label>
                <select
                  value={deptId}
                  onChange={(e) => setDeptId(e.target.value)}
                  className="text-sm px-2 py-1.5 rounded border border-border bg-white outline-none h-9 min-w-[200px]"
                >
                  <option value="">— выберите —</option>
                  {(departments as any[]).map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}
            {isDeptHead && (
              <div className="text-sm text-muted-foreground py-1.5">
                Отделение: <span className="font-medium text-foreground">{(user as any)?.department?.name ?? user?.departmentId}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Год</label>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10))}
                className="text-sm px-2 py-1.5 rounded border border-border bg-white outline-none h-9"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Месяц</label>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                className="text-sm px-2 py-1.5 rounded border border-border bg-white outline-none h-9"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={idx + 1} value={idx + 1}>{name}</option>
                ))}
              </select>
            </div>

            <Button variant="outline" size="sm" onClick={handleExport} disabled={!effectiveDeptId}>
              Скачать / Экспорт
            </Button>
          </div>

          {/* Import file picker */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              {file ? 'Заменить файл' : 'Загрузить для импорта (.xlsx)'}
            </Button>
            {file && (
              <span className="text-sm text-muted-foreground truncate max-w-xs">{file.name}</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {loading && <p className="text-sm text-muted-foreground">Обработка файла...</p>}

          {/* Preview */}
          {step === 'preview' && preview && (
            <div className="space-y-2">
              {/* Stats */}
              <div className="flex gap-4 text-sm flex-wrap">
                <span className="text-green-600 font-medium">Корректных: {preview.validCount}</span>
                {hasConflicts && (
                  <span className="text-yellow-600 font-medium">
                    Перезапишет существующие: {preview.conflictCount}
                  </span>
                )}
                {hasErrors && (
                  <span className="text-destructive font-medium">С ошибками: {preview.errorCount}</span>
                )}
              </div>

              {/* Table — scrollable, fixed height */}
              <div className="overflow-y-auto border rounded-lg" style={{ maxHeight: '340px' }}>
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Врач</th>
                      <th className="text-left px-3 py-2 font-medium">Дата</th>
                      <th className="text-left px-3 py-2 font-medium">График</th>
                      <th className="text-left px-3 py-2 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.rows.map((row, idx) => {
                      const hasErr = row.errors.length > 0;
                      return (
                        <tr
                          key={idx}
                          className={hasErr ? 'bg-destructive/5' : row.hasConflict ? 'bg-yellow-50' : 'hover:bg-muted/50'}
                        >
                          <td className="px-3 py-1.5">{row.doctorName}</td>
                          <td className="px-3 py-1.5 tabular-nums">{row.date}</td>
                          <td className="px-3 py-1.5 font-mono">
                            {!hasErr && `${row.startTime}–${row.endTime}`}
                            {!hasErr && row.breaks.length > 0 && (
                              <span className="text-muted-foreground ml-1">
                                ({row.breaks.map((b) => `${b.startTime}-${b.endTime}`).join(', ')})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {hasErr ? (
                              <span className="text-destructive">{row.errors.join('; ')}</span>
                            ) : row.hasConflict ? (
                              <span className="text-yellow-600">⚠ перезапишет</span>
                            ) : (
                              <span className="text-green-600">OK</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!hasValid && (
                <p className="text-sm text-destructive">
                  Нет корректных записей для импорта. Исправьте ошибки в файле.
                </p>
              )}
            </div>
          )}

          {step === 'done' && (
            <p className="text-sm text-green-600 font-medium">
              Импорт завершён. Можно закрыть окно или загрузить следующий файл.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Закрыть</Button>
          {step === 'preview' && hasValid && (
            <Button onClick={handleConfirm} disabled={loading}>
              {loading ? 'Импорт...' : `Импортировать ${preview!.validCount} зап.`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
