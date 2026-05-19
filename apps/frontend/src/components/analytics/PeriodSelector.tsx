export type Period = 'today' | 'week' | 'month' | 'custom';

interface Props {
  period: Period;
  from: string;
  to: string;
  onChange: (period: Period, from: string, to: string) => void;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const LABELS: Record<Period, string> = {
  today: 'Сегодня',
  week: 'Неделя',
  month: 'Месяц',
  custom: 'Период',
};

export function PeriodSelector({ period, from, to, onChange }: Props) {
  const today = toIso(new Date());

  function select(p: Period) {
    if (p === 'today') { onChange(p, today, today); return; }
    if (p === 'week')  { const d = new Date(); d.setDate(d.getDate() - 6); onChange(p, toIso(d), today); return; }
    if (p === 'month') { const d = new Date(); d.setDate(d.getDate() - 29); onChange(p, toIso(d), today); return; }
    onChange(p, from, to);
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex rounded border border-border overflow-hidden text-sm">
        {(['today', 'week', 'month', 'custom'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => select(p)}
            className={`px-3 py-1.5 font-medium transition-colors border-l border-border first:border-l-0 ${
              period === p
                ? 'bg-primary text-primary-foreground'
                : 'bg-white text-muted-foreground hover:bg-muted'
            }`}
          >
            {LABELS[p]}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date" value={from}
            onChange={e => onChange('custom', e.target.value, to)}
            className="text-sm px-2 py-1 border border-border rounded outline-none focus:ring-1 focus:ring-primary bg-white"
          />
          <span className="text-sm text-muted-foreground">—</span>
          <input
            type="date" value={to}
            onChange={e => onChange('custom', from, e.target.value)}
            className="text-sm px-2 py-1 border border-border rounded outline-none focus:ring-1 focus:ring-primary bg-white"
          />
        </div>
      )}
    </div>
  );
}
