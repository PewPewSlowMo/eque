import { trpc } from '@/lib/trpc';

interface Props {
  deptId?: string;
}

function StatCard({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div className="flex-1 min-w-[120px] bg-white border border-border rounded-lg p-4 shadow-sm">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${warn ? 'text-red-600' : 'text-foreground'}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  free:   'bg-amber-50 text-amber-700',
  off:    'bg-slate-100 text-slate-500',
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

  if (isLoading) return <div className="text-sm text-muted-foreground py-10 text-center">Загрузка...</div>;
  if (!data) return null;

  const { summary, doctors } = data as any;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <StatCard label="Ожидают" value={summary.totalWaiting} />
        <StatCard label="Врачей на приёме" value={summary.doctorsActive} sub={`из ${summary.doctorsTotal}`} />
        <StatCard label="С опозданием" value={summary.latePatients} warn={summary.latePatients > 0} sub="> 30 мин" />
      </div>

      {doctors.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">Нет врачей</div>
      ) : (
        <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted border-b border-border">
                {['ФИО', 'Специальность', 'Статус', 'Очередь', 'Сред. ожидание'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(doctors as any[]).map((d: any) => (
                <tr key={d.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">
                    {d.lastName} {d.firstName}{d.middleName ? ` ${d.middleName[0]}.` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{d.specialty ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[d.status] ?? 'bg-slate-100 text-slate-500'}`}>
                      {STATUS_LABEL[d.status] ?? d.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm tabular-nums text-foreground">{d.queueLength}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground tabular-nums">
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
