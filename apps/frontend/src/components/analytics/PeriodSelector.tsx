// apps/frontend/src/components/analytics/PeriodSelector.tsx

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

export function PeriodSelector({ period, from, to, onChange }: Props) {
  const today = toIso(new Date());

  function select(p: Period) {
    if (p === 'today')  { onChange(p, today, today); return; }
    if (p === 'week')   { const d = new Date(); d.setDate(d.getDate() - 6); onChange(p, toIso(d), today); return; }
    if (p === 'month')  { const d = new Date(); d.setDate(d.getDate() - 29); onChange(p, toIso(d), today); return; }
    onChange(p, from, to);
  }

  const btnBase = 'text-[9px] font-semibold px-2.5 py-1 transition-colors';
  const active  = { background: 'rgba(0,104,91,.3)', color: '#00a08f', borderRadius: '3px 10px 10px 3px' };
  const inactive = { color: 'rgba(255,255,255,.5)', background: 'transparent' };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(['today', 'week', 'month', 'custom'] as Period[]).map(p => (
        <button key={p} className={btnBase} style={period === p ? active : inactive} onClick={() => select(p)}>
          {p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : p === 'month' ? 'Месяц' : 'Период'}
        </button>
      ))}
      {period === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date" value={from}
            onChange={e => onChange('custom', e.target.value, to)}
            className="text-[9px] px-1.5 py-0.5 outline-none"
            style={{ background: '#12151e', border: '1px solid #252831', borderRadius: 4, color: '#e2e8f0' }}
          />
          <span className="text-[9px] text-slate-500">—</span>
          <input
            type="date" value={to}
            onChange={e => onChange('custom', from, e.target.value)}
            className="text-[9px] px-1.5 py-0.5 outline-none"
            style={{ background: '#12151e', border: '1px solid #252831', borderRadius: 4, color: '#e2e8f0' }}
          />
        </div>
      )}
    </div>
  );
}
