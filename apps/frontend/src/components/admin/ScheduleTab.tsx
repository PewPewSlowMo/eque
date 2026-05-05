import { useState, useRef, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { Button } from '@/components/ui/button';
import { ScheduleImportDialog } from './ScheduleImportDialog';

/* ─── helpers ────────────────────────────────────── */
const DAY_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                     'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

type BreakItem = { startTime: string; endTime: string; label: string };

/* ─── CellEditor ─────────────────────────────────── */
function CellEditor({
  doctorName, date, existing, anchorEl,
  onSave, onDelete, onClose,
}: {
  doctorName: string; date: string;
  existing: { startTime: string; endTime: string; breaks: BreakItem[] } | null;
  anchorEl: HTMLElement;
  onSave: (start: string, end: string, breaks: BreakItem[]) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [startTime, setStartTime] = useState(existing?.startTime ?? '08:00');
  const [endTime,   setEndTime]   = useState(existing?.endTime   ?? '14:00');
  const [breaks,    setBreaks]    = useState<BreakItem[]>(existing?.breaks ?? []);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popRef.current) return;
    const ar = anchorEl.getBoundingClientRect();
    const pr = popRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top  = ar.bottom + 4;
    let left = ar.left;
    if (top  + pr.height > vh - 8) top  = ar.top - pr.height - 4;
    if (left + pr.width  > vw - 8) left = vw - pr.width - 8;
    if (left < 8) left = 8;
    setPos({ top, left });
  }, [anchorEl]);

  const addBreak = () => setBreaks(prev => [...prev, { startTime: '12:00', endTime: '13:00', label: '' }]);
  const removeBreak = (i: number) => setBreaks(prev => prev.filter((_, idx) => idx !== i));
  const updateBreak = (i: number, field: keyof BreakItem, val: string) =>
    setBreaks(prev => prev.map((b, idx) => idx === i ? { ...b, [field]: val } : b));

  const [d, m] = date.split('-').slice(1).reverse().concat(date.split('-'));
  const dayNum = parseInt(date.split('-')[2]);
  const monIdx = parseInt(date.split('-')[1]) - 1;
  const label  = `${dayNum} ${MONTH_NAMES[monIdx].toLowerCase().slice(0,3)}`;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={popRef}
        className="fixed z-50 bg-white shadow-2xl w-[256px]"
        style={{ top: pos.top, left: pos.left, borderRadius: '6px 20px 20px 6px', border: '1.5px solid #a8d4cd' }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="text-[10px] font-bold text-foreground truncate">
            {doctorName} · {label}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-1">
            <X size={12} />
          </button>
        </div>

        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground w-[16px]">С</span>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="flex-1 text-[10px] px-2 py-1 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="text-[9px] text-muted-foreground">до</span>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
              className="flex-1 text-[10px] px-2 py-1 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          {breaks.length > 0 && (
            <div className="space-y-1">
              <span className="text-[9px] text-muted-foreground">Перерывы</span>
              {breaks.map((b, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input type="time" value={b.startTime} onChange={e => updateBreak(i, 'startTime', e.target.value)}
                    className="w-[68px] text-[9px] px-1.5 py-0.5 border border-border rounded focus:outline-none" />
                  <span className="text-[9px] text-muted-foreground">–</span>
                  <input type="time" value={b.endTime} onChange={e => updateBreak(i, 'endTime', e.target.value)}
                    className="w-[68px] text-[9px] px-1.5 py-0.5 border border-border rounded focus:outline-none" />
                  <input value={b.label} onChange={e => updateBreak(i, 'label', e.target.value)}
                    placeholder="Обед"
                    className="flex-1 text-[9px] px-1.5 py-0.5 border border-border rounded focus:outline-none" />
                  <button onClick={() => removeBreak(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button onClick={addBreak}
            className="flex items-center gap-1 text-[9px] text-primary hover:text-primary/70 transition-colors">
            <Plus size={10} /> Перерыв
          </button>
        </div>

        <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-slate-50/60">
          {existing ? (
            <button onClick={onDelete}
              className="text-[9px] text-destructive/70 hover:text-destructive transition-colors">
              Удалить
            </button>
          ) : <span />}
          <div className="flex gap-1.5">
            <button onClick={onClose}
              className="text-[9px] px-2.5 py-1 border border-border rounded text-muted-foreground hover:bg-slate-100 transition-colors">
              Отмена
            </button>
            <button onClick={() => onSave(startTime, endTime, breaks)}
              className="text-[9px] font-semibold text-white px-3 py-1"
              style={{ background: '#00685B', borderRadius: '3px 12px 12px 3px' }}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── ScheduleTab ────────────────────────────────── */
export function ScheduleTab() {
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [deptId, setDeptId] = useState('');
  const { user } = useUser();
  const isDeptHead = user?.role === 'DEPARTMENT_HEAD';
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<{
    doctorId: string; doctorName: string; date: string;
    existing: { startTime: string; endTime: string; breaks: BreakItem[] } | null;
    anchorEl: HTMLElement;
  } | null>(null);

  useEffect(() => {
    if (isDeptHead && user?.departmentId && !deptId) {
      setDeptId(user.departmentId);
    }
  }, [isDeptHead, user?.departmentId]);

  const { data: departments = [] } = trpc.departments.getAll.useQuery();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.schedules.getForDepartmentMonth.useQuery(
    { departmentId: deptId, year, month },
    { enabled: !!deptId },
  );

  const saveDay = trpc.schedules.saveDay.useMutation({
    onSuccess: () => {
      utils.schedules.getForDepartmentMonth.invalidate();
      utils.schedules.getForDateRange.invalidate();
      toast.success('Сохранено');
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteDay = trpc.schedules.deleteDay.useMutation({
    onSuccess: () => {
      utils.schedules.getForDepartmentMonth.invalidate();
      utils.schedules.getForDateRange.invalidate();
      toast.info('Запись удалена');
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const days    = daysInMonth(year, month);
  const dayNums = Array.from({ length: days }, (_, i) => i + 1);
  const doctors: any[]   = data?.doctors   ?? [];
  const schedules: any[] = data?.schedules ?? [];

  const scheduleMap = new Map<string, any>();
  for (const s of schedules) {
    const d = new Date(s.date);
    const key = `${s.doctorId}|${toIsoDate(d.getFullYear(), d.getMonth()+1, d.getDate())}`;
    scheduleMap.set(key, s);
  }

  const todayStr = toIsoDate(today.getFullYear(), today.getMonth()+1, today.getDate());

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={deptId}
          onChange={e => setDeptId(e.target.value)}
          className="text-[11px] px-3 py-1.5 border border-border rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">— Выберите отделение —</option>
          {(departments as any[]).map((d: any) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="p-1 hover:bg-slate-100 rounded transition-colors">
            <ChevronLeft size={14} />
          </button>
          <span className="text-[12px] font-semibold w-[148px] text-center">
            {MONTH_NAMES[month-1]} {year}
          </span>
          <button onClick={nextMonth} className="p-1 hover:bg-slate-100 rounded transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button
            size="sm"
            variant="outline"
            disabled={!deptId}
            onClick={() => setImportOpen(true)}
          >
            Импорт / Экспорт
          </Button>
        </div>
      </div>

      {!deptId && (
        <div className="py-12 text-center text-[11px] text-muted-foreground">
          Выберите отделение для просмотра графика
        </div>
      )}
      {deptId && isLoading && (
        <div className="py-12 text-center text-[11px] text-muted-foreground">Загрузка...</div>
      )}
      {deptId && !isLoading && doctors.length === 0 && (
        <div className="py-12 text-center text-[11px] text-muted-foreground">
          В этом отделении нет врачей
        </div>
      )}

      {/* Grid */}
      {deptId && !isLoading && doctors.length > 0 && (
        <div className="overflow-auto rounded border border-border">
          <table className="border-collapse" style={{ minWidth: `${180 + days * 46}px` }}>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 text-left text-[9px] font-semibold text-muted-foreground bg-slate-50 border-b border-r border-border px-3 py-2"
                  style={{ minWidth: '180px', width: '180px' }}>
                  ВРАЧ
                </th>
                {dayNums.map(day => {
                  const dow = new Date(year, month-1, day).getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  const isToday   = toIsoDate(year, month, day) === todayStr;
                  return (
                    <th key={day}
                      className={`text-center border-b border-r border-border px-0 py-1 ${isWeekend ? 'bg-red-50/60' : 'bg-slate-50'}`}
                      style={{ width: '46px', minWidth: '46px' }}>
                      <div className={`text-[8px] ${isToday ? 'text-primary font-bold' : isWeekend ? 'text-red-400' : 'text-muted-foreground'}`}>
                        {DAY_SHORT[dow]}
                      </div>
                      <div className={`text-[12px] font-bold leading-tight ${isToday ? 'text-primary' : isWeekend ? 'text-red-400' : 'text-foreground'}`}>
                        {day}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {doctors.map((doc: any) => (
                <tr key={doc.id} className="hover:bg-primary/5 transition-colors">
                  <td className="sticky left-0 z-[5] bg-white border-b border-r border-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                        style={{ background: '#00685B' }}>
                        {doc.lastName[0]}{doc.firstName[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold text-foreground truncate">
                          {doc.lastName} {doc.firstName[0]}.
                        </div>
                        {doc.specialty && (
                          <div className="text-[8px] text-muted-foreground truncate">{doc.specialty}</div>
                        )}
                      </div>
                    </div>
                  </td>

                  {dayNums.map(day => {
                    const dateStr  = toIsoDate(year, month, day);
                    const sched    = scheduleMap.get(`${doc.id}|${dateStr}`);
                    const dow      = new Date(year, month-1, day).getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    const isPast   = dateStr < todayStr;

                    return (
                      <td key={day} className={`border-b border-r border-border p-0.5 ${isWeekend ? 'bg-red-50/20' : ''}`}>
                        <button
                          onClick={e => {
                            setEditing({
                              doctorId: doc.id,
                              doctorName: `${doc.lastName} ${doc.firstName[0]}.`,
                              date: dateStr,
                              existing: sched ? {
                                startTime: sched.startTime,
                                endTime:   sched.endTime,
                                breaks:    sched.breaks.map((b: any) => ({
                                  startTime: b.startTime, endTime: b.endTime, label: b.label ?? '',
                                })),
                              } : null,
                              anchorEl: e.currentTarget,
                            });
                          }}
                          className={`w-full h-[34px] rounded text-center transition-all leading-tight ${
                            isPast ? 'opacity-40 cursor-default' : 'hover:brightness-95 cursor-pointer'
                          }`}
                          style={sched ? {
                            background: '#ecfdf5', border: '1px solid #86efac',
                          } : {
                            background: isWeekend ? 'transparent' : '#f8fafc',
                            border: `1px dashed ${isWeekend ? '#fca5a5' : '#e2e8f0'}`,
                          }}>
                          {sched ? (
                            <>
                              <div className="text-[8px] font-bold text-green-700 leading-none">{sched.startTime}</div>
                              <div className="text-[7px] text-green-600 leading-none">{sched.endTime}</div>
                              {sched.breaks.length > 0 && (
                                <div className="text-[6px] text-green-500">{sched.breaks.length}п.</div>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/25">+</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CellEditor
          doctorName={editing.doctorName}
          date={editing.date}
          existing={editing.existing}
          anchorEl={editing.anchorEl}
          onClose={() => setEditing(null)}
          onSave={(start, end, brs) => saveDay.mutate({
            doctorId: editing.doctorId,
            date: editing.date,
            startTime: start,
            endTime: end,
            breaks: brs,
          })}
          onDelete={() => deleteDay.mutate({ doctorId: editing.doctorId, date: editing.date })}
        />
      )}

      <ScheduleImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        defaultDeptId={deptId || undefined}
        defaultYear={year}
        defaultMonth={month}
      />
    </div>
  );
}
