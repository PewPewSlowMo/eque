import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { PatientSearch } from './registrar/PatientSearch';
import { useQueueSocket } from './registrar/useQueueSocket';
import { toast } from 'sonner';

/* ─── constants ─────────────────────────────────── */
const MAX_SLOTS = 20;

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

function makeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h < 13; h++) {
    for (const m of [0, 15, 30, 45]) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}
const ALL_SLOTS = makeSlots();

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

function buildWeek(startOffset = 0, days = 7): Date[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + startOffset + i);
    d.setHours(0, 0, 0, 0);
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

/* ─── SlotCell ───────────────────────────────────── */
function SlotCell({ booked, onClick }: { booked: number; onClick: () => void }) {
  const free = MAX_SLOTS - booked;
  const pct = booked / MAX_SLOTS;

  if (free <= 0) {
    return (
      <button disabled className="w-full text-center rounded py-1 text-[9px] font-semibold opacity-60"
        style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b' }}>
        0
      </button>
    );
  }

  const bg  = pct >= 0.75 ? '#fef2f2' : pct >= 0.45 ? '#fefce8' : '#ecfdf5';
  const brd = pct >= 0.75 ? '#fca5a5' : pct >= 0.45 ? '#fcd34d' : '#86efac';
  const clr = pct >= 0.75 ? '#991b1b' : pct >= 0.45 ? '#92400e' : '#166534';

  return (
    <button onClick={onClick} className="w-full text-center rounded py-1 text-[10px] font-bold transition-all hover:brightness-95"
      style={{ background: bg, border: `1px solid ${brd}`, color: clr }}>
      {free}
    </button>
  );
}

