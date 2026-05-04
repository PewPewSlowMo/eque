import { useMemo } from 'react';

interface QueueEntry {
  queueNumber: number;
  priority: string;
  patientLastName: string;
  patientFirstName: string;
  cabinetNumber: string;
}

interface Props {
  queue: QueueEntry[];
  columns: number;
}

const PRIORITY_COLOR: Record<string, string> = {
  EMERGENCY: '#ef4444',
  INPATIENT:  '#f97316',
  SCHEDULED:  '#eab308',
  WALK_IN:    '#22c55e',
};

const SCROLL_THRESHOLD = 8;

const SCROLL_STYLES = `
  @keyframes scroll-up {
    0%   { transform: translateY(0); }
    100% { transform: translateY(-50%); }
  }
`;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export function QueuePanel({ queue, columns }: Props) {
  const shouldScroll = queue.length > SCROLL_THRESHOLD;

  const displayList = useMemo(
    () => shouldScroll ? [...queue, ...queue] : queue,
    [queue, shouldScroll],
  );

  const rows = useMemo(() => chunkArray(displayList, columns), [displayList, columns]);

  const scrollDuration = queue.length * 3;

  return (
    <div style={{
      flex: '0 0 33%', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', padding: '24px 20px', gap: 12,
    }}>
      <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 22, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8, flexShrink: 0 }}>
        Очередь
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {shouldScroll && <style>{SCROLL_STYLES}</style>}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            ...(shouldScroll ? {
              animation: `scroll-up ${scrollDuration}s linear infinite`,
            } : {}),
          }}
        >
          {rows.map((row) => (
            <div key={row[0]?.queueNumber ?? -1} style={{ display: 'flex', gap: 6 }}>
              {row.map((entry) => (
                <div
                  key={entry.queueNumber}
                  style={{
                    flex: 1,
                    display: 'flex', flexDirection: 'column',
                    padding: '8px 10px', borderRadius: 8,
                    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ color: 'rgba(255,255,255,.45)', fontSize: 13 }}>#{entry.queueNumber}</span>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: PRIORITY_COLOR[entry.priority] ?? '#6b7280', flexShrink: 0 }} />
                  </div>
                  <span style={{ color: '#ffffff', fontWeight: 600, fontSize: 16, marginTop: 2, lineHeight: 1.2 }}>
                    {entry.patientLastName} {entry.patientFirstName ? entry.patientFirstName.charAt(0) + '.' : ''}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginTop: 2 }}>
                    каб. {entry.cabinetNumber}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
