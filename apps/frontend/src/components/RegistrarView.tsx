import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { PatientSearch } from './registrar/PatientSearch';
import { useQueueSocket } from './registrar/useQueueSocket';
import { toast } from 'sonner';

/* ─── schedule helpers ──────────────────────────── */
function slotsFromSchedule(sched: { startTime: string; endTime: string; breaks: Array<{ startTime: string; endTime: string }> }): string[] {
  const [sh, sm] = sched.startTime.split(':').map(Number);
  const [eh, em] = sched.endTime.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;
  const breakRanges = sched.breaks.map(b => {
    const [bs, bsm] = b.startTime.split(':').map(Number);
    const [be, bem] = b.endTime.split(':').map(Number);
    return [bs * 60 + bsm, be * 60 + bem] as [number, number];
  });
  const slots: string[] = [];
  for (let m = startMins; m < endMins; m += 15) {
    if (!breakRanges.some(([s, e]) => m >= s && m < e)) {
      slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
  }
  return slots;
}

const CATEGORY_OPTS = [
  { value: 'OSMS',          label: 'ОСМС' },
  { value: 'PAID_ONCE',     label: 'Платный' },
  { value: 'PAID_CONTRACT', label: 'Договор' },
  { value: 'CONTINGENT',    label: 'Контингент' },
  { value: 'EMPLOYEE',      label: 'Сотрудник' },
];

const PRIORITY_OPTS = [
  { value: 'WALK_IN',   label: 'Обращение' },
  { value: 'SCHEDULED', label: 'Плановый' },
  { value: 'INPATIENT', label: 'Стационарный' },
  { value: 'EMERGENCY', label: 'Экстренный' },
];

function isoDate(d: Date) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dy}`;
}

/* Build 7-day week starting from Monday, offset in weeks */
function buildWeek(weekOffset = 0): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=Sun
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + daysToMonday + weekOffset * 7);
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
                     'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

type Patient = {
  id: string; firstName: string; lastName: string;
  middleName?: string | null; phone?: string | null; iin?: string | null;
};

/* ─── SlotCell — shows "free / total" ───────────── */
function SlotCell({ booked, maxSlots, onClick }: { booked: number; maxSlots: number; onClick: () => void }) {
  const free = Math.max(0, maxSlots - booked);
  const pct  = maxSlots > 0 ? booked / maxSlots : 1;

  const bg  = pct >= 0.75 ? '#fef2f2' : pct >= 0.45 ? '#fefce8' : '#ecfdf5';
  const brd = pct >= 0.75 ? '#fca5a5' : pct >= 0.45 ? '#fcd34d' : '#86efac';
  const clr = pct >= 0.75 ? '#991b1b' : pct >= 0.45 ? '#92400e' : '#166534';

  if (free === 0) {
    return (
      <div className="w-full text-center text-[9px] font-semibold py-1 rounded"
        style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b' }}>
        0/{maxSlots}
      </div>
    );
  }

  return (
    <button onClick={onClick}
      className="w-full text-center rounded py-1 transition-all hover:brightness-95 leading-tight"
      style={{ background: bg, border: `1px solid ${brd}`, color: clr }}>
      <span className="text-[10px] font-bold">{free}</span>
      <span className="text-[8px] font-normal opacity-70">/{maxSlots}</span>
    </button>
  );
}

/* ─── TimePicker popup ───────────────────────────── */
function TimePicker({ doctor, date, takenTimes, availableSlots, patient, category, priority, onClose, onBooked }: {
  doctor: any; date: Date; takenTimes: string[]; availableSlots: string[];
  patient: Patient; category: string; priority: string;
  onClose: () => void; onBooked: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const { user } = useUser();
  const utils = trpc.useUtils();

  const addMutation = trpc.queue.add.useMutation({
    onSuccess: () => {
      toast.success(`${patient.lastName} записан на ${selected}`);
      utils.queue.getScheduledSlots.invalidate();
      utils.queue.getScheduledTimes.invalidate();
      onBooked();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const source = (user as any)?.role === 'CALL_CENTER' ? 'CALL_CENTER' : 'REGISTRAR';
  const dateLabel = `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
  const takenLocal = takenTimes.map(iso => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const freeCount = availableSlots.filter(t => !takenLocal.includes(t)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.28)' }} onClick={onClose}>
      <div className="bg-white shadow-2xl p-4 w-[320px]"
        style={{ borderRadius: '8px 28px 28px 8px', border: '1.5px solid #a8d4cd' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-baseline mb-3">
          <span className="text-[11px] font-bold text-foreground">
            {doctor.lastName} {doctor.firstName[0]}. · {dateLabel}
          </span>
          <span className="text-[8px] text-muted-foreground">{freeCount} свободных</span>
        </div>

        <div className="grid grid-cols-5 gap-1 mb-3">
          {availableSlots.map(t => {
            const isTaken = takenLocal.includes(t);
            return (
              <button key={t} disabled={isTaken}
                onClick={() => !isTaken && setSelected(t === selected ? null : t)}
                className="py-1 text-center text-[9px] font-semibold rounded transition-colors"
                style={
                  isTaken
                    ? { background: '#f8fafc', color: '#cbd5e1', textDecoration: 'line-through', border: '1px solid #e2e8f0' }
                    : t === selected
                    ? { background: '#00685B', color: '#fff', border: '1px solid #00685B' }
                    : { background: '#fff', color: '#1a1a1a', border: '1px solid #e2e8f0' }
                }>
                {t}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose}
            className="text-[9px] px-3 py-1.5 border border-border rounded text-muted-foreground">
            Отмена
          </button>
          <button
            disabled={!selected || addMutation.isPending}
            onClick={() => {
              if (!selected) return;
              const [h, m] = selected.split(':').map(Number);
              const at = new Date(date);
              at.setHours(h, m, 0, 0);
              addMutation.mutate({
                doctorId: doctor.id, patientId: patient.id,
                priority: priority as any, category: category as any,
                source: source as any, scheduledAt: at.toISOString(),
              });
            }}
            className="text-[9px] font-bold text-white px-4 py-1.5 disabled:opacity-40 transition-opacity"
            style={{ background: '#00685B', borderRadius: '4px 16px 16px 4px' }}>
            {addMutation.isPending ? '...' : `Записать ${selected ? 'на ' + selected : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── QueueTab — arrival + payment ──────────────── */
const PRIORITY_CLR: Record<string, string> = {
  EMERGENCY: '#dc2626', INPATIENT: '#ea580c', SCHEDULED: '#ca8a04', WALK_IN: '#16a34a',
};
const STATUS_LABEL: Record<string, string> = {
  WAITING_ARRIVAL: 'Не прибыл', ARRIVED: 'Прибыл',
  CALLED: 'Вызван', IN_PROGRESS: 'На приёме',
};
const CAT_SHORT: Record<string, string> = {
  PAID_ONCE: 'Платный', PAID_CONTRACT: 'Договор',
  OSMS: 'ОСМС', CONTINGENT: 'Контингент', EMPLOYEE: 'Сотрудник',
};

function QueueRow({ entry }: { entry: any }) {
  const utils = trpc.useUtils();

  const arrive = trpc.queue.confirmArrival.useMutation({
    onSuccess: () => { utils.queue.getByDoctor.invalidate(); toast.success('Приход отмечен'); },
    onError: (e: any) => toast.error(e.message),
  });
  const pay = trpc.queue.confirmPayment.useMutation({
    onSuccess: () => { utils.queue.getByDoctor.invalidate(); toast.success('Оплата подтверждена'); },
    onError: (e: any) => toast.error(e.message),
  });
  const cancel = trpc.queue.cancel.useMutation({
    onSuccess: () => { utils.queue.getByDoctor.invalidate(); toast.info('Запись отменена'); },
    onError: (e: any) => toast.error(e.message),
  });

  const isTerminal = ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status);
  const needsArrival  = entry.status === 'WAITING_ARRIVAL';
  const needsPayment  = !entry.paymentConfirmed && !isTerminal;

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-border/60 hover:bg-primary/5 transition-colors">
      {/* priority dot */}
      <span className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: PRIORITY_CLR[entry.priority] ?? '#94a3b8' }} />

      {/* patient name + meta */}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-foreground truncate">
          {entry.patient.lastName} {entry.patient.firstName}
          {entry.patient.middleName ? ` ${entry.patient.middleName[0]}.` : ''}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[8px] text-muted-foreground">
            {CAT_SHORT[entry.category] ?? entry.category}
          </span>
          <span className="text-[8px] text-muted-foreground">·</span>
          <span className="text-[8px] text-muted-foreground">
            {STATUS_LABEL[entry.status] ?? entry.status}
          </span>
          {entry.scheduledAt && (
            <>
              <span className="text-[8px] text-muted-foreground">·</span>
              <span className="text-[8px] font-medium text-primary">
                {new Date(entry.scheduledAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </>
          )}
        </div>
      </div>

      {/* doctor + cabinet */}
      <div className="text-right shrink-0 hidden sm:block">
        <div className="text-[8px] text-muted-foreground truncate max-w-[90px]">
          {entry.doctor?.lastName ?? '—'}
        </div>
        {entry.cabinet && (
          <div className="text-[8px] text-muted-foreground">каб. {entry.cabinet.number}</div>
        )}
      </div>

      {/* actions */}
      {!isTerminal && (
        <div className="flex items-center gap-1 shrink-0">
          {needsArrival && (
            <button
              onClick={() => arrive.mutate({ entryId: entry.id })}
              disabled={arrive.isPending}
              className="text-[8px] font-semibold px-2 py-1 transition-colors disabled:opacity-40"
              style={{
                background: '#ecfdf5', border: '1px solid #86efac', color: '#166534',
                borderRadius: '3px 10px 10px 3px',
              }}>
              Пришёл
            </button>
          )}
          {needsPayment && (
            <button
              onClick={() => pay.mutate({ entryId: entry.id })}
              disabled={pay.isPending}
              className="text-[8px] font-semibold px-2 py-1 transition-colors disabled:opacity-40"
              style={{
                background: '#fefce8', border: '1px solid #fcd34d', color: '#92400e',
                borderRadius: '3px 10px 10px 3px',
              }}>
              Оплата ✓
            </button>
          )}
          <button
            onClick={() => { if (confirm(`Отменить запись ${entry.patient.lastName}?`)) cancel.mutate({ entryId: entry.id }); }}
            disabled={cancel.isPending}
            className="text-[9px] text-destructive/50 hover:text-destructive px-1 transition-colors"
            title="Отменить">×</button>
        </div>
      )}
    </div>
  );
}

function DoctorQueueGroup({ assignment }: { assignment: any }) {
  const { data: entries = [] } = trpc.queue.getByDoctor.useQuery(
    { doctorId: assignment.doctorId },
    { refetchInterval: 20_000 },
  );

  const active = (entries as any[])
    .filter((e: any) => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status))
    .map((e: any) => ({ ...e, doctor: assignment.doctor, cabinet: assignment.cabinet }));

  return (
    <div className="rounded overflow-hidden border border-border">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-bold text-white shrink-0"
            style={{ background: '#00685B' }}>
            {assignment.doctor.lastName[0]}{assignment.doctor.firstName[0]}
          </div>
          <div>
            <span className="text-[10px] font-semibold text-foreground">
              {assignment.doctor.lastName} {assignment.doctor.firstName}
            </span>
            {assignment.doctor.specialty && (
              <span className="text-[8px] text-muted-foreground ml-1.5">· {assignment.doctor.specialty}</span>
            )}
            <span className="text-[8px] text-muted-foreground ml-1.5">· каб. {assignment.cabinet.number}</span>
          </div>
        </div>
        <span className="text-[8px] font-bold text-white px-1.5 py-0.5 rounded-full"
          style={{ background: active.length > 0 ? '#00685B' : '#94a3b8' }}>
          {active.length}
        </span>
      </div>
      {active.length === 0 ? (
        <div className="text-[9px] text-muted-foreground text-center py-3">Очередь пуста</div>
      ) : (
        active.map((e: any) => <QueueRow key={e.id} entry={e} />)
      )}
    </div>
  );
}

function QueueTab() {
  useQueueSocket();
  const { data: assignments = [], isLoading } = trpc.assignments.getActive.useQuery(
    undefined, { refetchInterval: 30_000 },
  );

  if (isLoading) return <div className="text-sm text-muted-foreground p-6 text-center">Загрузка...</div>;

  if ((assignments as any[]).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
        <span className="text-3xl opacity-20">⚕</span>
        <span className="text-sm">Нет активных врачей</span>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 overflow-y-auto" style={{ height: '100%' }}>
      {(assignments as any[]).map((a: any) => (
        <DoctorQueueGroup key={a.id} assignment={a} />
      ))}
    </div>
  );
}

/* ─── CalendarTab ────────────────────────────────── */
function CalendarTab() {
  const { user } = useUser();

  const [patient, setPatient]       = useState<Patient | null>(null);
  const [category, setCategory]     = useState('OSMS');
  const [priority, setPriority]     = useState('WALK_IN');
  const [weekOffset, setWeekOffset] = useState(0);
  const [deptFilter, setDeptFilter] = useState('');
  const [picker, setPicker]         = useState<{ doctor: any; date: Date; slots: string[] } | null>(null);

  const week      = useMemo(() => buildWeek(weekOffset), [weekOffset]);
  const startDate = isoDate(week[0]);
  const endDate   = isoDate(week[week.length - 1]);
  const today     = isoDate(new Date());

  const { data: allDoctors = [] }    = trpc.users.getDoctors.useQuery({ departmentId: '' });
  const { data: departments = [] }   = trpc.departments.getAll.useQuery();
  const { data: allSchedules = [] }  = trpc.schedules.getForDateRange.useQuery(
    { startDate, endDate }, { staleTime: 60_000 },
  );

  const { data: slotMap = {} } = trpc.queue.getScheduledSlots.useQuery(
    { startDate, endDate }, { staleTime: 30_000 },
  );

  const { data: takenTimes = [] } = trpc.queue.getScheduledTimes.useQuery(
    { doctorId: picker?.doctor.id ?? '', date: picker ? isoDate(picker.date) : '' },
    { enabled: !!picker, staleTime: 10_000 },
  );

  const doctors = useMemo(() => {
    let list = allDoctors as any[];
    if (deptFilter) list = list.filter((d: any) => d.departmentId === deptFilter);
    return list;
  }, [allDoctors, deptFilter]);

  const allowedCats = (user as any)?.allowedCategories?.length
    ? CATEGORY_OPTS.filter(o => (user as any).allowedCategories.includes(o.value))
    : CATEGORY_OPTS;

  return (
    <div className="flex overflow-hidden h-full">
      {/* Department sidebar */}
      <div className="shrink-0 border-r border-border flex flex-col bg-slate-50 overflow-y-auto" style={{ width: '150px' }}>
        <div className="px-2.5 py-1.5 border-b border-border bg-white shrink-0">
          <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Отделения</span>
        </div>
        <button onClick={() => setDeptFilter('')}
          className={`px-2.5 py-1.5 text-[9px] text-left border-l-2 transition-colors ${
            !deptFilter ? 'text-primary font-bold border-l-primary bg-primary/5' : 'text-muted-foreground border-l-transparent hover:bg-primary/5'}`}>
          Все
          <span className="float-right text-[8px] bg-slate-200 rounded-full px-1.5">{(allDoctors as any[]).length}</span>
        </button>
        {(departments as any[]).map((dept: any) => {
          const cnt = (allDoctors as any[]).filter((d: any) => d.departmentId === dept.id).length;
          if (cnt === 0) return null;
          return (
            <button key={dept.id} onClick={() => setDeptFilter(dept.id === deptFilter ? '' : dept.id)}
              className={`px-2.5 py-1.5 text-[6px] text-left border-l-2 transition-colors leading-snug ${
                deptFilter === dept.id ? 'text-primary font-bold border-l-primary bg-primary/5' : 'text-muted-foreground border-l-transparent hover:bg-primary/5'}`}>
              {dept.name}
              <span className="float-right text-[6px] bg-slate-200 rounded-full px-1.5 ml-1">{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="bg-slate-50 border-b border-border px-3 py-2 flex items-center gap-3 flex-wrap shrink-0">
          {patient ? (
            <div className="flex items-center gap-2 bg-white px-3 py-1.5"
              style={{ border: '1.5px solid #a8d4cd', borderRadius: '6px 22px 22px 6px' }}>
              <div className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                style={{ background: '#00685B' }}>
                {patient.lastName[0]}{patient.firstName[0]}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-foreground truncate">
                  {patient.lastName} {patient.firstName}
                </div>
                {patient.iin && <div className="text-[8px] text-muted-foreground">{patient.iin}</div>}
              </div>
              <button onClick={() => setPatient(null)} className="text-muted-foreground ml-1 text-[11px]">×</button>
            </div>
          ) : (
            <PatientSearch selected={null} onSelect={setPatient} />
          )}

          <div className="w-px h-6 bg-border" />

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] text-muted-foreground">Категория:</span>
            {allowedCats.map(o => (
              <button key={o.value} onClick={() => setCategory(o.value)}
                className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                  category === o.value ? 'bg-primary text-white border-primary' : 'bg-white text-muted-foreground border-border'}`}>
                {o.label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-border" />

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] text-muted-foreground">Приоритет:</span>
            {PRIORITY_OPTS.map(o => (
              <button key={o.value} onClick={() => setPriority(o.value)}
                className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                  priority === o.value ? 'bg-primary text-white border-primary' : 'bg-white text-muted-foreground border-border'}`}>
                {o.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => setWeekOffset(w => w - 2)} disabled={weekOffset <= 0}
              className="text-muted-foreground disabled:opacity-30 px-1">◀</button>
            <span className="text-[10px] font-semibold whitespace-nowrap">
              {week[0].getDate()} {MONTH_SHORT[week[0].getMonth()]} – {week[13].getDate()} {MONTH_SHORT[week[13].getMonth()]}
            </span>
            <button onClick={() => setWeekOffset(w => w + 2)} className="text-muted-foreground px-1">▶</button>
            <button onClick={() => setWeekOffset(0)}
              className="text-[9px] font-semibold text-primary border border-primary/30 px-2 py-0.5"
              style={{ borderRadius: '3px 12px 12px 3px' }}>
              Сегодня
            </button>
          </div>
        </div>

        {/* Calendar */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse" style={{ minWidth: '560px' }}>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left text-[9px] font-semibold text-muted-foreground border-b border-r border-border bg-slate-50 px-2 py-1.5"
                  style={{ width: 'var(--cal-doc-w, 152px)', minWidth: 'var(--cal-doc-w, 152px)' }}>
                  ВРАЧ
                </th>
                {week.map(d => {
                  const isToday   = isoDate(d) === today;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const thBg = isToday ? '#fefce8' : isWeekend ? '#fff1f2' : '#f8fafc';
                  return (
                    <th key={isoDate(d)}
                      className="text-center border-b border-r border-border px-1 py-1"
                      style={{ width: 'var(--cal-col-w, 72px)', minWidth: 'var(--cal-col-w, 72px)', background: thBg }}>
                      <span className={`block text-[8px] ${isToday ? 'text-amber-600' : isWeekend ? 'text-rose-400' : 'text-muted-foreground'}`}>
                        {DAY_NAMES[d.getDay()]}
                      </span>
                      <span className={`block text-[14px] font-bold leading-tight ${isToday ? 'text-amber-600' : isWeekend ? 'text-rose-500' : 'text-foreground'}`}>
                        {d.getDate()}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(doctors as any[]).length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">Нет врачей</td></tr>
              )}
              {(doctors as any[]).map((doc: any) => (
                <tr key={doc.id} className="hover:bg-primary/5 transition-colors">
                  <td className="border-b border-r border-border px-2 py-1.5 bg-white sticky left-0 z-[1]">
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
                  {week.map(d => {
                    const dstr      = isoDate(d);
                    const isPast    = dstr < today;
                    const isToday   = dstr === today;
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const booked = (slotMap as any)[doc.id]?.[dstr] ?? 0;
                    const slots = (allSchedules as any[]).find(
                      s => s.doctorId === doc.id && isoDate(new Date(s.date)) === dstr
                    );
                    const daySlots = slots ? slotsFromSchedule(slots) : null;
                    const tdBg = isToday ? '#fefce8' : isWeekend ? '#fff1f2' : undefined;
                    return (
                      <td key={dstr} className="border-b border-r border-border px-1 py-1" style={tdBg ? { background: tdBg } : undefined}>
                        {isPast || daySlots === null ? (
                          <div className={`text-center text-[9px] ${
                            isPast ? 'text-muted-foreground/30' : 'text-slate-300'
                          }`}>—</div>
                        ) : (
                          <SlotCell
                            booked={booked}
                            maxSlots={daySlots.length}
                            onClick={() => {
                              if (!patient) { toast.error('Сначала выберите пациента'); return; }
                              setPicker({ doctor: doc, date: d, slots: daySlots });
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Legend */}
          <div className="border-t border-border px-3 py-1.5 flex items-center gap-4 bg-slate-50 sticky bottom-0">
            {[
              { bg: '#ecfdf5', brd: '#86efac', label: 'Есть места' },
              { bg: '#fefce8', brd: '#fcd34d', label: 'Заполняется' },
              { bg: '#fee2e2', brd: '#fca5a5', label: 'Почти занят' },
            ].map(({ bg, brd, label }) => (
              <div key={label} className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: bg, border: `1px solid ${brd}` }} />
                {label}
              </div>
            ))}
            {!patient && (
              <span className="ml-auto text-[9px] text-amber-600 font-medium">Выберите пациента для записи</span>
            )}
          </div>
        </div>
      </div>

      {picker && patient && (
        <TimePicker
          doctor={picker.doctor} date={picker.date}
          takenTimes={takenTimes as string[]}
          availableSlots={picker.slots}
          patient={patient} category={category} priority={priority}
          onClose={() => setPicker(null)}
          onBooked={() => { setPicker(null); setPatient(null); }}
        />
      )}
    </div>
  );
}

/* ─── RegistrarView — two tabs ───────────────────── */
export function RegistrarView() {
  useQueueSocket();
  const [tab, setTab] = useState<'calendar' | 'queue'>('calendar');

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: 'calc(100vh - var(--header-h, 44px))' }}>
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-white px-4 shrink-0">
        {[
          { key: 'calendar', label: 'Запись пациентов' },
          { key: 'queue',    label: 'Очередь' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`text-[10px] font-semibold px-4 py-2.5 border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'calendar' ? <CalendarTab /> : <QueueTab />}
      </div>
    </div>
  );
}
