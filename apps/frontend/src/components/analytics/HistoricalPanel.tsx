import { useState, type ReactNode } from 'react';
import { trpc } from '@/lib/trpc';
import { PeriodSelector, type Period } from './PeriodSelector';

interface Props {
  deptId?: string;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex-1 min-w-[110px] bg-white border border-border rounded-lg p-4 shadow-sm">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренные',
  INPATIENT:  'Стационарные',
  SCHEDULED:  'Плановые',
  WALK_IN:    'Живая очередь',
};
const PRIORITY_COLOR: Record<string, string> = {
  EMERGENCY: '#ef4444',
  INPATIENT:  '#f59e0b',
  SCHEDULED:  '#10b981',
  WALK_IN:    '#6366f1',
};
const SOURCE_LABEL: Record<string, string> = {
  REGISTRAR:   'Регистратура',
  CALL_CENTER: 'Колл-центр',
  KIOSK:       'Киоск',
  DOCTOR_SELF: 'Врач сам',
};
const SOURCE_COLOR: Record<string, string> = {
  REGISTRAR:   '#10b981',
  CALL_CENTER: '#6366f1',
  KIOSK:       '#f59e0b',
  DOCTOR_SELF: '#8b5cf6',
};

function BarRow({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-2 last:mb-0">
      <div className="text-sm text-slate-600 w-32 shrink-0">{label}</div>
      <div className="flex-1 h-2 rounded-full overflow-hidden bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-xs text-muted-foreground tabular-nums w-16 text-right">{count} ({pct}%)</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{children}</div>;
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function workloadColor(pct: number): string {
  if (pct < 70)  return 'text-amber-600';
  if (pct <= 90) return 'text-emerald-600';
  return 'text-red-600';
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
  const maxHour = d && d.byHour.length > 0 ? Math.max(...(d.byHour as any[]).map((x: any) => x.total), 1) : 1;
  const maxDow  = d && d.byDayOfWeek.length > 0 ? Math.max(...(d.byDayOfWeek as any[]).map((x: any) => x.total), 1) : 1;

  return (
    <div className="space-y-4">
      <PeriodSelector period={period} from={from} to={to} onChange={handlePeriod} />

      {isLoading && <div className="text-sm text-muted-foreground py-10 text-center">Загрузка...</div>}

      {d && (
        <>
          {/* Итоговые показатели */}
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Выполнено"     value={d.totals.completed} />
            <StatCard label="Пришли"        value={d.totals.arrived} />
            <StatCard label="Запланировано" value={d.totals.scheduled} />
            <StatCard label="% выполнения"  value={`${d.totals.completionRate}%`} />
            <StatCard label="% неявок"      value={`${d.totals.noShowRate}%`} />
            <StatCard label="Отменено"      value={d.totals.cancelled} />
          </div>

          {/* Временны́е показатели */}
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Сред. ожидание"   value={d.timing.avgWaitMinutes     != null ? `${d.timing.avgWaitMinutes} мин`     : '—'} />
            <StatCard label="Сред. приём"       value={d.timing.avgDurationMinutes != null ? `${d.timing.avgDurationMinutes} мин` : '—'} />
            <StatCard label="Сред. опоздание"   value={d.timing.avgLatenessMinutes != null ? `${d.timing.avgLatenessMinutes} мин` : '—'} />
            <StatCard label="Реакция врача"     value={d.timing.avgResponseMinutes != null ? `${d.timing.avgResponseMinutes} мин` : '—'} />
          </div>

          {/* Разбивки по приоритетам и источникам */}
          {(d.byPriority.length > 0 || d.bySource.length > 0) && (
            <div className="flex gap-4 flex-wrap">
              {d.byPriority.length > 0 && (
                <div className="flex-1 min-w-[240px] bg-white border border-border rounded-lg p-4 shadow-sm">
                  <SectionTitle>По приоритетам</SectionTitle>
                  {(d.byPriority as any[]).map((p: any) => (
                    <BarRow key={p.priority} label={PRIORITY_LABEL[p.priority] ?? p.priority}
                      count={p.count} pct={p.pct} color={PRIORITY_COLOR[p.priority] ?? '#6b7280'} />
                  ))}
                </div>
              )}
              {d.bySource.length > 0 && (
                <div className="flex-1 min-w-[240px] bg-white border border-border rounded-lg p-4 shadow-sm">
                  <SectionTitle>По источникам</SectionTitle>
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
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Отмены по причинам</SectionTitle>
              {(d.byCancelReason as any[]).map((r: any) => (
                <div key={r.reason} className="flex justify-between items-center text-sm py-1 border-b border-border last:border-0">
                  <span className="text-slate-600">{r.reason}</span>
                  <span className="font-semibold tabular-nums text-foreground">{r.count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Нагрузка по дням */}
          {d.byDay.length > 0 && (
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Нагрузка по дням</SectionTitle>
              <div className="space-y-2">
                {(d.byDay as any[]).map((day: any) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground w-16 shrink-0">{formatDay(day.date)}</div>
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="h-2 rounded-full overflow-hidden bg-muted">
                        <div className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${day.completed / maxDay * 100}%` }} />
                      </div>
                      <div className="h-2 rounded-full overflow-hidden bg-muted">
                        <div className="h-full rounded-full bg-red-400 transition-all"
                          style={{ width: `${day.noShow / maxDay * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                      {day.completed}/{day.noShow}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-3">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-emerald-500" /><span className="text-xs text-muted-foreground">Выполнено</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-red-400" /><span className="text-xs text-muted-foreground">Неявки</span></div>
              </div>
            </div>
          )}

          {/* Неявки по врачам */}
          {d.noShowByDoctor.length > 0 && (
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Неявки по врачам</SectionTitle>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['ФИО', 'Специальность', 'Неявки', 'Всего', '% неявок'].map(h => (
                      <th key={h} className={`text-xs font-semibold text-muted-foreground pb-2 ${h === 'ФИО' || h === 'Специальность' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(d.noShowByDoctor as any[]).map((doc: any) => (
                    <tr key={doc.doctorId} className="border-t border-border">
                      <td className="py-2 text-sm text-foreground">{doc.lastName} {doc.firstName}</td>
                      <td className="py-2 text-sm text-muted-foreground">{doc.specialty ?? '—'}</td>
                      <td className="py-2 text-sm tabular-nums text-right text-red-600 font-semibold">{doc.noShow}</td>
                      <td className="py-2 text-sm tabular-nums text-right text-muted-foreground">{doc.total}</td>
                      <td className="py-2 text-sm tabular-nums text-right font-semibold text-foreground">{doc.noShowRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Распределение по часам */}
          {d.byHour.length > 0 && (
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Распределение по часам</SectionTitle>
              <div className="space-y-1.5">
                {(d.byHour as any[]).map((h: any) => (
                  <div key={h.hour} className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground w-12 shrink-0 tabular-nums">
                      {String(h.hour).padStart(2, '0')}:00
                    </div>
                    <div className="flex-1 h-2 rounded-full overflow-hidden bg-muted">
                      <div className="h-full rounded-full bg-blue-400 transition-all"
                        style={{ width: `${h.total / maxHour * 100}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums w-8 text-right">{h.total}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Распределение по дням недели */}
          {d.byDayOfWeek.length > 0 && (
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Распределение по дням недели</SectionTitle>
              <div className="space-y-1.5">
                {(d.byDayOfWeek as any[]).map((day: any) => (
                  <div key={day.weekday} className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground w-8 shrink-0">{day.label}</div>
                    <div className="flex-1 h-2 rounded-full overflow-hidden bg-muted">
                      <div className="h-full rounded-full bg-indigo-400 transition-all"
                        style={{ width: `${day.total / maxDow * 100}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums w-8 text-right">{day.total}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Загрузка врачей */}
          {d.doctorWorkload.length > 0 && (
            <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="p-4 pb-2">
                <SectionTitle>Загрузка врачей</SectionTitle>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    {['ФИО', 'Специальность', 'Принято', 'Слоты план', 'Загрузка (слоты)', 'Время план (мин)', 'Время факт (мин)', 'Загрузка (время)'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-4 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(d.doctorWorkload as any[]).map((doc: any) => (
                    <tr key={doc.doctorId} className="border-t border-border hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-2.5 text-sm font-medium text-foreground">{doc.lastName} {doc.firstName}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{doc.specialty ?? '—'}</td>
                      <td className="px-4 py-2.5 text-sm tabular-nums text-foreground">{doc.completed}</td>
                      <td className="px-4 py-2.5 text-sm tabular-nums text-muted-foreground">
                        {doc.slotsTotal > 0 ? doc.slotsTotal : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-sm tabular-nums font-semibold ${doc.slotsTotal > 0 ? workloadColor(doc.workloadBySlotsPct) : 'text-muted-foreground'}`}>
                        {doc.slotsTotal > 0 ? `${doc.workloadBySlotsPct}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums text-muted-foreground">
                        {doc.scheduledMinutes > 0 ? doc.scheduledMinutes : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums text-muted-foreground">
                        {doc.actualMinutes > 0 ? doc.actualMinutes : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-sm tabular-nums font-semibold ${doc.scheduledMinutes > 0 ? workloadColor(doc.workloadByTimePct) : 'text-muted-foreground'}`}>
                        {doc.scheduledMinutes > 0 ? `${doc.workloadByTimePct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.totals.scheduled === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">Нет данных за выбранный период</div>
          )}
        </>
      )}
    </div>
  );
}
