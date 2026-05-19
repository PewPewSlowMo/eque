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

  return (
    <div className="space-y-4">
      {/* Верхняя панель: фильтр + переключатель */}
      <div className="flex flex-wrap items-center gap-3">
        {!lockedDeptId && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground shrink-0">Отделение:</span>
            <select
              value={selectedDeptId ?? ''}
              onChange={e => setSelectedDeptId(e.target.value || undefined)}
              className="text-sm px-3 py-1.5 border border-border rounded outline-none focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="">Вся клиника</option>
              {(departments as any[]).map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Переключатель Оперативная / Историческая */}
        <div className="flex rounded border border-border overflow-hidden text-sm">
          <button
            onClick={() => setMode('operational')}
            className={`px-4 py-1.5 font-medium transition-colors ${
              mode === 'operational'
                ? 'bg-primary text-primary-foreground'
                : 'bg-white text-muted-foreground hover:bg-muted'
            }`}
          >
            Оперативная
          </button>
          <button
            onClick={() => setMode('historical')}
            className={`px-4 py-1.5 font-medium transition-colors border-l border-border ${
              mode === 'historical'
                ? 'bg-primary text-primary-foreground'
                : 'bg-white text-muted-foreground hover:bg-muted'
            }`}
          >
            Историческая
          </button>
        </div>
      </div>

      {mode === 'operational' ? (
        <OperationalPanel deptId={deptId} />
      ) : (
        <HistoricalPanel deptId={deptId} />
      )}
    </div>
  );
}