/* ─── TimePicker ─────────────────────────────────── */
function TimePicker({ doctor, date, takenTimes, patient, category, priority, onClose, onBooked }: {
  doctor: any; date: Date; takenTimes: string[];
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
      onBooked();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const source = user?.role === 'CALL_CENTER' ? 'CALL_CENTER' : 'REGISTRAR';
  const dateLabel = `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.25)' }}
      onClick={onClose}>
      <div className="bg-white shadow-2xl p-4 w-[320px]"
        style={{ borderRadius: '8px 28px 28px 8px', border: '1.5px solid #a8d4cd' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-baseline mb-3">
          <span className="text-[11px] font-bold text-foreground">
            {doctor.lastName} {doctor.firstName[0]}. · {dateLabel}
          </span>
          <span className="text-[8px] text-muted-foreground">
            {ALL_SLOTS.length - takenTimes.length} свободных
          </span>
        </div>

        <div className="grid grid-cols-5 gap-1 mb-3">
          {ALL_SLOTS.map(t => {
            const taken = takenTimes.includes(t);
            return (
              <button key={t} disabled={taken}
                onClick={() => !taken && setSelected(t === selected ? null : t)}
                className="py-1 text-center text-[9px] font-semibold rounded transition-colors"
                style={
                  taken
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
                doctorId: doctor.id,
                patientId: patient.id,
                priority: priority as any,
                category: category as any,
                source: source as any,
                scheduledAt: at.toISOString(),
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

/* ─── RegistrarView ──────────────────────────────── */
export function RegistrarView() {
  useQueueSocket();
  const { user } = useUser();

  const [patient, setPatient]       = useState<Patient | null>(null);
  const [category, setCategory]     = useState('OSMS');
  const [priority, setPriority]     = useState('WALK_IN');
  const [weekOffset, setWeekOffset] = useState(0);
  const [specFilter, setSpecFilter] = useState('');
  const [picker, setPicker]         = useState<{ doctor: any; date: Date } | null>(null);

  const week      = useMemo(() => buildWeek(weekOffset * 7), [weekOffset]);
  const startDate = isoDate(week[0]);
  const endDate   = isoDate(week[week.length - 1]);
  const today     = isoDate(new Date());

  const { data: allDoctors = [] } = trpc.users.getDoctors.useQuery({ departmentId: '' });

  const { data: slotMap = {} } = trpc.queue.getScheduledSlots.useQuery(
    { startDate, endDate },
    { staleTime: 30_000 },
  );

  const { data: takenTimes = [] } = trpc.queue.getScheduledTimes.useQuery(
    { doctorId: picker?.doctor.id ?? '', date: picker ? isoDate(picker.date) : '' },
    { enabled: !!picker, staleTime: 10_000 },
  );

  const specialties = useMemo(() => {
    const set = new Set<string>();
    (allDoctors as any[]).forEach((d: any) => { if (d.specialty) set.add(d.specialty); });
    return Array.from(set).sort();
  }, [allDoctors]);

  const doctors = useMemo(() => {
    let list = allDoctors as any[];
    if (specFilter) list = list.filter((d: any) => d.specialty === specFilter);
    return list;
  }, [allDoctors, specFilter]);

  const allowedCats = (user as any)?.allowedCategories?.length
    ? CATEGORY_OPTS.filter(o => (user as any).allowedCategories.includes(o.value))
    : CATEGORY_OPTS;

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - var(--header-h, 44px))' }}>

      {/* ── SPECIALTY SIDEBAR ── */}
      <div className="shrink-0 border-r border-border flex flex-col bg-slate-50 overflow-y-auto" style={{ width: '130px' }}>
        <div className="px-2 py-1.5 border-b border-border bg-white">
          <input
            className="w-full text-[9px] border border-border rounded px-1.5 py-1 outline-none"
            placeholder="Поиск..."
            value={specFilter}
            onChange={e => setSpecFilter(e.target.value)}
          />
        </div>
        <button
          onClick={() => setSpecFilter('')}
          className={`px-2.5 py-1.5 text-[9px] text-left border-l-2 transition-colors ${
            !specFilter ? 'text-primary font-bold border-l-primary bg-primary/5' : 'text-muted-foreground border-l-transparent'
          }`}
        >
          Все
          <span className="float-right text-[8px] bg-slate-200 rounded-full px-1.5">{(allDoctors as any[]).length}</span>
        </button>
        {specialties.map(spec => {
          const cnt = (allDoctors as any[]).filter((d: any) => d.specialty === spec).length;
          return (
            <button key={spec}
              onClick={() => setSpecFilter(spec === specFilter ? '' : spec)}
              className={`px-2.5 py-1.5 text-[9px] text-left border-l-2 transition-colors ${
                specFilter === spec ? 'text-primary font-bold border-l-primary bg-primary/5' : 'text-muted-foreground border-l-transparent hover:bg-primary/5'
              }`}
            >
              {spec}
              {cnt > 1 && <span className="float-right text-[8px] bg-slate-200 rounded-full px-1.5">{cnt}</span>}
            </button>
          );
        })}
      </div>

      {/* ── MAIN ── */}
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
                  category === o.value ? 'bg-primary text-white border-primary' : 'bg-white text-muted-foreground border-border'
                }`}>
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
                  priority === o.value ? 'bg-primary text-white border-primary' : 'bg-white text-muted-foreground border-border'
                }`}>
                {o.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => setWeekOffset(w => w - 1)} disabled={weekOffset <= 0}
              className="text-muted-foreground disabled:opacity-30 px-1">◀</button>
            <span className="text-[10px] font-semibold whitespace-nowrap">
              {week[0].getDate()} – {week[6].getDate()} {MONTH_SHORT[week[6].getMonth()]}
            </span>
            <button onClick={() => setWeekOffset(w => w + 1)} className="text-muted-foreground px-1">▶</button>
            <button onClick={() => setWeekOffset(0)}
              className="text-[9px] font-semibold text-primary border border-primary/30 px-2 py-0.5"
              style={{ borderRadius: '3px 12px 12px 3px' }}>
              Сегодня
            </button>
          </div>
        </div>

        {/* Calendar table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse" style={{ minWidth: '560px' }}>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left text-[9px] font-semibold text-muted-foreground border-b border-r border-border bg-slate-50 px-2 py-1.5"
                  style={{ width: 'var(--cal-doc-w, 152px)', minWidth: 'var(--cal-doc-w, 152px)' }}>
                  ВРАЧ
                </th>
                {week.map(d => {
                  const isToday = isoDate(d) === today;
                  return (
                    <th key={isoDate(d)}
                      className={`text-center border-b border-r border-border px-1 py-1 bg-slate-50`}
                      style={{ width: 'var(--cal-col-w, 68px)', minWidth: 'var(--cal-col-w, 68px)' }}>
                      <span className={`block text-[8px] ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                        {DAY_NAMES[d.getDay()]}
                      </span>
                      <span className={`block text-[14px] font-bold leading-tight ${isToday ? 'text-primary' : 'text-foreground'}`}>
                        {d.getDate()}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(doctors as any[]).length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">Нет врачей</td>
                </tr>
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
                    const dstr = isoDate(d);
                    const isPast = dstr < today;
                    const booked = (slotMap as any)[doc.id]?.[dstr] ?? 0;
                    return (
                      <td key={dstr} className="border-b border-r border-border px-1 py-1">
                        {isPast ? (
                          <div className="text-center text-[9px] text-muted-foreground/30">—</div>
                        ) : (
                          <SlotCell
                            booked={booked}
                            onClick={() => {
                              if (!patient) { toast.error('Сначала выберите пациента'); return; }
                              setPicker({ doctor: doc, date: d });
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

          <div className="border-t border-border px-3 py-1.5 flex items-center gap-4 bg-slate-50 sticky bottom-0">
            <div className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#ecfdf5', border: '1px solid #86efac' }} />Есть места
            </div>
            <div className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#fefce8', border: '1px solid #fcd34d' }} />Заполняется
            </div>
            <div className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#fee2e2', border: '1px solid #fca5a5' }} />Почти занят
            </div>
            {!patient && (
              <span className="ml-auto text-[9px] text-amber-600 font-medium">Выберите пациента для записи</span>
            )}
          </div>
        </div>
      </div>

      {picker && patient && (
        <TimePicker
          doctor={picker.doctor}
          date={picker.date}
          takenTimes={takenTimes as string[]}
          patient={patient}
          category={category}
          priority={priority}
          onClose={() => setPicker(null)}
          onBooked={() => { setPicker(null); setPatient(null); }}
        />
      )}
    </div>
  );
}
