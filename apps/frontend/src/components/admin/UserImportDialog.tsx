import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';

const BACKEND_BASE = (
  import.meta.env.VITE_TRPC_URL || 'http://localhost:3002/trpc'
).replace('/trpc', '');

interface PreviewRowSafe {
  _rowNum: number;
  _errors: string[];
  lastName: string;
  firstName: string;
  middleName: string;
  username: string;
  role: string;
  specialty: string;
  departmentName: string;
}

interface PreviewResult {
  rows: PreviewRowSafe[];
  validCount: number;
  errorCount: number;
}

type Step = 'idle' | 'preview' | 'done';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UserImportDialog({ open, onClose }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [loading, setLoading] = useState(false);

  const utils = trpc.useUtils();

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

      const res = await fetch(`${BACKEND_BASE}/api/users/import/preview`, {
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

      const res = await fetch(`${BACKEND_BASE}/api/users/import/commit`, {
        method: 'POST',
        headers: { authorization: token ? `Bearer ${token}` : '' },
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Ошибка сервера: ${res.status}`);
      }

      const result: { created: number; errors: string[] } = await res.json();

      if (result.created > 0) {
        toast.success(`Создано пользователей: ${result.created}`);
        utils.users.getAll.invalidate();
      }

      if (result.errors.length > 0) {
        result.errors.forEach((err) => toast.error(err));
      }

      setStep('done');
    } catch (err: any) {
      toast.error(err.message ?? 'Ошибка импорта');
    } finally {
      setLoading(false);
    }
  }

  function handleDownloadTemplate() {
    const token = localStorage.getItem('auth_token');
    const url = `${BACKEND_BASE}/api/users/template`;
    fetch(url, { headers: { authorization: token ? `Bearer ${token}` : '' } })
      .then((res) => {
        if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'users-template.xlsx';
        link.click();
        URL.revokeObjectURL(link.href);
      })
      .catch((err) => toast.error(err.message ?? 'Ошибка скачивания шаблона'));
  }

  const hasErrors = (preview?.errorCount ?? 0) > 0;
  const hasValid = (preview?.validCount ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Импорт пользователей из Excel</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 1: upload */}
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
              Скачать шаблон
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              {file ? 'Заменить файл' : 'Выбрать файл (.xlsx)'}
            </Button>
            {file && (
              <span className="text-sm text-muted-foreground truncate max-w-xs">
                {file.name}
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {loading && (
            <p className="text-sm text-muted-foreground">Обработка файла...</p>
          )}

          {/* Step 2: preview table */}
          {step === 'preview' && preview && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 font-medium">
                  Корректных строк: {preview.validCount}
                </span>
                {hasErrors && (
                  <span className="text-destructive font-medium">
                    С ошибками: {preview.errorCount}
                  </span>
                )}
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">#</th>
                      <th className="text-left px-3 py-2 font-medium">Фамилия</th>
                      <th className="text-left px-3 py-2 font-medium">Имя</th>
                      <th className="text-left px-3 py-2 font-medium">Логин</th>
                      <th className="text-left px-3 py-2 font-medium">Роль</th>
                      <th className="text-left px-3 py-2 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.rows.map((row) => {
                      const isValid = row._errors.length === 0;
                      return (
                        <tr
                          key={row._rowNum}
                          className={isValid ? 'hover:bg-muted/50' : 'bg-destructive/5'}
                        >
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {row._rowNum}
                          </td>
                          <td className="px-3 py-1.5">{row.lastName}</td>
                          <td className="px-3 py-1.5">{row.firstName}</td>
                          <td className="px-3 py-1.5">{row.username}</td>
                          <td className="px-3 py-1.5">{row.role}</td>
                          <td className="px-3 py-1.5">
                            {isValid ? (
                              <span className="text-green-600">OK</span>
                            ) : (
                              <span className="text-destructive">
                                {row._errors.join('; ')}
                              </span>
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
                  Нет строк для импорта. Исправьте ошибки в файле.
                </p>
              )}
            </div>
          )}

          {/* Step 3: done */}
          {step === 'done' && (
            <p className="text-sm text-green-600 font-medium">
              Импорт завершён. Можно закрыть окно или загрузить новый файл.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Закрыть
          </Button>
          {step === 'preview' && hasValid && (
            <Button onClick={handleConfirm} disabled={loading}>
              {loading ? 'Импорт...' : `Импортировать ${preview!.validCount} польз.`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
