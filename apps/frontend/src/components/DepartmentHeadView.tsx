import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { useQueueSocket } from './registrar/useQueueSocket';
import { toast } from 'sonner';

/* ─── helpers ────────────────────────────────────── */
type CabStatus = 'active' | 'free' | 'off';

function cabStyle(status: CabStatus, isDragOver: boolean) {
  if (isDragOver) return { background: '#00685B', border: '2px solid #B39168', opacity: 1 };
  if (status === 'active') return { background: '#005048', border: '1.5px solid #00a08f' };
  if (status === 'free')   return { background: '#0e2a25', border: '1.5px dashed #00685B' };
  return { background: '#1c1e2a', border: '1.5px solid #2a2d3a', opacity: 0.45 };
}

/* ─── AssignDialog (click-based fallback) ─────────── */
function AssignDialog({ cabinet, doctors, assignmentsByCabinet, onClose, onDone }: {
  cabinet: any; doctors: any[]; assignmentsByCabinet: Map<string, any[]>;
  onClose: () => void; onDone: () => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const utils = trpc.useUtils();

  const assign = trpc.assignments.assign.useMutation({
    onSuccess: () => { utils.assignments.getActive.invalidate(); toast.success('Врач назначен'); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  const unassign = trpc.assignments.unassign.useMutation({
    onSuccess: () => { utils.assignments.getActive.invalidate(); toast.success('Назначение снято'); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });

  const cabAssignments = assignmentsByCabinet.get(cabinet.id) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="p-4 w-[240px] shadow-2xl"
        style={{ background: '#1a1d27', border: '1.5px solid rgba(0,104,91,.4)', borderRadius: '8px 20px 20px 8px' }}
        onClick={e => e.stopPropagation()}>
        <div className="text-[11px] font-bold text-slate-200 mb-3">
          Каб. {cabinet.number}{cabinet.name ? ` — ${cabinet.name}` : ''}
        </div>

        {/* Current assignments */}
        {cabAssignments.length > 0 && (
          <div className="mb-3 pb-3 border-b" style={{ borderColor: '#252831' }}>
            <div className="text-[8px] text-slate-500 mb-1.5">Назначено ({cabAssignments.length})</div>
            <div className="space-y-1.5">
              {cabAssignments.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-200">
                    {a.doctor.lastName} {a.doctor.firstName[0]}.
                  </span>
                  <button
                    onClick={() => unassign.mutate({ assignmentId: a.id })}
                    disabled={unassign.isPending}
                    className="text-[8px] text-red-400 border px-1.5 py-0.5 disabled:opacity-40"
                    style={{ borderColor: 'rgba(239,68,68,.3)', borderRadius: '2px 8px 8px 2px' }}>
                    Снять
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-[8px] text-slate-500 mb-1">Назначить врача</div>
        <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
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
          <button onClick={onClose} className="text-[8px] text-slate-500 px-2 py-1"
            style={{ border: '1px solid #252831', borderRadius: '3px 10px 10px 3px' }}>
            Отмена
          </button>
          <button disabled={!doctorId || assign.isPending}
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

/* ─── Overload confirm dialog ────────────────────── */
function OverloadConfirm({ cabinet, count, onConfirm, onCancel }: {
  cabinet: any; count: number; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.5)' }} onClick={onCancel}>
      <div className="p-4 w-[260px] shadow-2xl"
        style={{ background: '#1a1d27', border: '1.5px solid rgba(179,145,104,.4)', borderRadius: '8px 20px 20px 8px' }}
        onClick={e => e.stopPropagation()}>
        <div className="text-[11px] font-bold mb-2" style={{ color: '#B39168' }}>
          Кабинет {cabinet.number} занят
        </div>
        <p className="text-[10px] text-slate-300 mb-4">
          В кабинете уже {count} {count === 2 ? 'врача' : 'врачей'}. Назначить ещё одного?
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="text-[9px] text-slate-500 px-3 py-1.5"
            style={{ border: '1px solid #252831', borderRadius: '3px 10px 10px 3px' }}>
            Отмена
          </button>
          <button onClick={onConfirm}
            className="text-[9px] font-bold text-white px-4 py-1.5"
            style={{ background: '#00685B', borderRadius: '3px 10px 10px 3px' }}>
            Назначить
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── DepartmentHeadView ─────────────────────────── */
export function DepartmentHeadView() {
  const { user } = useUser();
  const departmentId = user?.departmentId ?? '';

  useQueueSocket();

  const [floor,      setFloor]      = useState(1);
  const [dialog,     setDialog]     = useState<any | null>(null);
  const [tab,        setTab]        = useState<'plan' | 'list'>('plan');
  const [dragOver,   setDragOver]   = useState<string | null>(null);  // cabinetId
  const [overload,   setOverload]   = useState<{ doctorId: string; cabinet: any } | null>(null);

  const { data: allAssignments = [] } = trpc.assignments.getActive.useQuery();
  const { data: doctors = [] }        = trpc.users.getDoctors.useQuery({ departmentId }, { enabled: !!departmentId });
  const { data: cabinets = [] }       = trpc.cabinets.getAll.useQuery();
  const utils = trpc.useUtils();

  const assign = trpc.assignments.assign.useMutation({
    onSuccess: () => { utils.assignments.getActive.invalidate(); toast.success('Врач назначен'); },
    onError: (e: any) => toast.error(e.message),
  });

  // Multiple assignments per cabinet
  const assignmentsByCabinet = new Map<string, any[]>();
  for (const a of allAssignments as any[]) {
    if (!assignmentsByCabinet.has(a.cabinetId)) assignmentsByCabinet.set(a.cabinetId, []);
    assignmentsByCabinet.get(a.cabinetId)!.push(a);
  }

  const deptAssignments = (allAssignments as any[]).filter(
    (a: any) => !departmentId || a.doctor.departmentId === departmentId,
  );

  const floorCabinets = (cabinets as any[]).filter((c: any) => !c.isDeactivated);

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  /* ── drag & drop ── */
  const handleDrop = (cabinet: any, doctorId: string) => {
    const cabAssignments = assignmentsByCabinet.get(cabinet.id) ?? [];
    if (cabAssignments.length >= 2) {
      setOverload({ doctorId, cabinet });
    } else {
      assign.mutate({ doctorId, cabinetId: cabinet.id });
    }
  };

  const renderCabinets = (cabs: any[]) => cabs.map((cab: any) => {
    const cabAssignments = assignmentsByCabinet.get(cab.id) ?? [];
    const status: CabStatus = cabAssignments.length > 0 ? 'active' : 'free';
    const isDrag = dragOver === cab.id;

    return (
      <button key={cab.id}
        onClick={() => setDialog(cab)}
        onDragOver={e => { e.preventDefault(); setDragOver(cab.id); }}
        onDragLeave={() => setDragOver(null)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(null);
          const doctorId = e.dataTransfer.getData('doctorId');
          if (doctorId) handleDrop(cab, doctorId);
        }}
        className="flex flex-col items-center justify-center text-center transition-all hover:brightness-110"
        style={{ ...cabStyle(status, isDrag), width: '80px', height: '64px', borderRadius: '3px', padding: '4px', flexShrink: 0 }}>
        <span className="text-[9px] font-bold" style={{ color: 'rgba(255,255,255,.85)' }}>{cab.number}</span>
        {cabAssignments.length > 0 ? (
          <div className="w-full">
            {cabAssignments.slice(0, 2).map((a: any) => (
              <div key={a.id} className="text-[6px] truncate max-w-[70px]" style={{ color: 'rgba(255,255,255,.6)' }}>
                {a.doctor.lastName}
              </div>
            ))}
            {cabAssignments.length > 2 && (
              <div className="text-[6px]" style={{ color: '#B39168' }}>+{cabAssignments.length - 2}</div>
            )}
          </div>
        ) : (
          <span className="text-[7px]" style={{ color: isDrag ? 'rgba(255,255,255,.8)' : 'rgba(0,200,160,.5)' }}>
            {isDrag ? 'Отпустите' : 'свободен'}
          </span>
        )}
      </button>
    );
  });

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: 'calc(100vh - var(--header-h, 44px))' }}>

      {/* nav bar */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ background: '#12151e', borderBottom: '1px solid #252831' }}>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold" style={{ color: '#B39168' }}>Планировка</span>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(f => (
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
          {/* floor plan */}
          <div className="flex-1 overflow-auto p-4">
            <div className="relative rounded p-4 pb-2"
              style={{ background: '#1e2030', border: '2px solid #3a3040', minHeight: '260px' }}>
              <div className="absolute left-12 right-12 flex items-center justify-center"
                style={{ top: '50%', height: '18px', transform: 'translateY(-50%)',
                  borderTop: '1px dashed #353040', borderBottom: '1px dashed #353040' }}>
                <span className="text-[7px] tracking-widest uppercase" style={{ color: '#44384f' }}>Коридор</span>
              </div>
              <div className="flex gap-2 mb-auto">
                {renderCabinets(floorCabinets.slice(0, Math.ceil(floorCabinets.length / 2)))}
              </div>
              <div style={{ height: '32px' }} />
              <div className="flex gap-2">
                {renderCabinets(floorCabinets.slice(Math.ceil(floorCabinets.length / 2)))}
              </div>
            </div>

            <div className="flex gap-4 mt-3 px-1">
              {[
                { style: { background: '#005048', border: '1.5px solid #00a08f' }, label: 'Принимает' },
                { style: { background: '#0e2a25', border: '1.5px dashed #00685B' }, label: 'Свободен' },
              ].map(({ style, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm inline-block" style={style} />
                  <span className="text-[8px]" style={{ color: '#6b7280' }}>{label}</span>
                </div>
              ))}
              <span className="text-[8px] ml-auto" style={{ color: '#44384f' }}>
                Перетащите врача из списка на кабинет
              </span>
            </div>
          </div>

          {/* doctor sidebar — draggable */}
          <div className="shrink-0 overflow-y-auto p-2"
            style={{ width: '164px', background: '#12151e', borderLeft: '1px solid #252831' }}>
            <div className="text-[8px] font-bold uppercase tracking-wide mb-2" style={{ color: '#64748b' }}>Врачи</div>
            {(doctors as any[]).map((doc: any) => {
              const assignments = (allAssignments as any[]).filter((x: any) => x.doctorId === doc.id);
              return (
                <div key={doc.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('doctorId', doc.id); e.dataTransfer.effectAllowed = 'move'; }}
                  className="flex items-center gap-2 rounded p-2 mb-1 cursor-grab active:cursor-grabbing select-none"
                  style={{
                    background: '#1a1d27',
                    border: `1px solid ${assignments.length > 0 ? 'rgba(0,104,91,.4)' : '#252831'}`,
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
                    {assignments.length > 0 ? (
                      assignments.map((a: any) => (
                        <div key={a.id} className="text-[7px]" style={{ color: '#B39168' }}>
                          Каб. {a.cabinet.number}
                        </div>
                      ))
                    ) : (
                      <div className="text-[7px]" style={{ color: '#f97316' }}>Не назначен</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* list view */
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
                  onClick={() => { if (confirm(`Снять назначение ${a.doctor.lastName}?`)) {
                    trpc.useUtils(); // note: actual unassign needs mutation
                  }}}
                  className="text-[8px] px-2 py-1"
                  style={{ border: '1px solid rgba(239,68,68,.3)', color: '#ef4444', borderRadius: '3px 10px 10px 3px' }}>
                  Снять
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* click-based assign dialog */}
      {dialog && (
        <AssignDialog
          cabinet={dialog}
          doctors={doctors as any[]}
          assignmentsByCabinet={assignmentsByCabinet}
          onClose={() => setDialog(null)}
          onDone={() => setDialog(null)}
        />
      )}

      {/* overload confirm */}
      {overload && (
        <OverloadConfirm
          cabinet={overload.cabinet}
          count={(assignmentsByCabinet.get(overload.cabinet.id) ?? []).length}
          onCancel={() => setOverload(null)}
          onConfirm={() => {
            assign.mutate({ doctorId: overload.doctorId, cabinetId: overload.cabinet.id });
            setOverload(null);
          }}
        />
      )}
    </div>
  );
}
