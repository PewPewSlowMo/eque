import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { getSocket } from '@/lib/socket';

function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-bold tabular-nums" style={{ fontSize: '22px', color: '#B39168', fontFamily: 'Montserrat, sans-serif' }}>
      {time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

const PRIORITY_COLOR: Record<string, string> = {
  EMERGENCY: '#ef4444',
  INPATIENT: '#f97316',
  SCHEDULED: '#eab308',
  WALK_IN:   '#22c55e',
};

export function DisplayBoard() {
  const queryClient = useQueryClient();

  const { data: board = [], isLoading } = trpc.display.getBoard.useQuery(
    undefined,
    { refetchInterval: 15_000 },
  );

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [['display', 'getBoard']] });
    };
    socket.on('queue:called', refresh);
    socket.on('queue:updated', refresh);
    return () => {
      socket.off('queue:called', refresh);
      socket.off('queue:updated', refresh);
    };
  }, [queryClient]);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: '#0d1117', fontFamily: 'Montserrat, sans-serif' }}>
      {/* header */}
      <div className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ background: '#00685B' }}>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-wide px-2 py-1 rounded-sm"
            style={{ border: '1px solid rgba(179,145,104,.4)', color: '#B39168' }}>
            УЛТ. ГОСПИТАЛЬ
          </span>
          <span className="text-white text-[13px] font-semibold">Электронная очередь</span>
        </div>
        <Clock />
      </div>

      {/* board */}
      <div className="flex-1 p-5">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <p style={{ color: '#64748b', fontSize: '16px' }}>Загрузка...</p>
          </div>
        ) : (board as any[]).length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <p style={{ color: '#374151', fontSize: '18px' }}>Нет активных врачей</p>
          </div>
        ) : (
          <div className="grid gap-4" style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          }}>
            {(board as any[]).map((item: any) => (
              <div key={item.assignmentId} className="overflow-hidden"
                style={{ background: '#161b22', border: '1px solid #1e2530', borderRadius: '6px' }}>

                {/* cabinet header */}
                <div className="px-4 py-2.5 flex items-center justify-between"
                  style={{ background: '#00685B' }}>
                  <span className="text-white font-bold" style={{ fontSize: '18px' }}>
                    Каб. {item.cabinet.number}
                  </span>
                  {item.waitingCount > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}>
                      {item.waitingCount} ожид.
                    </span>
                  )}
                </div>

                {/* doctor */}
                <div className="px-4 py-2.5" style={{ borderBottom: '1px solid #1e2530' }}>
                  <div className="font-semibold" style={{ fontSize: '12px', color: '#e2e8f0' }}>
                    {item.doctor.lastName} {item.doctor.firstName}
                  </div>
                  {item.doctor.specialty && (
                    <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                      {item.doctor.specialty}
                    </div>
                  )}
                </div>

                {/* current patient — NAME not ticket number */}
                <div className="px-4 py-4 min-h-[72px] flex items-center">
                  {item.current ? (
                    <div>
                      <div style={{
                        width: '6px', height: '6px', borderRadius: '50%', marginBottom: '6px',
                        background: PRIORITY_COLOR[item.current.priority] ?? '#22c55e',
                      }} />
                      <div className="font-bold leading-tight" style={{ fontSize: '16px', color: '#f1f5f9' }}>
                        {item.current.patientLastName}
                      </div>
                      {item.current.patientFirstName && (
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                          {item.current.patientFirstName}
                        </div>
                      )}
                      <div style={{ fontSize: '10px', color: '#B39168', marginTop: '3px' }}>
                        {item.current.status === 'CALLED' ? 'Вызван' : 'На приёме'}
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: '12px', color: '#374151' }}>Нет вызова</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
