// apps/frontend/src/components/analytics/AnalyticsTab.tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { OperationalPanel } from './OperationalPanel';
import { HistoricalPanel } from './HistoricalPanel';

interface Props {
  lockedDeptId?: string;
}

export function AnalyticsTab({ lockedDeptId }: Props) {
  const [mode, setMode] = useState<'operational' | 'historical'>('operational');
  const [selectedDeptId, setSelectedDeptId] = useState<string | undefined>(undefined);

  const { data: departments = [] } = trpc.departments.getAll.useQuery(
    { includeInactive: false },
    { enabled: !lockedDeptId },
  );

  const deptId = lockedDeptId ?? selectedDeptId;

  const btnBase = 'text-[9px] font-semibold px-3 py-1.5 transition-colors';
  const activeStyle = { background: 'rgba(0,104,91,.3)', color: '#00a08f', borderRadius: '3px 10px 10px 3px' };
  const inactiveStyle = { color: 'rgba(255,255,255,.5)', background: 'transparent' };

  return (
    <div className="space-y-3">
      {/* Фильтр отделения (только для ADMIN/DIRECTOR) */}
      {!lockedDeptId && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-slate-500">Отделение:</span>
          <select
            value={selectedDeptId ?? ''}
            onChange={e => setSelectedDeptId(e.target.value || undefined)}
            className="text-[9px] px-2 py-1 outline-none"
            style={{ background: '#12151e', border: '1px solid #252831', borderRadius: 4, color: '#e2e8f0' }}
          >
            <option value="">Вся клиника</option>
            {(departments as any[]).map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Переключатель режимов */}
      <div className="flex items-center gap-1">
        <button className={btnBase} style={mode === 'operational' ? activeStyle : inactiveStyle}
          onClick={() => setMode('operational')}>
          Оперативная
        </button>
        <button className={btnBase} style={mode === 'historical' ? activeStyle : inactiveStyle}
          onClick={() => setMode('historical')}>
          Историческая
        </button>
      </div>

      {/* Панели */}
      {mode === 'operational' ? (
        <OperationalPanel deptId={deptId} />
      ) : (
        <HistoricalPanel deptId={deptId} />
      )}
    </div>
  );
}
