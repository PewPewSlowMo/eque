import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { useQueueSocket } from './registrar/useQueueSocket';
import { toast } from 'sonner';

/* Cabinet status derived from assignment */
type CabStatus = 'active' | 'free' | 'off';

function cabStyle(status: CabStatus) {
  if (status === 'active') return { background: '#005048', border: '1.5px solid #00a08f' };
  if (status === 'free')   return { background: '#0e2a25', border: '1.5px dashed #00685B' };
  return { background: '#1c1e2a', border: '1.5px solid #2a2d3a', opacity: 0.45 };
}

/* ── Assign Dialog ──────────────────────────────── */
function AssignDialog({ cabinet, doctors, onClose, onAssigned }: {
  cabinet: any; doctors: any[]; onClose: () => void; onAssigned: () => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const utils = trpc.useUtils();

  const assign = trpc.assignments.assign.useMutation({
    onSuccess: () => {
      utils.assignments.getActive.invalidate();
      toast.success('Врач назначен');
      onAssigned();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unassign = trpc.assignments.unassign.useMutation({
    onSuccess: () => {
      utils.assignments.getActive.invalidate();
      toast.success('Назначение снято');
      onAssigned();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.5)' }}
      onClick={onClose}>
      <div className="p-4 w-[220px] shadow-2xl"
        style={{ background: '#1a1d27', border: '1.5px solid rgba(0,104,91,.4)', borderRadius: '8px 20px 20px 8px' }}
        onClick={e => e.stopPropagation()}>
        <div className="text-[11px] font-bold text-slate-200 mb-3">
          Каб. {cabinet.number}{cabinet.name ? ` — ${cabinet.name}` : ''}
        </div>

        {cabinet.assignment && (
          <div className="mb-3 pb-3 border-b" style={{ borderColor: '#252831' }}>
            <div className="text-[8px] text-slate-500 mb-1">Сейчас назначен</div>
            <div className="text-[10px] font-semibold text-slate-200">
              {cabinet.assignment.doctor.lastName} {cabinet.assignment.doctor.firstName}
            </div>
            <button
              onClick={() => unassign.mutate({ assignmentId: cabinet.assignment.id })}
              disabled={unassign.isPending}
              className="mt-2 text-[8px] text-red-400 border px-2 py-0.5 rounded disabled:opacity-40"
              style={{ borderColor: 'rgba(239,68,68,.3)', borderRadius: '3px 10px 10px 3px' }}>
              Снять назначение
            </button>
          </div>
        )}

        <div className="text-[8px] text-slate-500 mb-1">
          {cabinet.assignment ? 'Заменить врача' : 'Назначить врача'}
        </div>
        <select
          value={doctorId}
          onChange={e => setDoctorId(e.target.value)}
          className="w-full text-[10px] px-2 py-1.5 mb-3 outline-none"
          style={{ background: '#12151e', border: '1px solid #252831', borderRadius: '4px', color: '#e2e8f0' }}>
          <option value="">Выберите врача...</option>
          {doctors.map((d: any) => (
            <option key={d.id} value={d.id}>
              {d.lastName} {d.firstName}{d.specialty ? ` — ${d.specialty}` : ''}
            </option>
          ))}
        </select>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-[8px] text-slate-500 px-2 py-1 border"
            style={{ border: '1px solid #252831', borderRadius: '3px 10px 10px 3px' }}>
            Отмена
          </button>
          <button
            disabled={!doctorId || assign.isPending}
            onClick={() => assign.mutate({ doctorId, cabinetId: cabinet.id })}
            className="text-[8px] font-bold text-white px-3 py-1 disabled:opacity-40"
            style={{ background: '#00685B', borderRadius: '3px 10px 10px 3px' }}>
            {assign.isPending ? '...' : 'Назначить'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── DepartmentHeadView ─────────────────────────── */
export function DepartmentHeadView() {
  const { user } = useUser();
  const departmentId = user?.departmentId ?? '';

  useQueueSocket();

  const [floor, setFloor]   = useState(1);
  const [dialog, setDialog] = useState<any | null>(null);
  const [tab, setTab]       = useState<'plan' | 'list'>('plan');

  const { data: allAssignments = [] } = trpc.assignments.getActive.useQuery();
  const { data: doctors = [] }        = trpc.users.getDoctors.useQuery({ departmentId }, { enabled: !!departmentId });
  const { data: cabinets = [] }       = trpc.cabinets.getAll.useQuery();

  const assignmentMap = new Map(
    (allAssignments as any[]).map((a: any) => [a.cabinetId, a]),
  );

  const deptAssignments = (allAssignments as any[]).filter(
    (a: any) => !departmentId || a.doctor.departmentId === departmentId,
  );

  const floorCabinets = (cabinets as any[]).filter(
    (c: any) => !c.isDeactivated,
  );

  /* Grid layout: up to 6 per row */
  const COLS = 6;
  const rows: any[][] = [];
  for (let i = 0; i < floorCabinets.length; i += COLS) {
    rows.push(floorCabinets.slice(i, i + COLS));
  }

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: 'calc(100vh - var(--header-h, 44px))' }}>

      {/* ── dark nav bar ── */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ background: '#12151e', borderBottom: '1px solid #252831' }}>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold" style={{ color: '#B39168' }}>
            Планировка
          </span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(f => (
              <button key={f} onClick={() => setFloor(f)}
                className="text-[9px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                style={floor === f
                  ? { background: '#00685B', color: '#fff', border: '1px solid #00685B' }
                  : { color: '#6b7280', border: '1px solid #252831' }}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => setTab('plan')}
            className={`text-[9px] font-semibold px-2.5 py-1 transition-colors ${tab === 'plan' ? 'text-white' : 'text-slate-500'}`}>
            Планировка
          </button>
          <button onClick={() => setTab('list')}
            className={`text-[9px] font-semibold px-2.5 py-1 transition-colors ${tab === 'list' ? 'text-white' : 'text-slate-500'}`}>
            Список
          </button>
          <span className="text-[17px] font-bold tabular-nums" style={{ color: '#B39168' }}>{timeStr}</span>
        </div>
      </div>

      {tab === 'plan' ? (
        <div className="flex flex-1 overflow-hidden" style={{ background: '#1a1d27' }}>
          {/* building area */}
          <div className="flex-1 overflow-auto p-4">
            {/* building shell */}
            <div className="relative rounded p-4 pb-2" style={{ background: '#1e2030', border: '2px solid #3a3040', minHeight: '260px' }}>
              {/* corridor */}
              <div className="absolute left-12 right-12 flex items-center justify-center"
                style={{ top: '50%', height: '18px', transform: 'translateY(-50%)',
                  borderTop: '1px dashed #353040', borderBottom: '1px dashed #353040' }}>
                <span className="text-[7px] tracking-widest uppercase" style={{ color: '#44384f' }}>Коридор</span>
              </div>

              {/* Upper row */}
              <div className="flex gap-2 mb-auto">
                {floorCabinets.slice(0, Math.ceil(floorCabinets.length / 2)).map((cab: any) => {
                  const a = assignmentMap.get(cab.id);
                  const status: CabStatus = a ? 'active' : 'free';
                  return (
                    <button key={cab.id}
                      onClick={() => setDialog({ ...cab, assignment: a ?? null })}
                      className="flex flex-col items-center justify-center text-center transition-all hover:brightness-110"
                      style={{ ...cabStyle(status), width: '80px', height: '64px', borderRadius: '3px', padding: '4px', flexShrink: 0 }}>
                      <span className="text-[9px] font-bold" style={{ color: 'rgba(255,255,255,.85)' }}>{cab.number}</span>
                      {a ? (
                        <span className="text-[7px] truncate max-w-[70px]" style={{ color: 'rgba(255,255,255,.6)' }}>
                          {a.doctor.lastName}
                        </span>
                      ) : (
                        <span className="text-[7px]" style={{ color: 'rgba(0,200,160,.5)' }}>свободен</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* bottom spacer for corridor */}
              <div style={{ height: '32px' }} />

              {/* Lower row */}
              <div className="flex gap-2">
                {floorCabinets.slice(Math.ceil(floorCabinets.length / 2)).map((cab: any) => {
                  const a = assignmentMap.get(cab.id);
                  const status: CabStatus = a ? 'active' : 'free';
                  return (
                    <button key={cab.id}
                      onClick={() => setDialog({ ...cab, assignment: a ?? null })}
                      className="flex flex-col items-center justify-center text-center transition-all hover:brightness-110"
                      style={{ ...cabStyle(status), width: '80px', height: '64px', borderRadius: '3px', padding: '4px', flexShrink: 0 }}>
                      <span className="text-[9px] font-bold" style={{ color: 'rgba(255,255,255,.85)' }}>{cab.number}</span>
                      {a ? (
                        <span className="text-[7px] truncate max-w-[70px]" style={{ color: 'rgba(255,255,255,.6)' }}>
                          {a.doctor.lastName}
                        </span>
                      ) : (
                        <span className="text-[7px]" style={{ color: 'rgba(0,200,160,.5)' }}>свободен</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* legend */}
            <div className="flex gap-4 mt-3 px-1">
              {[
                { style: { background: '#005048', border: '1.5px solid #00a08f' }, label: 'Принимает' },
                { style: { background: '#0e2a25', border: '1.5px dashed #00685B' }, label: 'Свободен' },
                { style: { background: '#1c1e2a', border: '1.5px solid #2a2d3a', opacity: 0.6 }, label: 'Неактивен' },
              ].map(({ style, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm inline-block" style={style} />
                  <span className="text-[8px]" style={{ color: '#6b7280' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* doctor sidebar */}
          <div className="shrink-0 overflow-y-auto p-2" style={{ width: '164px', background: '#12151e', borderLeft: '1px solid #252831' }}>
            <div className="text-[8px] font-bold uppercase tracking-wide mb-2" style={{ color: '#64748b' }}>Врачи</div>
            {(doctors as any[]).map((doc: any) => {
              const a = (allAssignments as any[]).find((x: any) => x.doctorId === doc.id);
              return (
                <div key={doc.id}
                  className="flex items-center gap-2 rounded p-2 mb-1 cursor-pointer"
                  style={{
                    background: '#1a1d27',
                    border: `1px solid ${a ? 'rgba(0,104,91,.4)' : '#252831'}`,
                    borderRadius: '4px',
                  }}>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-bold text-white shrink-0"
                    style={{ background: '#00685B' }}>
                    {doc.lastName[0]}{doc.firstName[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-semibold truncate" style={{ color: '#d1d5db' }}>
                      {doc.lastName} {doc.firstName[0]}.
                    </div>
                    <div className="text-[8px]" style={{ color: a ? '#B39168' : '#f97316' }}>
                      {a ? `Каб. ${a.cabinet.number}` : 'Не назначен'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* List view */
        <div className="flex-1 overflow-y-auto p-4" style={{ background: '#1a1d27' }}>
          <div className="max-w-2xl mx-auto space-y-2">
            {deptAssignments.length === 0 && (
              <p className="text-sm text-center py-12" style={{ color: '#64748b' }}>Нет активных назначений</p>
            )}
            {deptAssignments.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-3 rounded"
                style={{ background: '#1e2030', border: '1px solid #252831' }}>
                <div>
                  <div className="text-[11px] font-semibold" style={{ color: '#e2e8f0' }}>
                    {a.doctor.lastName} {a.doctor.firstName}
                    {a.doctor.specialty && (
                      <span className="ml-2 font-normal" style={{ color: '#64748b' }}>· {a.doctor.specialty}</span>
                    )}
                  </div>
                  <div className="text-[9px] mt-0.5" style={{ color: '#B39168' }}>
                    Кабинет {a.cabinet.number}{a.cabinet.name ? ` — ${a.cabinet.name}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Снять назначение ${a.doctor.lastName}?`)) {
                      trpc.useUtils().assignments.unassign.invalidate?.();
                    }
                  }}
                  className="text-[8px] px-2 py-1"
                  style={{ border: '1px solid rgba(239,68,68,.3)', color: '#ef4444', borderRadius: '3px 10px 10px 3px' }}>
                  Снять
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {dialog && (
        <AssignDialog
          cabinet={dialog}
          doctors={doctors as any[]}
          onClose={() => setDialog(null)}
          onAssigned={() => setDialog(null)}
        />
      )}
    </div>
  );
}
