import { useMemo } from 'react';

interface QueueEntry {
  queueNumber: number;
  priority: string;
  patientLastName: string;
  patientFirstName: string;
  cabinetNumber: string;
  scheduledAt: string | Date | null;
}

interface Props {
  queue: QueueEntry[];
}

const SCROLL_THRESHOLD = 8;

const SCROLL_STYLES = `
  @keyframes scroll-up {
    0%   { transform: translateY(0); }
    100% { transform: translateY(-50%); }
  }
`;

function formatTime(value: string | Date | null): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatName(firstName: string, lastName: string): { first: string; last: string } {
  const last = lastName.length > 0 ? lastName.slice(0, 2) + '.' : '';
  return { first: firstName, last };
}

export function QueuePanel({ queue }: Props) {
  const shouldScroll = queue.length > SCROLL_THRESHOLD;
  const scrollDuration = queue.length * 3;

  const groups = useMemo(() => {
    const map = new Map<string, QueueEntry[]>();
    for (const e of queue) {
      if (!map.has(e.cabinetNumber)) map.set(e.cabinetNumber, []);
      map.get(e.cabinetNumber)!.push(e);
    }
    return Array.from(map.entries());
  }, [queue]);

  function renderGroups(keyPrefix: string) {
    return groups.map(([cab, entries]) => (
      <div key={`${keyPrefix}-${cab}`}>
        {/* Cabinet section header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '9px 6px 6px 6px',
        }}>
          <span style={{
            background: '#00685B', color: '#fff',
            fontSize: 21, fontWeight: 900,
            padding: '5px 15px', borderRadius: 6,
            letterSpacing: '0.04em', flexShrink: 0,
          }}>
            Каб. {cab}
          </span>
          <div style={{ flex: 1, height: 1, background: '#1e2530' }} />
          <span style={{ fontSize: 15, color: '#64748b', flexShrink: 0 }}>
            {entries.length} чел.
          </span>
        </div>

        {/* Patient rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {entries.map((entry, idx) => {
            const { first, last } = formatName(entry.patientFirstName, entry.patientLastName);
            const time = entry.priority === 'WALK_IN' ? '' : formatTime(entry.scheduledAt);
            return (
              <div
                key={`${keyPrefix}-${cab}-${entry.queueNumber}`}
                style={{
                  display: 'flex', alignItems: 'stretch',
                  background: '#161b22', border: '1px solid #1e2530',
                  borderRadius: 5, overflow: 'hidden', flexShrink: 0,
                }}
              >
                {/* Position badge */}
                <div style={{
                  width: 36, flexShrink: 0, background: '#1a2535',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 19, fontWeight: 900, color: '#94a3b8', lineHeight: 1 }}>
                    {idx + 1}
                  </span>
                </div>

                {/* Patient info */}
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center',
                  padding: '6px 8px', overflow: 'hidden', minWidth: 0,
                }}>
                  <span style={{
                    fontSize: 36, fontWeight: 700, color: '#e2e8f0',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    flex: 1, minWidth: 0,
                  }}>
                    {first}{' '}
                    <span style={{ color: '#94a3b8', fontWeight: 500 }}>{last}</span>
                  </span>
                  {time && (
                    <>
                      <span style={{ fontSize: 36, color: '#2d3748', margin: '0 5px', flexShrink: 0 }}>—</span>
                      <span style={{ fontSize: 36, color: '#475569', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                        {time}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ));
  }

  return (
    <div style={{
      flex: '0 0 38%', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', padding: '24px 20px', gap: 12,
    }}>
      <div style={{
        color: 'rgba(255,255,255,.4)', fontSize: 22, fontWeight: 600,
        letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8, flexShrink: 0,
      }}>
        Очередь
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {shouldScroll && <style>{SCROLL_STYLES}</style>}

        <div style={{
          display: 'flex', flexDirection: 'column', gap: 0,
          ...(shouldScroll ? { animation: `scroll-up ${scrollDuration}s linear infinite` } : {}),
        }}>
          {renderGroups('a')}
          {shouldScroll && renderGroups('b')}
        </div>
      </div>
    </div>
  );
}
