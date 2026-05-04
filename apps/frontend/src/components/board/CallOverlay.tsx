import { useEffect } from 'react';
import type { CallEvent } from './useCallNotifications';

interface Props {
  calls: CallEvent[];   // 1–3 активных вызова для показа
  onDismiss: () => void;
}

const SIZE = {
  one:   { patient: 145, arrow: 311, cabNum: 221, cabLabel: 62,  gap: 24, padding: '0 60px' },
  two:   { patient: 129, arrow: 238, cabNum: 168, cabLabel: 46,  gap: 20, padding: '0 48px' },
  three: { patient: 95,  arrow: 182, cabNum: 124, cabLabel: 34,  gap: 16, padding: '0 40px' },
} as const;

const CLS_MAP: Record<number, keyof typeof SIZE> = { 1: 'one', 2: 'two', 3: 'three' };

export function CallOverlay({ calls, onDismiss }: Props) {
  useEffect(() => {
    const id = setTimeout(onDismiss, 5_000);
    return () => clearTimeout(id);
  }, [calls, onDismiss]);

  if (calls.length === 0) return null;

  const key = CLS_MAP[Math.min(calls.length, 3)] ?? 'three';
  const sz = SIZE[key];

  return (
    <>
      <style>{`
        @keyframes bg-pulse {
          0%   { background: rgba(0,0,0,.93); }
          100% { background: rgba(0,18,14,.97); }
        }
        @keyframes strip-border {
          0%   { border-color: rgba(179,145,104,.08); box-shadow: none; }
          100% { border-color: rgba(179,145,104,.75); box-shadow: 0 0 28px rgba(179,145,104,.1); }
        }
        @keyframes gold-flash {
          0%   { opacity: .7; text-shadow: none; }
          100% { opacity: 1;  text-shadow: 0 0 30px rgba(179,145,104,.5); }
        }
        @keyframes arrow-move {
          0%   { color: rgba(255,255,255,.2); transform: translateY(-8%) translateX(-5px); }
          100% { color: rgba(255,255,255,.75); transform: translateY(-8%) translateX(5px); }
        }
      `}</style>

      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          display: 'flex', flexDirection: 'column',
          animation: 'bg-pulse 0.5s ease-in-out infinite alternate',
          fontFamily: 'Montserrat, Segoe UI, system-ui, sans-serif',
        }}
        onClick={onDismiss}
      >
        {calls.slice(0, 3).map((call, i) => (
          <div
            key={i}
            style={{
              flex: 1, display: 'flex', flexDirection: 'row',
              alignItems: 'center', justifyContent: 'center',
              gap: sz.gap, padding: sz.padding,
              borderBottom: i < calls.length - 1 ? '1px solid rgba(255,255,255,.06)' : 'none',
              position: 'relative',
            }}
          >
            {/* Border glow overlay */}
            <div style={{
              position: 'absolute', inset: '8px 16px', borderRadius: 14,
              animation: 'strip-border 0.5s ease-in-out infinite alternate',
              border: '2px solid transparent', pointerEvents: 'none',
            }} />

            {/* Patient name */}
            <span style={{
              flexShrink: 0, whiteSpace: 'nowrap',
              fontWeight: 900, color: '#B39168', lineHeight: 1,
              fontSize: sz.patient,
              animation: 'gold-flash 0.5s ease-in-out infinite alternate',
            }}>
              {call.patientLastName} {call.patientFirstName.charAt(0)}.
            </span>

            {/* Arrow */}
            <span style={{
              flexShrink: 0, alignSelf: 'center',
              lineHeight: 0.6, overflow: 'hidden',
              fontSize: sz.arrow,
              animation: 'arrow-move 0.5s ease-in-out infinite alternate',
            }}>
              →
            </span>

            {/* Cabinet */}
            <span style={{
              flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 10,
              lineHeight: 1, alignSelf: 'center',
            }}>
              <span style={{ fontWeight: 900, color: '#ffffff', fontSize: sz.cabNum }}>
                {call.cabinetNumber}
              </span>
              <span style={{ fontWeight: 400, color: 'rgba(255,255,255,.55)', fontSize: sz.cabLabel }}>
                каб.
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
