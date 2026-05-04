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

// "Имя Фа." — имя полностью, первые 2 буквы фамилии + точка
function formatName(firstName: string, lastName: string): { first: string; last: string } {
  const last = lastName.length > 0 ? lastName.slice(0, 2) + '.' : '';
  return { first: firstName, last };
}

export function QueuePanel({ queue }: Props) {
  const shouldScroll = queue.length > SCROLL_THRESHOLD;

  const displayList = useMemo(
    () => shouldScroll ? [...queue, ...queue] : queue,
    [queue, shouldScroll],
  );

  const scrollDuration = queue.length * 3;

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

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            ...(shouldScroll ? { animation: `scroll-up ${scrollDuration}s linear infinite` } : {}),
          }}
        >
          {displayList.map((entry, i) => {
            const { first, last } = formatName(entry.patientFirstName, entry.patientLastName);
            const time = formatTime(entry.scheduledAt);
            return (
              <div
                key={`${entry.queueNumber}-${i}`}
                style={{
                  display: 'flex', alignItems: 'stretch',
                  background: '#161b22', border: '1px solid #1e2530',
                  borderRadius: 5, overflow: 'hidden', flexShrink: 0,
                }}
              >
                {/* Cabinet tag */}
                <div style={{
                  width: 60, flexShrink: 0, background: '#00685B',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', padding: '6px 0',
                }}>
                  <span style={{ fontSize: 33, fontWeight: 900, lineHeight: 1, color: '#fff' }}>
                    {entry.cabinetNumber}
                  </span>
                  <span style={{ fontSize: 14, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 1 }}>
                    Каб.
                  </span>
                </div>

                {/* Patient info */}
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center',
                  padding: '6px 8px', gap: 0, overflow: 'hidden', minWidth: 0,
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
    </div>
  );
}
