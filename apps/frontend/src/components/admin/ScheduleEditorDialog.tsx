import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';

const DAY_NAMES: Record<number, string> = {
  1: 'Понедельник', 2: 'Вторник', 3: 'Среда', 4: 'Четверг',
  5: 'Пятница', 6: 'Суббота', 7: 'Воскресенье',
};

type BreakRow = { startTime: string; endTime: string; label: string };
type DayConfig = { isActive: boolean; startTime: string; endTime: string; breaks: BreakRow[] };
type WeekSchedule = Record<number, DayConfig>;

function emptyDay(start = '08:00', end = '14:00'): DayConfig {
  return { isActive: false, startTime: start, endTime: end, breaks: [] };
}

function defaultWeek(): WeekSchedule {
  return Object.fromEntries([1,2,3,4,5,6,7].map(d => [d, emptyDay()]));
}

function scheduleToWeek(rows: any[]): WeekSchedule {
  const week = defaultWeek();
  for (const row of rows) {
    week[row.dayOfWeek] = {
      isActive: true,
      startTime: row.startTime,
      endTime: row.endTime,
      breaks: row.breaks.map((b: any) => ({ startTime: b.startTime, endTime: b.endTime, label: b.label ?? '' })),
    };
  }
  return week;
}

/* ─── Time input ─────────────────────────────────── */
function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-[80px] text-[11px] px-2 py-1 border border-border rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

/* ─── BreakList ──────────────────────────────────── */
function BreakList({ breaks, onChange }: { breaks: BreakRow[]; onChange: (rows: BreakRow[]) => void }) {
  const add = () => onChange([...breaks, { startTime: '12:00', endTime: '13:00', label: '' }]);
  const remove = (i: number) => onChange(breaks.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof BreakRow, val: string) =>
    onChange(breaks.map((b, idx) => idx === i ? { ...b, [field]: val } : b));

  return (
    <div className="flex flex-col gap-1">
      {breaks.map((b, i) => (
        <div key={i} className="flex items-center gap-1">
          <TimeInput value={b.startTime} onChange={v => update(i, 'startTime', v)} />
          <span className="text-[10px] text-muted-foreground">–</span>
          <TimeInput value={b.endTime} onChange={v => update(i, 'endTime', v)} />
          <input
            value={b.label}
            onChange={e => update(i, 'label', e.target.value)}
            placeholder="Обед"
            className="w-[64px] text-[10px] px-2 py-1 border border-border rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive transition-colors">
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/70 transition-colors w-fit"
      >
        <Plus size={11} /> Перерыв
      </button>
    </div>
  );
}

/* ─── Main dialog ────────────────────────────────── */
interface Props {
  doctor: { id: string; firstName: string; lastName: string; specialty?: string | null };
  onClose: () => void;
}

export function ScheduleEditorDialog({ doctor, onClose }: Props) {
  const [week, setWeek] = useState<WeekSchedule>(defaultWeek());

  const query = trpc.schedules.getForDoctor.useQuery({ doctorId: doctor.id });
  const utils = trpc.useUtils();

  useEffect(() => {
    if (query.data) setWeek(scheduleToWeek(query.data));
  }, [query.data]);

  const save = trpc.schedules.saveWeeklySchedule.useMutation({
    onSuccess: () => {
      toast.success('График сохранён');
      utils.schedules.getAll.invalidate();
      utils.schedules.getForDoctor.invalidate();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateDay = (day: number, patch: Partial<DayConfig>) =>
    setWeek(prev => ({ ...prev, [day]: { ...prev[day], ...patch } }));

  const handleSave = () => {
    const days = Object.entries(week)
      .filter(([, cfg]) => cfg.isActive)
      .map(([d, cfg]) => ({
        dayOfWeek: Number(d),
        startTime: cfg.startTime,
        endTime: cfg.endTime,
        breaks: cfg.breaks,
      }));
    save.mutate({ doctorId: doctor.id, days });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.35)' }} onClick={onClose}>
      <div
        className="bg-white shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ borderRadius: '8px 28px 28px 8px', border: '1.5px solid #a8d4cd' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <div className="text-[13px] font-bold text-foreground">
              График приёма: {doctor.lastName} {doctor.firstName}
            </div>
            {doctor.specialty && (
              <div className="text-[10px] text-muted-foreground">{doctor.specialty}</div>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Table */}
        {query.isLoading ? (
          <div className="p-8 text-center text-[11px] text-muted-foreground">Загрузка...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border bg-slate-50">
                  <th className="text-left px-4 py-2 font-semibold text-muted-foreground w-[130px]">День</th>
                  <th className="text-center px-3 py-2 font-semibold text-muted-foreground w-[70px]">Работает</th>
                  <th className="text-center px-3 py-2 font-semibold text-muted-foreground w-[90px]">Начало</th>
                  <th className="text-center px-3 py-2 font-semibold text-muted-foreground w-[90px]">Конец</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Перерывы</th>
                </tr>
              </thead>
              <tbody>
                {[1,2,3,4,5,6,7].map(day => {
                  const cfg = week[day];
                  const isWeekend = day >= 6;
                  return (
                    <tr key={day}
                      className={`border-b border-border/60 transition-colors ${cfg.isActive ? 'bg-white' : isWeekend ? 'bg-red-50/40' : 'bg-slate-50/60'}`}>
                      {/* Day name */}
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${cfg.isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {DAY_NAMES[day]}
                        </span>
                        {isWeekend && !cfg.isActive && (
                          <span className="ml-1 text-[8px] text-red-400">вых.</span>
                        )}
                      </td>

                      {/* Checkbox */}
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={cfg.isActive}
                          onChange={e => updateDay(day, { isActive: e.target.checked })}
                          className="w-3.5 h-3.5 accent-primary cursor-pointer"
                        />
                      </td>

                      {/* Start time */}
                      <td className="px-3 py-2.5 text-center">
                        {cfg.isActive ? (
                          <TimeInput value={cfg.startTime} onChange={v => updateDay(day, { startTime: v })} />
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>

                      {/* End time */}
                      <td className="px-3 py-2.5 text-center">
                        {cfg.isActive ? (
                          <TimeInput value={cfg.endTime} onChange={v => updateDay(day, { endTime: v })} />
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>

                      {/* Breaks */}
                      <td className="px-3 py-2.5">
                        {cfg.isActive ? (
                          <BreakList
                            breaks={cfg.breaks}
                            onChange={breaks => updateDay(day, { breaks })}
                          />
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-slate-50/60">
          <button onClick={onClose}
            className="text-[11px] px-4 py-1.5 border border-border rounded text-muted-foreground hover:bg-slate-100 transition-colors">
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={save.isPending}
            className="text-[11px] font-semibold text-white px-5 py-1.5 disabled:opacity-50 transition-opacity"
            style={{ background: '#00685B', borderRadius: '4px 16px 16px 4px' }}>
            {save.isPending ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
