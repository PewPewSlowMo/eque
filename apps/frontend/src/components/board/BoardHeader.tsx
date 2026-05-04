import { useState, useEffect } from 'react';

interface Props {
  boardName: string;
}

function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontWeight: 700, color: '#B39168', fontSize: 36, fontFamily: 'Montserrat, sans-serif', letterSpacing: '0.04em' }}>
      {time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

export function BoardHeader({ boardName }: Props) {
  return (
    <div
      style={{
        height: 120, flexShrink: 0, background: '#00685B',
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center', padding: '0 32px',
      }}
    >
      {/* Left: logo */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img src="/logo.png" alt="" style={{ height: 72, objectFit: 'contain' }} />
      </div>

      {/* Center: board name */}
      <div style={{
        color: '#ffffff', fontWeight: 800, fontSize: 42,
        fontFamily: 'Montserrat, sans-serif', textAlign: 'center', letterSpacing: '0.01em',
      }}>
        {boardName}
      </div>

      {/* Right: clock */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <Clock />
      </div>
    </div>
  );
}
