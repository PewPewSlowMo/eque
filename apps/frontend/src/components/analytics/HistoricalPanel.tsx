// apps/frontend/src/components/analytics/HistoricalPanel.tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PeriodSelector, type Period } from './PeriodSelector';

interface Props {
  deptId?: string;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex-1 min-w-[90px] p-3 rounded"
      style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.25)' }}>
      <div className="text-[8px] text-slate-500 mb-1">{label}</div>
      <div className="text-[18px] font-bold tabular-nums text-slate-100">{value}</div>
      {sub && <div className="text-[8px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренные',
  INPATIENT: 'Стационарные',
  SCHEDULED: 'Плановые',
  WALK_IN:   'Живая очередь',
};
const PRIORITY_COLOR: Record<string, string> = {
  EMERGENCY: '#ef4444',
  INPATIENT: '#f59e0b',
  SCHEDULED: '#00a08f',
  WALK_IN:   '#6366f1',
};
const SOURCE_LABEL: Record<string, string> = {
  REGISTRAR:   'Регистратура',
  CALL_CENTER: 'Колл-центр',
  KIOSK:       'Киоск',
  DOCTOR_SELF: 'Врач сам',
};
const SOURCE_COLOR: Record<string, string> = {
  REGISTRAR:   '#00a08f',
  CALL_CENTER: '#6366f1',
  KIOSK:       '#f59e0b',
  DOCTOR_SELF: '#B39168',
};

function BarRow({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <div className="text-[9px] text-slate-400 w-[110px] shrink-0">{label}</div>
      <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.07)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[8px] text-slate-500 tabular-nums w-[36px] text-right">{count} / {pct}%</div>
    </div>
  );
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function HistoricalPanel({ deptId }: Props) {
  const today = toIso(new Date());
  const weekAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 6); return toIso(d); })();

  const [period, setPeriod] = useState<Period>('week');
  const [from, setFrom]     = useState(weekAgo);
  const [to, setTo]         = useState(today);

  function handlePeriod(p: Period, f: string, t: string) {
    setPeriod(p); setFrom(f); setTo(t);
  }

  const { data, isLoading } = trpc.analytics.getHistorical.useQuery(
    { deptId, from, to },
    { enabled: !!from && !!to },
  );

  const d = data as any;

  const maxDay = d ? Math.max(...(d.byDay as any[]).map((x: any) => x.total), 1) : 1;

  return (
    <div className="space-y-4">
      <PeriodSelector period={period} from={from} to={to} onChange={handlePeriod} />

      {isLoading && <div className="text-[10px] text-slate-500 py-8 text-center">Загрузка...</div>}

      {d && (
        <>
          {/* Итоги */}
          <div className="flex gap-2 flex-wrap">
            <StatCard label="Выполнено"    value={d.totals.completed} />
            <StatCard label="Запланировано" value={d.totals.scheduled} />
            <StatCard label="% выполнения"  value={`${d.totals.completionRate}%`} />
            <StatCard label="% неявок"      value={`${d.totals.noShowRate}%`} />
            <StatCard label="Отменено"      value={d.totals.cancelled} />
          </div>

          {/* Временны́е показатели */}
          <div className="flex gap-2 flex-wrap">
            <StatCard label="Сред. ожидание"      value={d.timing.avgWaitMinutes != null ? `${d.timing.avgWaitMinutes} мин` : '—'} />
            <StatCard label="Сред. приём"          value={d.timing.avgDurationMinutes != null ? `${d.timing.avgDurationMinutes} мин` : '—'} />
            <StatCard label="Сред. опоздание"      value={d.timing.avgLatenessMinutes != null ? `${d.timing.avgLatenessMinutes} мин` : '—'} />
            <StatCard label="Время реакции врача"  value={d.timing.avgResponseMinutes != null ? `${d.timing.avgResponseMinutes} мин` : '—'} />
          </div>

          {/* Разбивки */}
          {(d.byPriority.length > 0 || d.bySource.length > 0) && (
            <div className="flex gap-4 flex-wrap">
              {d.byPriority.length > 0 && (
                <div className="flex-1 min-w-[200px] p-3 rounded" style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.2)' }}>
                  <div className="text-[8px] font-semibold text-slate-400 mb-2 uppercase tracking-wide">По приоритетам</div>
                  {(d.byPriority as any[]).map((p: any) => (
                    <BarRow key={p.priority} label={PRIORITY_LABEL[p.priority] ?? p.priority}
                      count={p.count} pct={p.pct} color={PRIORITY_COLOR[p.priority] ?? '#6b7280'} />
                  ))}
                </div>
              )}
              {d.bySource.length > 0 && (
                <div className="flex-1 min-w-[200px] p-3 rounded" style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.2)' }}>
                  <div className="text-[8px] font-semibold text-slate-400 mb-2 uppercase tracking-wide">По источникам</div>
                  {(d.bySource as any[]).map((s: any) => (
                    <BarRow key={s.source} label={SOURCE_LABEL[s.source] ?? s.source}
                      count={s.count} pct={s.pct} color={SOURCE_COLOR[s.source] ?? '#6b7280'} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Отмены по причинам */}
          {d.byCancelReason.length > 0 && (
            <div className="p-3 rounded" style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.2)' }}>
              <div className="text-[8px] font-semibold text-slate-400 mb-2 uppercase tracking-wide">Отмены по причинам</div>
              {(d.byCancelReason as any[]).map((r: any) => (
                <div key={r.reason} className="flex justify-between text-[9px] mb-1">
                  <span className="text-slate-400">{r.reason}</span>
                  <span className="text-slate-200 font-semibold tabular-nums">{r.count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Нагрузка по дням */}
          {d.byDay.length > 0 && (
            <div className="p-3 rounded" style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.2)' }}>
              <div className="text-[8px] font-semibold text-slate-400 mb-2 uppercase tracking-wide">Нагрузка по дням</div>
              <div className="space-y-1.5">
                {(d.byDay as any[]).map((day: any) => (
                  <div key={day.date} className="flex items-center gap-2">
                    <div className="text-[9px] text-slate-500 w-[52px] shrink-0">{formatDay(day.date)}</div>
                    <div className="flex-1 flex flex-col gap-0.5">
                      <div className="h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.07)' }}>
                        <div className="h-full rounded-full" style={{ width: `${day.completed / maxDay * 100}%`, background: '#00a08f' }} />
                      </div>
                      <div className="h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.07)' }}>
                        <div className="h-full rounded-full" style={{ width: `${day.noShow / maxDay * 100}%`, background: '#ef4444' }} />
                      </div>
                    </div>
                    <div className="text-[8px] text-slate-500 tabular-nums w-[36px] text-right">
                      {day.completed}/{day.noShow}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-2">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ background: '#00a08f' }} /><span className="text-[8px] text-slate-500">Выполнено</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ background: '#ef4444' }} /><span className="text-[8px] text-slate-500">Неявки</span></div>
              </div>
            </div>
          )}

          {d.totals.scheduled === 0 && (
            <div className="text-[10px] text-slate-500 text-center py-6">Нет данных за выбранный период</div>
          )}
        </>
      )}
    </div>
  );
}
