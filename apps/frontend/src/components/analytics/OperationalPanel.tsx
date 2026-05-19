// apps/frontend/src/components/analytics/OperationalPanel.tsx
import { trpc } from '@/lib/trpc';

interface Props {
  deptId?: string;
}

function StatCard({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div className="flex-1 min-w-[100px] p-3 rounded"
      style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.25)' }}>
      <div className="text-[8px] text-slate-500 mb-1">{label}</div>
      <div className={`text-[20px] font-bold tabular-nums ${warn ? 'text-red-400' : 'text-slate-100'}`}>{value}</div>
      {sub && <div className="text-[8px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  active: '#00a08f',
  free:   '#B39168',
  off:    '#4b5563',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Принимает',
  free:   'Свободен',
  off:    'Не вышел',
};

export function OperationalPanel({ deptId }: Props) {
  const { data, isLoading } = trpc.analytics.getOperational.useQuery(
    { deptId },
    { refetchInterval: 30_000 },
  );

  if (isLoading) return <div className="text-[10px] text-slate-500 py-8 text-center">Загрузка...</div>;
  if (!data) return null;

  const { summary, doctors } = data as any;

  return (
    <div className="space-y-4">
      {/* Сводные карточки */}
      <div className="flex gap-3 flex-wrap">
        <StatCard label="Ожидают" value={summary.totalWaiting} />
        <StatCard label="Врачей на приёме" value={summary.doctorsActive} sub={`из ${summary.doctorsTotal}`} />
        <StatCard label="С опозданием" value={summary.latePatients} warn={summary.latePatients > 0} sub="> 30 мин" />
      </div>

      {/* Таблица врачей */}
      {doctors.length === 0 ? (
        <div className="text-[10px] text-slate-500 text-center py-6">Нет врачей</div>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: '1px solid rgba(0,104,91,.2)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: 'rgba(0,104,91,.1)' }}>
                {['ФИО', 'Специальность', 'Статус', 'Очередь', 'Сред. ожидание'].map(h => (
                  <th key={h} className="text-left text-[8px] font-semibold text-slate-400 px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(doctors as any[]).map((d: any) => (
                <tr key={d.id} style={{ borderTop: '1px solid rgba(255,255,255,.04)' }}>
                  <td className="px-3 py-2 text-[10px] text-slate-200">
                    {d.lastName} {d.firstName}{d.middleName ? ` ${d.middleName[0]}.` : ''}
                  </td>
                  <td className="px-3 py-2 text-[9px] text-slate-400">{d.specialty ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: STATUS_COLOR[d.status] + '22', color: STATUS_COLOR[d.status] }}>
                      {STATUS_LABEL[d.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-slate-200 tabular-nums">{d.queueLength}</td>
                  <td className="px-3 py-2 text-[9px] text-slate-400 tabular-nums">
                    {d.avgWaitMinutes != null ? `${d.avgWaitMinutes} мин` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
