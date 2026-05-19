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
  break:  'bg-blue-50 text-blue-600',
  free:   'bg-amber-50 text-amber-700',
  off:    'bg-slate-100 text-slate-500',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Принимает',
  break:  'На перерыве',
  free:   'Свободен',
  off:    'Не вышел',
};

const STATUS_CHIPS = [
  { key: 'waitingArrival', label: 'Ожидают прихода', dot: 'bg-slate-400' },
  { key: 'arrived',        label: 'Пришли',           dot: 'bg-blue-400' },
  { key: 'called',         label: 'Вызваны',           dot: 'bg-amber-400' },
  { key: 'inProgress',     label: 'В кабинете',        dot: 'bg-emerald-500' },
  { key: 'completedToday', label: 'Завершено',          dot: 'bg-teal-500' },
  { key: 'noShowToday',    label: 'Неявки',             dot: 'bg-red-400' },
] as const;

export function OperationalPanel({ deptId }: Props) {
  const { data, isLoading } = trpc.analytics.getOperational.useQuery(
    { deptId },
    { refetchInterval: 30_000 },
  );

  if (isLoading) return <div className="text-sm text-muted-foreground py-10 text-center">Загрузка...</div>;
  if (!data) return null;

  const { summary, doctors } = data as any;
  const sb = (summary.statusBreakdown ?? {}) as Record<string, number>;

  return (
    <div className="space-y-4">
      {/* Строка статусов */}
      <div className="flex flex-wrap gap-2">
        {STATUS_CHIPS.map(({ key, label, dot }) => (
          <div key={key} className="flex items-center gap-1.5 bg-white border border-border rounded-full px-3 py-1 shadow-sm">
            <div className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
            <span className="text-xs text-muted-foreground">{label}:</span>
            <span className="text-xs font-semibold text-foreground tabular-nums">{sb[key] ?? 0}</span>
          </div>
        ))}
      </div>

      {/* Сводные карточки */}
      <div className="flex gap-3 flex-wrap">
        <StatCard label="Ожидают" value={summary.totalWaiting} />
        <StatCard label="Врачей на приёме" value={summary.doctorsActive} sub={`из ${summary.doctorsTotal}`} />
        <StatCard label="С опозданием" value={summary.latePatients} warn={summary.latePatients > 0} sub="> 30 мин" />
        <StatCard
          label="Макс. ожидание"
          value={summary.maxWaitMinutes != null ? `${summary.maxWaitMinutes} мин` : '—'}
          warn={summary.maxWaitMinutes != null && summary.maxWaitMinutes > 60}
        />
      </div>

      {/* Таблица врачей */}
      {doctors.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">Нет врачей</div>
      ) : (
        <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted border-b border-border">
                {['ФИО', 'Специальность', 'Статус', 'Очередь', 'Сред. ожидание', 'Норматив', 'Ср. приём', 'Опоздавших'].map(h => (
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
                  <td className="px-4 py-2.5 text-sm text-muted-foreground tabular-nums">
                    {d.normativeMinutes != null ? `${d.normativeMinutes} мин` : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-sm tabular-nums ${
                    d.avgDurationToday != null && d.normativeMinutes != null && d.avgDurationToday > d.normativeMinutes * 1.2
                      ? 'text-red-600 font-semibold'
                      : 'text-muted-foreground'
                  }`}>
                    {d.avgDurationToday != null ? `${d.avgDurationToday} мин` : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-sm tabular-nums ${(d.lateCount ?? 0) > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                    {d.lateCount ?? 0}
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
