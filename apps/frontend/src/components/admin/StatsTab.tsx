import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const STATUS_LABEL: Record<string, string> = {
  WAITING_ARRIVAL: 'Ожидает прихода',
  ARRIVED: 'Пришёл',
  CALLED: 'Вызван',
  IN_PROGRESS: 'На приёме',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
  NO_SHOW: 'Неявка',
};

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренный',
  INPATIENT: 'Стационарный',
  SCHEDULED: 'Плановый',
  WALK_IN: 'Обращение',
};

function toLocalDateValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function StatsTab() {
  const [dateValue, setDateValue] = useState(() => toLocalDateValue(new Date()));

  const { data: rows = [], isLoading } = trpc.queue.dailyStats.useQuery(
    { date: dateValue },
    { enabled: !!dateValue },
  );

  const total = (rows as any[]).reduce((sum: number, r: any) => sum + r._count._all, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Дата:</label>
        <input
          type="date"
          value={dateValue}
          onChange={(e) => setDateValue(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        />
        <span className="text-sm text-muted-foreground">Всего записей: {total}</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : (rows as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет данных за выбранную дату</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Статус</th>
                <th className="text-left px-4 py-2 font-medium">Приоритет</th>
                <th className="text-right px-4 py-2 font-medium">Кол-во</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(rows as any[]).map((row: any) => (
                <tr key={`${row.status}-${row.priority}`} className="hover:bg-muted/50">
                  <td className="px-4 py-2">{STATUS_LABEL[row.status] ?? row.status}</td>
                  <td className="px-4 py-2">{PRIORITY_LABEL[row.priority] ?? row.priority}</td>
                  <td className="px-4 py-2 text-right font-medium">{row._count._all}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
