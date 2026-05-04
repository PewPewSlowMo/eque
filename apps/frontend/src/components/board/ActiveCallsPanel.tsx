interface ActiveCall {
  cabinetNumber: string;
  cabinetName: string | null;
  patientLastName: string;
  patientFirstName: string;
  calledAt: Date | string | null;
}

interface Props {
  calls: ActiveCall[];
}

export function ActiveCallsPanel({ calls }: Props) {
  return (
    <div style={{
      flex: '0 0 67%', display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,.06)', overflow: 'hidden',
      padding: '24px 32px', gap: 16,
    }}>
      <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 22, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        Активные вызовы
      </div>

      {calls.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 32, fontWeight: 500 }}>Ожидайте вызова</span>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
          {calls.map((call, i) => (
            <div
              key={i}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                gap: 20, padding: '12px 24px', borderRadius: 12,
                background: 'rgba(0,104,91,.15)', border: '1px solid rgba(0,104,91,.3)',
              }}
            >
              <span style={{ color: '#B39168', fontWeight: 800, fontSize: 48, lineHeight: 1, flexShrink: 0 }}>
                {call.patientLastName} {call.patientFirstName.charAt(0)}.
              </span>
              <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 72, lineHeight: 0.6, overflow: 'hidden', flexShrink: 0 }}>
                →
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                <span style={{ color: '#ffffff', fontWeight: 900, fontSize: 72, lineHeight: 1 }}>
                  {call.cabinetNumber}
                </span>
                <span style={{ color: 'rgba(255,255,255,.45)', fontSize: 20 }}>каб.</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
