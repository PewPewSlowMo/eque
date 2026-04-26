import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { ScheduleEditorDialog } from './ScheduleEditorDialog';
import { CalendarDays, Edit2 } from 'lucide-react';

const DAY_SHORT: Record<number, string> = { 1:'Пн', 2:'Вт', 3:'Ср', 4:'Чт', 5:'Пт', 6:'Сб', 7:'Вс' };

function schedSummary(days: any[]): string {
  if (days.length === 0) return 'Нет графика';
  const sorted = [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  if (days.length === 5 &&
      sorted.every((d, i) => d.dayOfWeek === i + 1) &&
      new Set(sorted.map(d => `${d.startTime}-${d.endTime}`)).size === 1) {
    return `Пн–Пт  ${sorted[0].startTime}–${sorted[0].endTime}`;
  }
  return sorted.map(d =>
    `${DAY_SHORT[d.dayOfWeek]} ${d.startTime}–${d.endTime}${d.breaks.length ? ` (${d.breaks.length} пер.)` : ''}`
  ).join(', ');
}

interface EditTarget {
  id: string; firstName: string; lastName: string; specialty?: string | null;
}

export function SchedulesTab() {
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const doctorsQ = trpc.users.getAll.useQuery();
  const schedulesQ = trpc.schedules.getAll.useQuery();

  const doctors = (doctorsQ.data ?? []).filter((u: any) => u.role === 'DOCTOR');

  const schedulesByDoctor: Record<string, any[]> = {};
  for (const s of schedulesQ.data ?? []) {
    (schedulesByDoctor[s.doctorId] ??= []).push(s);
  }

  if (doctorsQ.isLoading || schedulesQ.isLoading) {
    return <div className="p-6 text-[11px] text-muted-foreground">Загрузка...</div>;
  }

  if (doctors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
        <CalendarDays size={32} className="opacity-25" />
        <span className="text-[11px]">Врачи не найдены</span>
      </div>
    );
  }

  return (
    <>
      <div className="rounded border border-border overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-slate-50 border-b border-border">
              <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Врач</th>
              <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Специальность</th>
              <th className="text-left px-4 py-2 font-semibold text-muted-foreground">График</th>
              <th className="w-[80px]" />
            </tr>
          </thead>
          <tbody>
            {doctors.map((doc: any) => {
              const days = schedulesByDoctor[doc.id] ?? [];
              const hasSched = days.length > 0;
              return (
                <tr key={doc.id} className="border-b border-border/60 hover:bg-primary/5 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    {doc.lastName} {doc.firstName}
                    {doc.middleName ? ` ${doc.middleName[0]}.` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {doc.specialty ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {hasSched ? (
                      <span className="text-foreground">{schedSummary(days)}</span>
                    ) : (
                      <span className="text-amber-600 font-medium">Нет графика</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setEditing(doc)}
                      className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/70 font-medium transition-colors"
                    >
                      <Edit2 size={11} />
                      {hasSched ? 'Изменить' : 'Задать'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <ScheduleEditorDialog doctor={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
